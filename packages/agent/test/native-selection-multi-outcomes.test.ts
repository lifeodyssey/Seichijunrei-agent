import test from "node:test";
import assert from "node:assert/strict";
import { ORPCError } from "@orpc/client";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection } from "@animichi/agent/selection";
import { createCatalogClient } from "@animichi/agent/tools";
import { POINT_A, itinerary, selectionFixture } from "./native-selection-fixture.ts";

for (const scenario of [
  { name: "empty works", data: { rows: [], synced_at: "2026-09-10" }, status: "empty" },
  { name: "incomplete upstream points", data: { rows: [POINT_A], partial: true, synced_at: "2026-09-10" }, status: "partial" },
  { name: "more than 500 merged points", data: { rows: Array.from({ length: 501 }, (_, index) => ({ ...POINT_A, id: String(index) })), synced_at: "2026-09-10" }, status: "too_large" },
]) {
  void test(`multi-work selection reports ${scenario.name} without attempting a route`, async () => {
    const { repo, entries, revision } = await selectionFixture("resolve_anime", { outcome: "needs_disambiguation", reason: "anime_ambiguity",
      candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Second" }] });
    const requests: Request[] = [];
    const catalog = createCatalogClient((request) => { requests.push(request); return Promise.resolve(Response.json(scenario.data)); });
    const result = await executeSelection({ of: "candidates", candidateIds: ["123"], clarificationId: revision, locale: "en" }, entries, catalog, context);
    assert.equal(result.status, scenario.status);
    assert.equal(result.response.success, false);
    assert.equal(result.itinerary, undefined);
    assert.equal(requests.length, 1);
    await repo.close(context);
  });
}

for (const scenario of [
  { name: "no itinerary", response: () => Response.json(itinerary([])), status: "error" },
  { name: "too many areas", response: () => Response.json(new ORPCError("ROUTE_TOO_MANY_CLUSTERS", { status: 422, data: { cluster_count: 5, max_clusters: 4 } }).toJSON(), { status: 422 }), status: "too_large" },
  { name: "too many points", response: () => Response.json(new ORPCError("ROUTE_TOO_MANY_POINTS", { status: 400, data: { point_count: 501, max_points: 500 } }).toJSON(), { status: 400 }), status: "too_large" },
  { name: "rejected route", response: () => Response.json(new ORPCError("BAD_REQUEST").toJSON(), { status: 400 }), status: "error" },
]) {
  void test(`multi-work selection exposes ${scenario.name} as a failed result`, async () => {
    const { repo, entries, revision } = await selectionFixture("resolve_anime", { outcome: "needs_disambiguation", reason: "anime_ambiguity",
      candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Second" }] });
    const responses = [Response.json({ rows: [POINT_A], synced_at: "2026-09-10" }), scenario.response()];
    const catalog = createCatalogClient(() => Promise.resolve(responses.shift() ?? Response.error()));
    const result = await executeSelection({ of: "candidates", candidateIds: ["123"], clarificationId: revision, locale: "en" }, entries, catalog, context);
    assert.equal(result.status, scenario.status);
    assert.equal(result.response.success, false);
    assert.equal(result.itinerary, undefined);
    await repo.close(context);
  });
}

void test("unavailable selected works disclose omissions and retain the pending clarification", async () => {
  const { repo, entries, revision } = await selectionFixture("resolve_anime", { outcome: "needs_disambiguation", reason: "anime_ambiguity",
    candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Second" }] });
  const catalog = createCatalogClient(() => Promise.resolve(Response.json(new ORPCError("WORK_NOT_FOUND", { status: 404, data: { bangumi_id: "123" } }).toJSON(), { status: 404 })));
  const result = await executeSelection({ of: "candidates", candidateIds: ["123", "456"], clarificationId: revision, locale: "en" }, entries, catalog, context);
  assert.equal(result.status, "error");
  assert.deepEqual(result.omitted, ["First", "Second"]);
  assert.equal(result.clarificationId, revision);
  assert.equal(result.response.success, false);
  await repo.close(context);
});
