import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection, SelectionRefused } from "@animichi/agent/selection";
import { createCatalogClient } from "@animichi/agent/tools";
import { POINT_A, POINT_B, itinerary, selectionFixture } from "./native-selection-fixture.ts";

void test("selected points retain first-occurrence order and only a valid coordinate origin reaches catalog", async () => {
  const { repo, entries } = await selectionFixture("search_bangumi", { kind: "bangumi", anime_id: "123", rows: [POINT_A, POINT_B], partial: false });
  const requests: Request[] = [];
  const catalog = createCatalogClient((request) => { requests.push(request); return Promise.resolve(Response.json(itinerary([POINT_B, POINT_A]))); });
  const result = await executeSelection({ of: "points", pointIds: [" b ", "a", "b", ""], origin: "35.8,139.2", locale: "en" }, entries, catalog, BACKGROUND_CONTEXT);
  assert.deepEqual(await requests[0]?.json(), { point_ids: ["b", "a"], origin: { lat: 35.8, lng: 139.2 } });
  assert.equal(requests.length, 1);
  assert.equal(result.response.success, true);
  assert.deepEqual(result.itinerary?.ordered_points.map((point) => point.id), ["b", "a"]);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("a point never offered on the native branch is refused before any catalog request", async () => {
  const { repo, entries } = await selectionFixture("search_bangumi", { kind: "bangumi", anime_id: "123", rows: [POINT_A], partial: false });
  const catalog = createCatalogClient(() => Promise.reject(new Error("unoffered points must not execute")));
  await assert.rejects(executeSelection({ of: "points", pointIds: ["invented"], origin: null, locale: "en" }, entries, catalog, BACKGROUND_CONTEXT), SelectionRefused);
  await repo.close(BACKGROUND_CONTEXT);
});

void test("catalog cannot replace a selected point's offered coordinates", async () => {
  const { repo, entries } = await selectionFixture("search_bangumi", { kind: "bangumi", anime_id: "123", rows: [POINT_A], partial: false });
  const catalog = createCatalogClient(() => Promise.resolve(Response.json(itinerary([{ ...POINT_A, latitude: 50 }]))));
  await assert.rejects(executeSelection({ of: "points", pointIds: ["a"], origin: null, locale: "en" }, entries, catalog, BACKGROUND_CONTEXT), /unoffered route point/);
  await repo.close(BACKGROUND_CONTEXT);
});
