import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { planRoute, respond, projectPilgrimage } from "@animichi/agent/tools";
import { executeTool, fixture, harnessFor } from "./native-tool-fixture.ts";

const point = { id: "1", name: "Station", bangumi_id: "1", screenshot_url: "", latitude: 35, longitude: 139, city: "Uji" };
const itinerary = { ordered_points: [point], point_count: 1, timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "normal" } };

for (const changed of [{ ...point, id: "invented" }, { ...point, latitude: 40 }]) {
  void test(`a route cannot fabricate an offered point's identity or coordinates: ${JSON.stringify(changed)}`, async () => {
    const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ ...itinerary, ordered_points: [changed] })));
    const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
    const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "search", toolName: "search_bangumi", timestamp: 0, isError: false, content: [], details: { kind: "bangumi", anime_id: "1", rows: [point], partial: false } }, BACKGROUND_CONTEXT);
    const { message } = await executeTool(toolContext, "plan_route", { search_result_ref: ref }, [planRoute]);
    assert.equal(message.isError, true);
    assert.match(JSON.stringify(message.content), /unoffered route point/);
    await repo.close(BACKGROUND_CONTEXT);
  });
}

void test("a validated route response uses the current itinerary and clears an old clarification", async () => {
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json(itinerary)));
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  await branch.appendMessage({ role: "toolResult", toolCallId: "clarify", toolName: "search_nearby", timestamp: 0, isError: false, content: [], details: { reason: "missing_location", candidates: [] } }, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "search", toolName: "search_bangumi", timestamp: 0, isError: false, content: [], details: { kind: "bangumi", anime_id: "1", rows: [point], partial: false } }, BACKGROUND_CONTEXT);
  const { harness } = await harnessFor(toolContext, [fauxAssistantMessage(fauxToolCall("plan_route", { search_result_ref: ref }), { stopReason: "toolUse" }), fauxAssistantMessage(fauxToolCall("respond", { kind: "route", message: "Walk to the station" }), { stopReason: "toolUse" })], [planRoute, respond]);
  await (await harness.lane("main", BACKGROUND_CONTEXT)).prompt("Plan a route", undefined, BACKGROUND_CONTEXT);
  const entries = await session.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  const answer = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "respond");
  assert.ok(answer?.type === "message" && answer.message.role === "toolResult");
  assert.equal(answer.message.isError, false);
  assert.equal(answer.terminate, true);
  assert.match(JSON.stringify(answer.message.details), /plan_route/);
  assert.equal(projectPilgrimage(entries).clarification, undefined);
  await harness.close(BACKGROUND_CONTEXT);
  await repo.close(BACKGROUND_CONTEXT);
});
