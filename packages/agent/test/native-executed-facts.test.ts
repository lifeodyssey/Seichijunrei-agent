import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

const point = { id: "point-1", name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 139 };

void test("a native hook records the pacing actually executed rather than the original model arguments", async () => {
  const requests: Request[] = [];
  const { repo, session, toolContext } = await fixture((request) => {
    requests.push(request);
    return Promise.resolve(Response.json({ ordered_points: [point], point_count: 1,
      timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "chill" } }));
  });
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "seed", toolName: "search_bangumi", timestamp: 0,
    isError: false, content: [], details: { kind: "bangumi", anime_id: "123", rows: [point], partial: false } }, BACKGROUND_CONTEXT);
  const observed: string[] = [];
  const provider = fauxProvider();
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("plan_route", { search_result_ref: ref, pacing: "packed" }), { stopReason: "toolUse" }),
    (context) => { observed.push(JSON.stringify(context.messages)); return fauxAssistantMessage("Route ready."); },
  ]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, BACKGROUND_CONTEXT);
  harness.hooks.on("before_tool", () => ({ args: { search_result_ref: ref, pacing: "chill" } }));
  try {
    const lane = await harness.lane("main", BACKGROUND_CONTEXT);
    getOrThrow(await lane.prompt("Plan a route", undefined, BACKGROUND_CONTEXT));
    assert.deepEqual(await requests[0]?.json(), { point_ids: ["point-1"], pacing: "chill" });
    assert.match(observed[0] ?? "", /User hard constraint: chill pacing/);
    assert.doesNotMatch(observed[0] ?? "", /User hard constraint: packed pacing/);
    const entry = (await lane.findEntries({ type: "message" }, BACKGROUND_CONTEXT))
      .find((item) => item.type === "message" && item.message.role === "toolResult" && item.message.toolName === "plan_route");
    assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
    assert.ok(entry.message.details && typeof entry.message.details === "object");
    assert.deepEqual(Reflect.get(entry.message.details, "executedFacts"), { pacing: "chill" });
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
});
