import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall, type Message } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

const resolved = { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates: [
  { bangumi_id: "485", title: "First title with a long catalog description ".repeat(2) },
  { bangumi_id: "2907", title: "Second title with a long catalog description ".repeat(2) },
] };
const summary = '[resolve_anime: ambiguous, ordered_candidates=["485","2907"]]';

function toolTexts(messages: readonly Message[]) {
  return messages.flatMap((message) => message.role === "toolResult"
    ? message.content.flatMap((part) => part.type === "text" ? [part.text] : []) : []);
}

void test("native context keeps this turn verbatim, applies stored summaries next turn, and never rewrites entries", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json(resolved)));
  const contexts: string[][] = [];
  const provider = fauxProvider();
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Lucky Star" }), { stopReason: "toolUse" }),
    (context) => { contexts.push(toolTexts(context.messages)); return fauxAssistantMessage("Which one?"); },
    (context) => { contexts.push(toolTexts(context.messages)); return fauxAssistantMessage("The second one is available."); },
  ]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, BACKGROUND_CONTEXT);
  try {
    const lane = await harness.lane("main", BACKGROUND_CONTEXT);
    getOrThrow(await lane.prompt("Find Lucky Star", undefined, BACKGROUND_CONTEXT));
    getOrThrow(await lane.prompt("What about the second one?", undefined, BACKGROUND_CONTEXT));
    assert.deepEqual(contexts, [[JSON.stringify(resolved)], [summary]]);
    const entry = (await lane.findEntries({ type: "message" }, BACKGROUND_CONTEXT))
      .find((item) => item.type === "message" && item.message.role === "toolResult");
    assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
    assert.deepEqual(entry.message.content, [{ type: "text", text: JSON.stringify(resolved) }]);
    assert.ok(entry.message.details && typeof entry.message.details === "object");
    const { execution, ...details } = entry.message.details as Record<string, unknown>;
    assert.ok(execution);
    assert.deepEqual(details, { ...resolved, frozenSummary: summary, executedFacts: { retainedEntity: "Lucky Star" } });
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
});
