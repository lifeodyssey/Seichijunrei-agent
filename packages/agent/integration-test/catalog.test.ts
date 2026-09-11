import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { ResolveOutcome, Itinerary } from "@animichi/contract/models";
import { readSearchResult } from "@animichi/agent/tools";
import { z } from "zod";
import { catalogPostgres } from "./catalog-postgres.ts";
import { catalogWorker } from "./catalog-worker.ts";
import { catalogHarness, latestTool } from "./catalog-harness.ts";
import { seedCatalog } from "./catalog-seed.ts";

void test("production native tools resolve, search, locate and route actual catalog points", { timeout: 360_000 }, async (context) => {
  const database = await catalogPostgres(context);
  await seedCatalog(database.sql);
  const address = await catalogWorker(context, database.connectionString, database.endpoint);
  const { harness, session, lane, provider, requests } = await catalogHarness(context, address, { lat: 35, lng: 139 });
  assert.equal((await harness.getTools(BACKGROUND_CONTEXT)).length, 7);
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Native Catalog Proof" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "1556" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Found both catalog points."),
  ]);
  await lane.prompt("Find this anime's pilgrimage points", undefined, BACKGROUND_CONTEXT);
  const resolved = ResolveOutcome.parse((await latestTool(lane, "resolve_anime")).message.details);
  assert.equal(resolved.outcome, "resolved"); assert.equal(resolved.match.bangumi_id, "1556");
  assert.equal(resolved.match.title, "Native Catalog Proof"); assert.equal(resolved.match.points_count, 2);
  const searchEntry = await latestTool(lane, "search_bangumi");
  const search = await readSearchResult(session, "main", searchEntry.id, BACKGROUND_CONTEXT);
  assert.deepEqual(search?.rows.map((point) => [point.id, point.name]), [["catalog-south", "South Shrine"], ["catalog-north", "North Shrine"]]);

  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("plan_route", { search_result_ref: searchEntry.id, pacing: "chill" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("search_nearby", { radius_m: 100 }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Route planned from your shared origin."),
  ]);
  await lane.prompt("Plan my walk and show the closest points", undefined, BACKGROUND_CONTEXT);
  const route = z.object({ itinerary: Itinerary, source_ref: z.string() }).parse((await latestTool(lane, "plan_route")).message.details);
  assert.equal(route.source_ref, searchEntry.id); assert.equal(route.itinerary.point_count, 2);
  assert.deepEqual(route.itinerary.ordered_points.map((point) => point.id), ["catalog-south", "catalog-north"]);
  assert.equal(route.itinerary.timed_itinerary.pacing, "chill");
  const nearby = await latestTool(lane, "search_nearby");
  assert.deepEqual((await readSearchResult(session, "main", nearby.id, BACKGROUND_CONTEXT))?.rows.map((point) => point.id), ["catalog-south"]);

  assert.deepEqual(requests, ["/catalog/resolve", "/catalog/points-by-bangumi-id", "/catalog/itinerary", "/catalog/nearby"]);
});

void test("native results retain committed catalog facts across transaction rollback and publication", { timeout: 360_000 }, async (context) => {
  const database = await catalogPostgres(context); await seedCatalog(database.sql);
  const address = await catalogWorker(context, database.connectionString, database.endpoint);
  const { session, lane, provider } = await catalogHarness(context, address);
  provider.setResponses([fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "1556" }), { stopReason: "toolUse" }), fauxAssistantMessage("Read the original points.")]);
  await lane.prompt("Find this anime's pilgrimage points", undefined, BACKGROUND_CONTEXT);
  const searchEntry = await latestTool(lane, "search_bangumi");
  await assert.rejects(database.sql.transaction([
    database.sql`UPDATE points SET name='Uncommitted rename' WHERE id='catalog-north'`,
    database.sql`SELECT 1 / 0`,
  ]), /division by zero/);
  provider.setResponses([fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "1556" }), { stopReason: "toolUse" }), fauxAssistantMessage("Read the committed facts.")]);
  await lane.prompt("Read the catalog again after the failed transaction", undefined, BACKGROUND_CONTEXT);
  const rolledBack = await latestTool(lane, "search_bangumi");
  assert.deepEqual((await readSearchResult(session, "main", rolledBack.id, BACKGROUND_CONTEXT))?.rows.map((point) => point.name), ["South Shrine", "North Shrine"]);

  await database.sql.transaction([
    database.sql`UPDATE points SET name='Moved Shrine',latitude=36 WHERE id='catalog-north'`,
    database.sql`UPDATE bangumi SET title='Changed in PostgreSQL' WHERE id='1556'`,
  ]);
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Native Catalog Proof" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("search_bangumi", { bangumi_id: "1556" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("search_nearby", { radius_m: 100 }), { stopReason: "toolUse" }), fauxAssistantMessage("Observed the new catalog facts."),
  ]);
  await lane.prompt("Refresh the catalog after publication", undefined, BACKGROUND_CONTEXT);
  const refreshed = ResolveOutcome.parse((await latestTool(lane, "resolve_anime")).message.details);
  assert.equal(refreshed.outcome, "resolved"); assert.equal(refreshed.match.title, "Changed in PostgreSQL");
  const changed = await latestTool(lane, "search_bangumi");
  assert.deepEqual((await readSearchResult(session, "main", changed.id, BACKGROUND_CONTEXT))?.rows.map((point) => [point.name, point.latitude]), [["South Shrine", 35], ["Moved Shrine", 36]]);
  const movedNearby = await latestTool(lane, "search_nearby");
  assert.deepEqual((await readSearchResult(session, "main", movedNearby.id, BACKGROUND_CONTEXT))?.rows, []);
  assert.deepEqual((await readSearchResult(session, "main", searchEntry.id, BACKGROUND_CONTEXT))?.rows.map((point) => point.name), ["South Shrine", "North Shrine"]);
});
