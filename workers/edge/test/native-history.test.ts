import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { createCatalogClient } from "@animichi/agent/tools";
import { readHistoryStorage } from "../src/agent/views/history.ts";

void test("native history pairs executed args with this page's original call and keeps readonly storage usable", async () => {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({ id: "history-session" }, context);
  const storage = session;
  const provider = fauxProvider(); provider.setResponses([fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Original" }), { stopReason: "toolUse" }), fauxAssistantMessage("No match")]);
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, models, model: provider.getModel(), toolContext: { session, branch: "main", locale: "en",
    catalog: createCatalogClient(() => Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" }))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve() } }, context);
  harness.hooks.on("before_tool", () => ({ args: { title: "Actually executed" } }));
  getOrThrow(await (await harness.lane("main", context)).prompt("Find it", undefined, context));
  const before = await storage.getStats(context);
  const first = await readHistoryStorage(storage, { offset: 0, limit: 2 }, context);
  assert.equal(first.messages[0]?.role, "user");
  assert.match(first.messages[1]?.content ?? "", /Original/);
  assert.equal(first.steps?.length, 1);
  assert.deepEqual(JSON.parse(first.steps[0]?.params ?? "null"), { title: "Actually executed" });
  assert.equal(first.next_offset, 2);
  assert.equal(first.run?.status, "succeeded");
  const next = await readHistoryStorage(storage, { offset: 2, limit: 2 }, context);
  assert.equal(next.messages[0]?.content, "No match");
  assert.deepEqual(next.steps, []);
  assert.equal(next.next_offset, null);
  assert.deepEqual(await storage.getStats(context), before);
  await harness.close(context);
});

void test("equal text and timestamps retain distinct native operation identities in history", async (t) => {
  const repo = new MemorySessionRepo({ now: () => 0 });
  const session = await repo.create({ id: "same-time" }, context);
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage("Same answer"), fauxAssistantMessage("Same answer")]);
  const models = createModels(); models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, models, model: provider.getModel(), toolContext: {
    session, branch: "main", locale: "en", catalog: createCatalogClient(() => Promise.reject(new Error("No catalog call"))),
    assertAuthorized: () => Promise.resolve(), reserveToolUsage: () => Promise.resolve(),
  } }, context);
  t.after(() => harness.close(context));
  const lane = await harness.lane("main", context);
  getOrThrow(await lane.prompt("Same question", undefined, context));
  const first = await readHistoryStorage(session, { offset: 0, limit: 100 }, context);
  const firstId = first.run?.run_id;
  assert.ok(firstId);
  getOrThrow(await lane.prompt("Same question", undefined, context));
  const final = await readHistoryStorage(session, { offset: 0, limit: 100 }, context);
  const secondId = final.run?.run_id;
  assert.ok(secondId);
  assert.notEqual(firstId, secondId);
  assert.deepEqual(final.messages.map((message) => message.operation_id), [firstId, firstId, secondId, secondId]);
  assert.deepEqual(final.messages.map((message) => message.content), ["Same question", "Same answer", "Same question", "Same answer"]);
  assert.deepEqual(final.messages.map((message) => message.created_at), Array(4).fill(new Date(0).toISOString()));
});
