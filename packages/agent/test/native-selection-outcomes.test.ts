import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection, SelectionRefused } from "@animichi/agent/selection";
import { createCatalogClient } from "@animichi/agent/tools";
import { POINT_A, itinerary, selectionFixture } from "./native-selection-fixture.ts";

for (const origin of ["Tokyo", ",", "35,", "91,139", "NaN,139", "35,181"]) {
  void test(`the selected route ignores a non-coordinate origin ${origin}`, async () => {
    const { repo, entries } = await selectionFixture("search_bangumi", { kind: "bangumi", anime_id: "123", rows: [POINT_A], partial: false });
    const requests: Request[] = [];
    const catalog = createCatalogClient((request) => { requests.push(request); return Promise.resolve(Response.json(itinerary([POINT_A]))); });
    await executeSelection({ of: "points", pointIds: ["a"], origin, locale: "en" }, entries, catalog, context);
    assert.deepEqual(await requests[0]?.json(), { point_ids: ["a"] });
    await repo.close(context);
  });
}

void test("a route with no points is a failure rather than a successful zero-stop itinerary", async () => {
  const { repo, entries } = await selectionFixture("plan_route", { itinerary: itinerary([POINT_A]), source_ref: "earlier-search" });
  const catalog = createCatalogClient(() => Promise.resolve(Response.json(itinerary([]))));
  const result = await executeSelection({ of: "points", pointIds: ["a"], origin: null, locale: "en" }, entries, catalog, context);
  assert.equal(result.response.success, false);
  assert.equal(result.itinerary, undefined);
  await repo.close(context);
});

void test("a selection above the route limit is refused without sending an oversized catalog request", async () => {
  const points = Array.from({ length: 501 }, (_, index) => ({ ...POINT_A, id: String(index) }));
  const { repo, entries } = await selectionFixture("search_bangumi", { kind: "bangumi", anime_id: "123", rows: points, partial: false });
  const catalog = createCatalogClient(() => Promise.reject(new Error("Oversized request must not execute")));
  assert.equal((await executeSelection({ of: "points", pointIds: points.map((point) => point.id), origin: null, locale: "en" }, entries, catalog, context)).status, "too_large");
  await repo.close(context);
});

void test("offered place choices without coordinates are refused rather than geocoded again", async () => {
  const { repo, entries, revision } = await selectionFixture("search_nearby", { reason: "place_ambiguity", candidates: [{ id: "place", title: "Place" }] });
  const catalog = createCatalogClient(() => Promise.reject(new Error("No geocoding")));
  await assert.rejects(executeSelection({ of: "candidates", candidateIds: ["place"], clarificationId: revision, locale: "en" }, entries, catalog, context), { message: "This place choice expired; please try again." });
  await repo.close(context);
});

void test("a current place clarification still requires one offered choice", async () => {
  const { repo, entries, revision } = await selectionFixture("search_nearby", { reason: "place_ambiguity", candidates: [{ id: "a", title: "A" }, { id: "b", title: "B" }] });
  const catalog = createCatalogClient(() => Promise.reject(new Error("No catalog before validation")));
  await assert.rejects(executeSelection({ of: "candidates", candidateIds: ["a", "b"], clarificationId: revision, locale: "en" }, entries, catalog, context), { message: "This clarification requires a different response mode." });
  await assert.rejects(executeSelection({ of: "candidates", candidateIds: ["unknown"], clarificationId: revision, locale: "en" }, entries, catalog, context), SelectionRefused);
  await repo.close(context);
});
