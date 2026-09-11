import type { AgentHarnessTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { awaitWithContext, withCancel } from "@earendil-works/pi-agent-core/harness/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { looksLikeWrongVariant } from "./title-variant-conflict.ts";

const parameters = Type.Object({ title: Type.String({ pattern: "\\S", maxLength: 500 }), target_language: Type.Union([Type.Literal("ja"), Type.Literal("zh"), Type.Literal("en")]) }, { additionalProperties: false });

/** Translation may spend model tokens; never replay an interrupted call and charge it twice. */
export const translateAnimeTitle: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "translate_anime_title", label: "Translate anime title", replay: "never", parameters,
  description: "Translate an anime title. Prefer the catalog's accepted Chinese title and preserve provenance.",
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    const bounded = withCancel(context);
    const timer = setTimeout(() => { bounded.cancel(new DOMException("Translation exceeded 85 seconds", "TimeoutError")); }, 85_000);
    try {
      const translated = await awaitWithContext(curatedTitle(tools, params.title, params.target_language, bounded.context.abortSignal), bounded.context);
      if (translated) return translationResult(params.title, translated, "catalog");
      return await awaitWithContext(modelTranslation(tools, params.title, params.target_language, bounded.context.abortSignal), bounded.context);
    } finally { clearTimeout(timer); }
  },
};

async function curatedTitle(tools: PilgrimageToolContext, title: string, language: string, signal?: AbortSignal) {
  if (language !== "zh") return undefined;
  const resolved = await tools.catalog.resolve({ query: title }, { signal });
  if (resolved.outcome !== "resolved" || looksLikeWrongVariant(title, [resolved.match.title, resolved.match.title_cn])) return undefined;
  const translated = resolved.match.title_cn?.trim();
  return translated === "" ? undefined : translated;
}

function translationResult(original: string, translated: string, source: "catalog" | "llm" | "untranslated", payer?: "platform" | "byok") {
  const details = { original, translated, source, confidence: { catalog: 1, llm: 0.6, untranslated: 0 }[source], ...(payer ? { payer } : {}) };
  return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

async function modelTranslation(tools: PilgrimageToolContext, title: string, language: string, signal?: AbortSignal): Promise<AgentToolResult<ReturnType<typeof translationResult>["details"]>> {
  if (!tools.translation) return translationResult(title, title, "untranslated");
  const { models, model, payer } = tools.translation;
  const response = await models.completeSimple(model, { systemPrompt: "Translate anime titles into their official or community-accepted localized title. Return only the translated text, without quotes or explanations.",
    messages: [{ role: "user", content: `Translate into ${language}:\n${JSON.stringify(title)}`, timestamp: 0 }] }, { signal });
  signal?.throwIfAborted();
  const translated = translatedText(response);
  const result = translationResult(title, translated ?? title, translated ? "llm" : "untranslated", payer);
  return { ...result, usage: response.usage };
}

function translatedText(message: AssistantMessage): string | undefined {
  if (message.stopReason === "error" || message.stopReason === "aborted") return undefined;
  const text = message.content.flatMap((part) => part.type === "text" ? [part.text] : []).join("").trim().replace(/^["']+|["']+$/g, "");
  return text === "" ? undefined : text;
}
