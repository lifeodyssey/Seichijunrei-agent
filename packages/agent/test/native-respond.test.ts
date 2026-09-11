import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { respond, searchBangumi } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

void test("respond leaves an invalid answer as a native tool error so the model can repair it", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.reject(new Error("No catalog calls")));
  const { harness, provider } = await harnessFor(toolContext, [
    fauxAssistantMessage(fauxToolCall("respond", { kind: "route", message: "Here is a route" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("respond", { kind: "qa", message: "Please search for points first." }), { stopReason: "toolUse" }),
  ], [respond]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Route", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  assert.equal(provider.state.callCount, 2);
  assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.isError));
  assert.ok(entries.some((entry) => entry.type === "message" && entry.terminate === true && entry.message.role === "toolResult" && !entry.message.isError));
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("respond in a mixed batch cannot terminate unfinished domain work", async () => {
  const { repo, toolContext } = await fixture(() => Promise.resolve(Response.json({ rows: [], synced_at: "2026-09-10" })));
  const { harness, provider } = await harnessFor(toolContext, [
    fauxAssistantMessage([fauxToolCall("respond", { kind: "qa", message: "Starting." }), fauxToolCall("search_bangumi", { bangumi_id: "123" })], { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("respond", { kind: "search", message: "No points found." }), { stopReason: "toolUse" }),
  ], [respond, searchBangumi]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Find", undefined, BACKGROUND_CONTEXT);
  assert.equal(provider.state.callCount, 2);
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
