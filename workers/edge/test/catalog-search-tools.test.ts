/**
 * W1-4 (#1253): `search_bangumi` and `search_nearby`, ported from
 * `catalog_tools.py::run_work_search` / `run_nearby_search`.
 *
 * The model gets a ref and a count; the rows go to the session. Every payload
 * here is a real catalog response shape (`test/doubles/catalog-payloads.ts`),
 * so the screenshot rewrite and the metadata derivation are exercised on the
 * fields the catalog actually sends.
 *
 * test-type: unit (no network, no clock, no bindings).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { localizedCityName } from "@animichi/agent";
import { searchBangumiTool } from "../src/agent/tools/search-bangumi-tool.ts";
import { searchNearbyTool } from "../src/agent/tools/search-nearby-tool.ts";
import { KUKI_STATION, SAITAMA, SATTE, UJI_BRIDGE, WASHINOMIYA } from "./doubles/catalog-payloads.ts";
import { unspentBudget } from "./doubles/make-tool-budget.ts";
import { makeCatalogToolSession } from "./doubles/make-catalog-tool-session.ts";
import { scriptedCatalog } from "./doubles/scripted-catalog.ts";
import type { CatalogScript } from "./doubles/scripted-catalog.ts";

const SYNCED = "2026-06-20T00:00:00.000Z";

/** Run `search_bangumi` over a scripted catalog. */
async function searchWork(script: CatalogScript, bangumiId: string) {
  const session = makeCatalogToolSession();
  const { catalog, calls } = scriptedCatalog(script);
  const result = await searchBangumiTool(catalog, session, unspentBudget).execute("call-1", { bangumi_id: bangumiId });
  return { outcome: result.details, session, calls };
}

/** Run `search_nearby` over a scripted catalog, with or without a GPS origin. */
async function searchPlace(
  script: CatalogScript,
  params: { location?: string; radius_m?: number },
  origin?: { lat: number; lng: number },
) {
  const session = makeCatalogToolSession(origin);
  const { catalog, calls } = scriptedCatalog(script);
  const result = await searchNearbyTool(catalog, session, unspentBudget).execute("call-1", params);
  return { outcome: result.details, session, calls };
}

void test("a work's points are stored under a ref the model can name", async () => {
  const { outcome, session, calls } = await searchWork(
    { points: { rows: [WASHINOMIYA, SATTE], synced_at: SYNCED } },
    "1",
  );
  assert.deepEqual(outcome, {
    outcome: "ok",
    result_ref: "search:2:1",
    row_count: 2,
    anime_title: "らき☆すた",
    partial: false,
  });
  assert.deepEqual(calls.fetched, ["1"]);
  assert.equal(session.searches.get("search:2:1")?.kind, "bangumi");
  assert.equal(session.searches.get("search:2:1")?.anime_id, "1");
});

void test("stored rows carry proxied screenshots, never the Anitabi origin", async () => {
  const { session } = await searchWork({ points: { rows: [WASHINOMIYA], synced_at: SYNCED } }, "1");
  assert.deepEqual(
    session.searches.get("search:1:1")?.rows.map((row) => row.screenshot_url),
    ["/img/p1.jpg"],
  );
});

void test("stored rows carry the city in the session's own language", async () => {
  const { session } = await searchWork({ points: { rows: [UJI_BRIDGE], synced_at: SYNCED } }, "115908");
  assert.deepEqual(session.searches.get("search:1:1")?.rows.map((row) => row.city), ["宇治"]);
});

void test("an English reader keeps the reverse geocoder's own city name", async () => {
  const session = makeCatalogToolSession(undefined, "en");
  const { catalog } = scriptedCatalog({ points: { rows: [UJI_BRIDGE], synced_at: SYNCED } });
  await searchBangumiTool(catalog, session, unspentBudget).execute("call-1", { bangumi_id: "115908" });
  assert.deepEqual(session.searches.get("search:1:1")?.rows.map((row) => row.city), ["Uji"]);
});

void test("a city the GeoNames table never carried is left as it came", async () => {
  const { session } = await searchWork({ points: { rows: [WASHINOMIYA], synced_at: SYNCED } }, "1");
  assert.deepEqual(session.searches.get("search:1:1")?.rows.map((row) => row.city), ["Kuki"]);
});

void test("a prototype key is neither a city nor a locale", () => {
  assert.equal(localizedCityName("Uji", "toString"), "Uji");
  assert.equal(localizedCityName("toString", "ja"), "toString");
});

void test("an L1 preview is reported as partial so nothing routes a fragment", async () => {
  const { outcome } = await searchWork({ points: { rows: [WASHINOMIYA], synced_at: SYNCED, partial: true } }, "1");
  assert.deepEqual(outcome, {
    outcome: "ok",
    result_ref: "search:1:1",
    row_count: 1,
    anime_title: "らき☆すた",
    partial: true,
  });
});

void test("a work with no published points is empty, not a failure", async () => {
  const { outcome } = await searchWork({ points: { rows: [], synced_at: SYNCED } }, "999");
  assert.deepEqual(outcome, { outcome: "empty", anime_title: null, partial: false });
});

void test("an unreachable catalog degrades the work search", async () => {
  const { outcome } = await searchWork({}, "1");
  assert.deepEqual(outcome, { outcome: "upstream_unavailable" });
});

void test("one gazetteer hit is searched around at its own radius", async () => {
  const { outcome, calls } = await searchPlace(
    { geocode: [KUKI_STATION], nearby: [WASHINOMIYA] },
    { location: " 久喜駅 " },
  );
  assert.deepEqual(calls.geocoded, ["久喜駅"]);
  assert.deepEqual(calls.searched, [{ around: { lat: 36.0621, lng: 139.6669 }, radiusM: 5_000 }]);
  assert.deepEqual(outcome, { outcome: "ok", result_ref: "search:1:1", row_count: 1 });
});

void test("the model's own radius overrides the gazetteer's", async () => {
  const { calls } = await searchPlace(
    { geocode: [KUKI_STATION], nearby: [] },
    { location: "久喜駅", radius_m: 1_200 },
  );
  assert.deepEqual(calls.searched, [{ around: { lat: 36.0621, lng: 139.6669 }, radiusM: 1_200 }]);
});

void test("several gazetteer hits become a place choice, and nothing is searched", async () => {
  const { outcome, session, calls } = await searchPlace(
    { geocode: [KUKI_STATION, SAITAMA] },
    { location: "久喜" },
  );
  assert.deepEqual(outcome, {
    outcome: "place_ambiguity",
    clarification_reason: "place_ambiguity",
    place_candidate_ids: ["seed:kuki-station", "seed:saitama"],
  });
  assert.deepEqual(calls.searched, []);
  assert.equal(session.clarifications.length, 1);
});

void test("a whole prefecture is too broad to search around", async () => {
  const { outcome, calls } = await searchPlace({ geocode: [SAITAMA] }, { location: "埼玉県" });
  assert.deepEqual(outcome, { outcome: "place_unresolved", clarification_reason: "place_too_broad" });
  assert.deepEqual(calls.searched, []);
});

void test("an unknown place asks rather than guesses", async () => {
  const { outcome } = await searchPlace({ geocode: [] }, { location: "ここどこ" });
  assert.deepEqual(outcome, { outcome: "place_unresolved", clarification_reason: "unknown_place" });
});

void test("no place and no GPS asks for a location", async () => {
  const { outcome, session, calls } = await searchPlace({}, {});
  assert.deepEqual(outcome, { outcome: "missing_location", clarification_reason: "missing_location" });
  assert.deepEqual(calls.geocoded, []);
  assert.deepEqual(session.clarifications, [{ reason: "missing_location", candidates: [] }]);
});

void test("no place but a shared GPS origin searches around the user", async () => {
  const { outcome, calls } = await searchPlace({ nearby: [WASHINOMIYA] }, {}, { lat: 36.1, lng: 139.6 });
  assert.deepEqual(calls.searched, [{ around: { lat: 36.1, lng: 139.6 }, radiusM: 5_000 }]);
  assert.deepEqual(outcome, { outcome: "ok", result_ref: "search:1:1", row_count: 1 });
});

void test("a resolved place with no points nearby is empty, not a failure", async () => {
  const { outcome } = await searchPlace({ geocode: [KUKI_STATION], nearby: [] }, { location: "久喜駅" });
  assert.deepEqual(outcome, { outcome: "empty" });
});

void test("an unreachable gazetteer degrades the nearby search", async () => {
  const { outcome, session } = await searchPlace({}, { location: "久喜駅" });
  assert.deepEqual(outcome, { outcome: "upstream_unavailable" });
  assert.deepEqual(session.clarifications, ["cleared"]);
});
