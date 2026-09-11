import test from "node:test";
import assert from "node:assert/strict";
import type { JsonValue } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection, SELECTION_ENTRY, selectionEntryData } from "@animichi/agent/selection";
import { planRoute } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";
import { POINT_A, POINT_B, itinerary } from "./native-selection-fixture.ts";

const cases: { name: string; tool: string; details: JsonValue; choices: string[]; responses: unknown[]; pointIds: string[] }[] = [
  { name: "place", tool: "search_nearby", details: { reason: "place_ambiguity", candidates: [{ id: "station", title: "Station", lat: 35, lng: 139 }] },
    choices: ["station"], responses: [{ rows: [POINT_A] }, itinerary([POINT_A])], pointIds: ["a"] },
  { name: "multiple works", tool: "resolve_anime", details: { outcome: "needs_disambiguation", reason: "anime_ambiguity", candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Second" }] },
    choices: ["123", "456"], responses: [{ rows: [POINT_A], synced_at: "2026-09-10" }, { rows: [POINT_B], synced_at: "2026-09-10" }, itinerary([POINT_A, POINT_B]), itinerary([POINT_A, POINT_B])], pointIds: ["a", "b"] },
];

for (const scenario of cases) {
  void test(`a committed ${scenario.name} selection can be replanned directly through its native entry reference`, async () => {
    const responses = [...scenario.responses], requests: Request[] = [];
    const { repo, session, toolContext } = await fixture((request) => { requests.push(request); return Promise.resolve(Response.json(responses.shift())); });
    const branch = await session.createBranch("main", null, context);
    const offerId = await branch.appendMessage({ role: "toolResult", toolCallId: "offer", toolName: scenario.tool, isError: false, timestamp: 0, content: [], details: scenario.details }, context);
    const offer = await session.getEntry(offerId, context);
    assert.ok(offer);
    const result = await executeSelection({ of: "candidates", candidateIds: scenario.choices, clarificationId: offer.seq, locale: "en" }, await branch.findEntries(undefined, context), toolContext.catalog, context);
    assert.equal(result.status, "ok");
    const ref = await branch.appendCustomEntry(SELECTION_ENTRY, selectionEntryData("selection-to-replan", result), context);
    const { message } = await executeTool(toolContext, "plan_route", { search_result_ref: ref, pacing: "chill" }, [planRoute]);
    assert.deepEqual(await requests.at(-1)?.json(), { point_ids: scenario.pointIds, pacing: "chill" });
    assert.equal(message.isError, false);
    const reopened = await repo.open(session.metadata, context);
    assert.equal((await reopened.findEntries({ customType: SELECTION_ENTRY }, context)).length, 1);
    await repo.close(context);
  });
}
