import assert from "node:assert/strict";
import test from "node:test";
import { getOrThrow } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { fixture } from "./native-tool-fixture.ts";

void test("the frozen route retains the native itinerary reference and all 500 ordered point identities", async () => {
  const points = Array.from({ length: 500 }, (_, index) => ({ id: `point-${String(index).padStart(4, "0")}`,
    name: "Station", bangumi_id: "123", screenshot_url: "", latitude: 35, longitude: 139 }));
  const { repo, session, toolContext } = await fixture(() => Promise.resolve(Response.json({ ordered_points: points, point_count: 500,
    timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "normal" } })));
  const branch = await session.createBranch("main", null, BACKGROUND_CONTEXT);
  const ref = await branch.appendMessage({ role: "toolResult", toolCallId: "seed", toolName: "search_bangumi", timestamp: 0,
    isError: false, content: [], details: { kind: "bangumi", anime_id: "123", rows: points, partial: false } }, BACKGROUND_CONTEXT);
  const provider = fauxProvider();
  provider.setResponses([fauxAssistantMessage(fauxToolCall("plan_route", { search_result_ref: ref }), { stopReason: "toolUse" }), fauxAssistantMessage("Route ready.")]);
  const models = createModels();
  models.setProvider(provider.provider);
  const { harness } = await createPilgrimageHarness({ session, toolContext, models, model: provider.getModel() }, BACKGROUND_CONTEXT);
  try {
    const lane = await harness.lane("main", BACKGROUND_CONTEXT);
    getOrThrow(await lane.prompt("Plan a route", undefined, BACKGROUND_CONTEXT));
    const entry = (await lane.findEntries({ type: "message" }, BACKGROUND_CONTEXT))
      .find((item) => item.type === "message" && item.message.role === "toolResult" && item.message.toolName === "plan_route");
    assert.ok(entry?.type === "message" && entry.message.role === "toolResult");
    assert.ok(entry.message.details && typeof entry.message.details === "object");
    const frozen = Reflect.get(entry.message.details, "frozenSummary") as unknown;
    assert.equal(frozen, `[plan_route: itinerary_ref=${entry.id}, ordered_stops=${JSON.stringify(points.map((point) => point.id))}]`);
    assert.ok(entry.message.content[0]?.type === "text");
    assert.match(entry.message.content[0].text, /"total_minutes":10/);
    assert.deepEqual(Reflect.get(entry.message.details, "itinerary"), { ordered_points: points, point_count: 500,
      timed_itinerary: { stops: [], legs: [], total_minutes: 10, total_distance_m: 0, pacing: "normal" } });
  } finally { await harness.close(BACKGROUND_CONTEXT); await repo.close(BACKGROUND_CONTEXT); }
});
