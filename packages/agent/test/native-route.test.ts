import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { planRoute, readSearchResult } from "@animichi/agent/tools";
import { fixture, harnessFor } from "./native-tool-fixture.ts";

const POINT = { id: "point-1", name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 139 };

void test("routing resolves a native result ref and sends exactly its offered point ids", async () => {
  const requests: Request[] = [];
  const { repo, session, toolContext } = await fixture((request) => {
    requests.push(request);
    return Promise.resolve(Response.json({ ordered_points: [POINT], point_count: 1,
      timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "normal" } }));
  });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "first", toolName: "search_bangumi", timestamp: 0,
    isError: false, content: [{ type: "text", text: "Stored points" }],
    details: { kind: "bangumi", anime_id: "123", rows: [POINT], partial: false } }, BACKGROUND_CONTEXT);
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("plan_route", { search_result_ref: ref, pacing: "normal" }), { stopReason: "toolUse" }), fauxAssistantMessage("Route ready.")], [planRoute]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Route", undefined, BACKGROUND_CONTEXT);
  assert.equal(requests.length, 1);
  assert.deepEqual(await requests[0]?.json(), { point_ids: ["point-1"], pacing: "normal" });
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  assert.ok(entries.some((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "plan_route" && !entry.message.isError));
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a native ref on another branch is rejected without copying or re-executing catalog results", async () => {
  const { repo, session } = await fixture(() => Promise.reject(new Error("no catalog calls expected")));
  const other = await session.createBranch("other", null, BACKGROUND_CONTEXT);
  const ref = await other.appendMessage({ role: "toolResult", toolCallId: "first", toolName: "search_bangumi", timestamp: 0,
    isError: false, content: [], details: { kind: "bangumi", anime_id: "123", rows: [POINT], partial: false } }, BACKGROUND_CONTEXT);
  await session.createBranch("main", null, BACKGROUND_CONTEXT);
  assert.equal(await readSearchResult(session, "main", ref, BACKGROUND_CONTEXT), undefined);
  const stranger = await repo.create({}, BACKGROUND_CONTEXT);
  assert.equal(await readSearchResult(stranger, "main", ref, BACKGROUND_CONTEXT), undefined);
  await repo.close(BACKGROUND_CONTEXT);
});
