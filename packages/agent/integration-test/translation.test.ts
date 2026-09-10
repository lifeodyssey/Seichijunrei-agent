import assert from "node:assert/strict";
import test from "node:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { catalogHarness, latestTool } from "./catalog-harness.ts";
import { catalogPostgres } from "./catalog-postgres.ts";
import { seedCatalog } from "./catalog-seed.ts";
import { catalogWorker } from "./catalog-worker.ts";

void test("native translation reads published Chinese titles and retains the earlier committed fact", { timeout: 360_000 }, async (context) => {
  const database = await catalogPostgres(context); await seedCatalog(database.sql);
  await database.sql`UPDATE bangumi SET title_cn='本地巡礼' WHERE id='1556'`;
  const address = await catalogWorker(context, database.connectionString, database.endpoint);
  const { session, lane, provider, requests } = await catalogHarness(context, address);
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("translate_anime_title", { title: "Native Catalog Proof", target_language: "zh" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Read the accepted catalog translation."),
  ]);
  await lane.prompt("Translate the anime title into Chinese", undefined, BACKGROUND_CONTEXT);
  const original = await latestTool(lane, "translate_anime_title");
  assert.partialDeepStrictEqual(original.message.details, {
    original: "Native Catalog Proof", translated: "本地巡礼", source: "catalog", confidence: 1,
  });

  await database.sql`UPDATE bangumi SET title_cn='发布后的巡礼' WHERE id='1556'`;
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("translate_anime_title", { title: "Native Catalog Proof", target_language: "zh" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Read the newly published translation."),
  ]);
  await lane.prompt("Read the accepted translation after publication", undefined, BACKGROUND_CONTEXT);
  const refreshed = await latestTool(lane, "translate_anime_title");
  assert.partialDeepStrictEqual(refreshed.message.details, {
    original: "Native Catalog Proof", translated: "发布后的巡礼", source: "catalog", confidence: 1,
  });
  const retained = (await session.getEntries([original.id], BACKGROUND_CONTEXT)).get(original.id);
  assert.ok(retained?.type === "message" && retained.message.role === "toolResult");
  assert.partialDeepStrictEqual(retained.message.details, { translated: "本地巡礼", source: "catalog" });
  assert.deepEqual(requests, ["/catalog/resolve", "/catalog/resolve"]);
});
