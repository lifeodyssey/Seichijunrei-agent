import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import { executeSelection } from "@animichi/agent/selection";
import { createCatalogClient } from "@animichi/agent/tools";
import { POINT_A, itinerary, selectionFixture } from "./native-selection-fixture.ts";

void test("duplicate catalog point IDs retain the first offered coordinates within one work", async () => {
  const { repo, entries, revision } = await selectionFixture("resolve_anime", { outcome: "needs_disambiguation", reason: "anime_ambiguity",
    candidates: [{ bangumi_id: "123", title: "First" }, { bangumi_id: "456", title: "Second" }] });
  const responses = new Map<string, unknown>([
    ["/catalog/points-by-bangumi-id", { rows: [POINT_A, { ...POINT_A, latitude: 40 }], synced_at: "2026-09-10" }],
    ["/catalog/itinerary", itinerary([POINT_A])],
  ]);
  const catalog = createCatalogClient((request) => Promise.resolve(Response.json(responses.get(new URL(request.url).pathname))));
  const result = await executeSelection({ of: "candidates", candidateIds: ["123"], clarificationId: revision, locale: "en" }, entries, catalog, context);
  assert.equal(result.status, "ok");
  assert.equal(result.rows[0]?.latitude, 35);
  assert.deepEqual(result.currentAnime, { bangumiId: "123", title: "First" });
  await repo.close(context);
});
