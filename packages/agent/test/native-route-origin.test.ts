import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { planRoute } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

const POINT = { id: "origin-point", name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 139 };

void test("native route planning sends the caller's exact shared origin to catalog", async (context) => {
  const requests: Request[] = [];
  const { repo, session, toolContext } = await fixture((request) => {
    requests.push(request);
    return Promise.resolve(Response.json({ ordered_points: [POINT], point_count: 1,
      timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "normal" } }));
  });
  context.after(() => repo.close(BACKGROUND_CONTEXT));
  toolContext.origin = { lat: 0, lng: 139.456789 };
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "search", toolName: "search_bangumi", timestamp: 0,
    isError: false, content: [], details: { kind: "bangumi", anime_id: "123", rows: [POINT], partial: false } }, BACKGROUND_CONTEXT);
  const { message } = await executeTool(toolContext, "plan_route", { search_result_ref: ref }, [planRoute]);
  assert.equal(message.isError, false);
  assert.equal(requests.length, 1);
  assert.deepEqual(await requests[0]?.json(), { point_ids: [POINT.id], origin: { lat: 0, lng: 139.456789 } });
});
