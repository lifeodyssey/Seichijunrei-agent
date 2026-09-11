import type { AgentHarnessTool } from "@earendil-works/pi-agent-core";
import type { ResolveOutcome } from "@animichi/contract/models";
import { Type } from "typebox";
import { authorizeInvocation, type PilgrimageToolContext } from "./tool-context.ts";
import { looksLikeWrongVariant } from "./title-variant-conflict.ts";

const parameters = Type.Object({ title: Type.String({ pattern: "\\S" }) }, { additionalProperties: false });

/** Resolution reads the catalog only; safe replay rechecks identity and invocation-keyed quota. */
export const resolveAnime: AgentHarnessTool<PilgrimageToolContext, typeof parameters> = {
  name: "resolve_anime", label: "Resolve an anime title", replay: "safe", parameters,
  description: "Resolve a title through the catalog. Preserve ambiguity and use only an offered bangumi_id.",
  async execute(_id, params, _update, tools, invocation, context) {
    await authorizeInvocation(tools, invocation, context);
    const resolved = await tools.catalog.resolve({ query: params.title.trim() }, { signal: context.abortSignal });
    const details = resolutionForTitle(resolved, params.title);
    return { content: [{ type: "text", text: JSON.stringify(details) }], details };
  },
};

function resolutionForTitle(result: ResolveOutcome, title: string): ResolveOutcome {
  if (result.outcome === "resolved" && looksLikeWrongVariant(title, [result.match.title, result.match.title_cn]))
    return { outcome: "not_found", reason: "anime_not_found" };
  return result;
}
