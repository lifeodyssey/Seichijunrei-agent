import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { searchNearby, projectPilgrimage } from "@animichi/agent/tools";
import { executeTool, fixture } from "./native-tool-fixture.ts";

const place = { id: "tokyo", label: "Tokyo", name: "Tokyo", lat: 35, lng: 139, kind: "city", source: "seed" };

for (const scenario of [
  { name: "unknown place", candidates: [], expected: { reason: "unknown_place", candidates: [] } },
  { name: "overly broad prefecture", candidates: [{ ...place, kind: "prefecture" }], expected: { reason: "place_too_broad", candidates: [] } },
  { name: "ambiguous places", candidates: [place, { ...place, id: "tokyo-2", label: "Other Tokyo", lat: 36, effective_radius_m: 1200 }], expected: { reason: "place_ambiguity", candidates: [{ id: "tokyo", title: "Tokyo", lat: 35, lng: 139 }, { id: "tokyo-2", title: "Other Tokyo", lat: 36, lng: 139, effective_radius_m: 1200 }] } },
]) {
  void test(`nearby preserves ${scenario.name} as an offered clarification`, async () => {
    const { repo, toolContext } = await fixture(() => Promise.resolve(Response.json({ candidates: scenario.candidates })));
    const { message: result, entries } = await executeTool(toolContext, "search_nearby", { location: "Tokyo" }, [searchNearby]);
    assert.equal(result.isError, false);
    assert.deepEqual(result.details, scenario.expected);
    assert.equal(projectPilgrimage(entries).clarification?.reason, scenario.expected.reason);
    await repo.close(BACKGROUND_CONTEXT);
  });
}

for (const radius of [undefined, 1200]) {
  void test(`one offered place uses its coordinates and ${String(radius ?? "default")} radius`, async () => {
    const requests: Request[] = [];
    const responses = [Response.json({ candidates: [{ ...place, effective_radius_m: radius }] }), Response.json({ rows: [] })];
    const { repo, toolContext } = await fixture((request) => { requests.push(request); return Promise.resolve(responses.shift() ?? Response.error()); });
    const { message: result } = await executeTool(toolContext, "search_nearby", { location: "Tokyo" }, [searchNearby]);
    assert.equal(result.isError, false);
    assert.deepEqual(await requests[1]?.json(), { lat: 35, lng: 139, radius_m: radius ?? 5000 });
    await repo.close(BACKGROUND_CONTEXT);
  });
}
