import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

void test("place ambiguity freezes every ordered candidate and retains the actual location argument", async () => {
  const candidates = ["b", "a"].map((id) => ({ id, label: `Long offered place ${id} `.repeat(10), name: id,
    lat: 35, lng: 139, kind: "city", source: "seed", effective_radius_m: 1200 }));
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ candidates })));
  const provider = fauxProvider();
  const seen: string[] = [];
  provider.setResponses([fauxAssistantMessage(fauxToolCall("search_nearby", { location: "The real location" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Which place?"), (request) => { seen.push(JSON.stringify(request.messages)); return fauxAssistantMessage("Still available."); }]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, context);
  try {
    const lane = await harness.lane("main", context);
    getOrThrow(await lane.prompt("Find a place", undefined, context));
    getOrThrow(await lane.prompt("Which places?", undefined, context));
    const entry = (await session.findEntries({ type: "message" }, context)).find((entry) => entry.type === "message" && entry.message.role === "toolResult");
    assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
    const details: unknown = entry.message.details;
    assert.ok(details && typeof details === "object");
    assert.equal(Reflect.get(details, "frozenSummary"), '[search_nearby: ambiguous, ordered_candidates=["b","a"]]');
    assert.deepEqual(Reflect.get(details, "executedFacts"), { retainedEntity: "The real location" });
    assert.match(seen.join("\n"), /candidate_ids=\[b, a\]/);
    assert.match(JSON.stringify(entry.message.content), /Long offered place b/);
  } finally { await harness.close(context); await repo.close(context); }
});

void test("a web search keeps its typed results payload and bounded source content verbatim across turns", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("No catalog call expected")));
  toolContext.webFetch = () => Promise.resolve(new Response('<div class="result"><a class="result__a" href="https://example.com/route">Route</a><a class="result__snippet">Source description</a></div>'));
  const provider = fauxProvider();
  const seen: unknown[] = [];
  provider.setResponses([fauxAssistantMessage(fauxToolCall("web_search", { query: "Route" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Found."), (request) => { seen.push(request.messages.find((message) => message.role === "toolResult")?.content); return fauxAssistantMessage("Sources remain."); }]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, context);
  try {
    const lane = await harness.lane("main", context);
    getOrThrow(await lane.prompt("Search", undefined, context));
    getOrThrow(await lane.prompt("Show sources", undefined, context));
    const entry = (await session.findEntries({ type: "message" }, context)).find((entry) => entry.type === "message" && entry.message.role === "toolResult");
    assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
    assert.ok(entry.message.details && typeof entry.message.details === "object");
    assert.ok(Array.isArray(Reflect.get(entry.message.details, "results")));
    assert.deepEqual(seen, [entry.message.content]);
  } finally { await harness.close(context); await repo.close(context); }
});
