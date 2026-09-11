import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { operationResult } from "@earendil-works/pi-agent-core/harness/session";
import { fixture, harnessFor } from "../../../packages/agent/test/native-tool-fixture.ts";
import { resolveAnime } from "@animichi/agent/tools";
import { readHistoryStorage } from "../src/agent/views/history.ts";

async function runningOperation() {
  const paused = Promise.withResolvers<boolean>();
  const release = Promise.withResolvers<boolean>();
  const resources = await fixture(() => Promise.resolve(Response.json({ outcome: "not_found", reason: "anime_not_found" })));
  const { harness } = await harnessFor(resources.toolContext, [
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Find it" }), { stopReason: "toolUse" }),
    async () => { paused.resolve(true); await release.promise; return fauxAssistantMessage("Finished"); },
  ], [resolveAnime]);
  const lane = await harness.lane("main", context);
  await lane.accept({ kind: "prompt", prompt: "Find it", operationId: "race-operation" }, context);
  const drive = lane.drive({ operationId: "race-operation" }, context);
  await paused.promise;
  return { session: resources.session, finish: async () => { release.resolve(true); await drive; }, close: async () => { release.resolve(true); await drive; await harness.close(context); } };
}

void test("history retains operation identity when terminal commits after result enumeration", async (t) => {
  const run = await runningOperation();
  t.after(run.close);
  const scan = run.session.scanValues.bind(run.session);
  run.session.scanValues = async (key, ctx) => {
    const rows = await scan(key, ctx);
    if (key.namespace === "pi.result") await run.finish();
    return rows;
  };
  const history = await readHistoryStorage(run.session, { offset: 0, limit: 100 }, context);
  assert.equal(history.run?.status, "succeeded");
  assert.ok(history.messages.some((message) => message.role === "assistant"));
  assert.ok(history.messages.every((message) => message.operation_id === "race-operation"));
});

void test("history identifies a captured prefix when the operation finishes before metadata is read", async (t) => {
  const run = await runningOperation();
  t.after(run.close);
  const scan = run.session.scanBranch.bind(run.session);
  run.session.scanBranch = async (query, ctx) => {
    const entries = await scan(query, ctx);
    await run.finish();
    return entries;
  };
  const history = await readHistoryStorage(run.session, { offset: 0, limit: 100 }, context);
  assert.equal(history.run?.status, "succeeded");
  assert.ok(history.messages.some((message) => message.role === "assistant"));
  assert.ok(history.messages.every((message) => message.content !== "Finished"));
  assert.ok(history.messages.every((message) => message.operation_id === "race-operation"));
});

void test("a later sibling branch result cannot claim messages on the displayed branch", async (t) => {
  const run = await runningOperation();
  t.after(run.close);
  await run.finish();
  const sibling = await run.session.createBranch("sibling", null, context);
  const entryId = await sibling.appendMessage(fauxAssistantMessage("Other branch"), context);
  await run.session.setValue(operationResult("sibling-operation"), {
    operationId: "sibling-operation", kind: "run", status: "completed", fromTipId: null,
    tipId: entryId, startedAt: 0, endedAt: 0,
  }, context);
  const history = await readHistoryStorage(run.session, { offset: 0, limit: 100 }, context);
  assert.ok(history.messages.every((message) => message.operation_id === "race-operation"));
  assert.ok(history.messages.every((message) => message.content !== "Other branch"));
});
