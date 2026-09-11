import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { searchBangumi, translateAnimeTitle } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";
import { failCommitsAfterEffect } from "./native-crash-fixture.ts";

void test("safe replay reuses invocation identity so an invocation-keyed business reservation charges once", async () => {
  let calls = 0;
  const reservations: string[] = [];
  const charges = new Set<string>();
  const { repo, session, toolContext } = await fixture(() => { calls += 1; return Promise.resolve(Response.json({ rows: [], synced_at: "today" })); });
  toolContext.reserveToolUsage = (id) => { reservations.push(id); charges.add(id); return Promise.resolve(); };
  const fault = failCommitsAfterEffect(session, () => calls > 0);
  const first = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "123" }), { stopReason: "toolUse" })], [searchBangumi]);
  await assert.rejects((await first.harness.lane("main", BACKGROUND_CONTEXT)).prompt("Search", undefined, BACKGROUND_CONTEXT));
  fault.mock.restore();
  await first.harness.close(BACKGROUND_CONTEXT);
  toolContext.session = await repo.open(session.metadata, BACKGROUND_CONTEXT);
  const restored = await harnessFor(toolContext, [fauxAssistantMessage("Recovered")], [searchBangumi]);
  assert.ok(restored.open[0]);
  await (await restored.harness.lane("main", BACKGROUND_CONTEXT)).drive({ operationId: restored.open[0].operationId, waitForRetry: false }, BACKGROUND_CONTEXT);
  assert.equal(calls, 2);
  assert.equal(reservations.length, 2);
  assert.equal(reservations[0], reservations[1]);
  assert.equal(charges.size, 1);
  await restored.harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a revoked budget prevents a crash recovery from repeating safe external work", async () => {
  let calls = 0;
  const { repo, session, toolContext } = await fixture(() => { calls += 1; return Promise.resolve(Response.json({ rows: [], synced_at: "today" })); });
  const fault = failCommitsAfterEffect(session, () => calls > 0);
  const first = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "123" }), { stopReason: "toolUse" })], [searchBangumi]);
  await assert.rejects((await first.harness.lane("main", BACKGROUND_CONTEXT)).prompt("Search", undefined, BACKGROUND_CONTEXT));
  fault.mock.restore();
  await first.harness.close(BACKGROUND_CONTEXT);
  toolContext.session = await repo.open(session.metadata, BACKGROUND_CONTEXT);
  toolContext.reserveToolUsage = () => Promise.reject(new Error("budget revoked"));
  const restored = await harnessFor(toolContext, [fauxAssistantMessage("Budget unavailable")], [searchBangumi]);
  assert.ok(restored.open[0]);
  await (await restored.harness.lane("main", BACKGROUND_CONTEXT)).drive({ operationId: restored.open[0].operationId, waitForRetry: false }, BACKGROUND_CONTEXT);
  assert.equal(calls, 1);
  await restored.harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("native never replay marks interrupted translation as an error without retrying its effect", async () => {
  let calls = 0;
  const { repo, session, toolContext } = await fixture(() => { calls += 1; return Promise.resolve(Response.json({ outcome: "resolved", match: { bangumi_id: "1", title: "Title", title_cn: "标题" } })); });
  const fault = failCommitsAfterEffect(session, () => calls > 0);
  const first = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("translate_anime_title", { title: "Title", target_language: "zh" }), { stopReason: "toolUse" })], [translateAnimeTitle]);
  await assert.rejects((await first.harness.lane("main", BACKGROUND_CONTEXT)).prompt("Translate", undefined, BACKGROUND_CONTEXT));
  fault.mock.restore();
  await first.harness.close(BACKGROUND_CONTEXT);
  toolContext.session = await repo.open(session.metadata, BACKGROUND_CONTEXT);
  const restored = await harnessFor(toolContext, [fauxAssistantMessage("Translation was interrupted")], [translateAnimeTitle]);
  assert.ok(restored.open[0]);
  await (await restored.harness.lane("main", BACKGROUND_CONTEXT)).drive({ operationId: restored.open[0].operationId, waitForRetry: false }, BACKGROUND_CONTEXT);
  const entries = await toolContext.session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.isError));
  assert.equal(calls, 1);
  await restored.harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
