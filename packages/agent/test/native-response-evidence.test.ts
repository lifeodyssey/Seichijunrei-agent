import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { respond, searchNearby } from "@animichi/agent/tools";
import { executeTool, fixture, harnessFor } from "./native-tool-fixture.ts";

void test("respond carries the offered clarification id and rejects a stale reason", async () => {
  const { repo, session, toolContext } = await fixture(() => { throw new Error("No catalog call"); });
  const { harness } = await harnessFor(toolContext, [
    fauxAssistantMessage(fauxToolCall("search_nearby", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("respond", { kind: "clarify", reason: "unknown_place", message: "Wrong" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("respond", { kind: "clarify", reason: "missing_location", message: "Share a place" }), { stopReason: "toolUse" }),
  ], [searchNearby, respond]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Near me", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.isError));
  const answer = [...entries].sort((left, right) => right.seq - left.seq).find((entry) => entry.type === "message" && entry.message.role === "toolResult");
  assert.ok(answer?.type === "message" && answer.message.role === "toolResult");
  assert.match(JSON.stringify(answer.message.details), /missing_location/);
  assert.equal(answer.terminate, true);
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("respond rejects search data from a previous user turn", async () => {
  const { repo, session, toolContext } = await fixture(() => { throw new Error("No catalog call"); });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  await branch.appendMessage({ role: "toolResult", toolName: "search_nearby", toolCallId: "old", timestamp: 0, content: [], isError: false, details: { kind: "nearby", anime_id: null, rows: [], partial: false } }, BACKGROUND_CONTEXT);
  const { message } = await executeTool(toolContext, "respond", { kind: "search", message: "Old results" }, [respond]);
  assert.equal(message.isError, true);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("respond returns the public greeting shape without a fabricated domain result", async () => {
  const { repo, toolContext } = await fixture(() => { throw new Error("No catalog call"); });
  const { message } = await executeTool(toolContext, "respond", { kind: "greeting", message: "Hello" }, [respond]);
  assert.deepEqual(message.details, { intent: "greet_user", message: "Hello", data: {} });
  await repo.close(BACKGROUND_CONTEXT);
});
