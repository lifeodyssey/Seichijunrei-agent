import assert from "node:assert/strict";
import test from "node:test";
import { HarnessFault } from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createPilgrimageHarness } from "@animichi/agent/harness";
import { failCommitsAfterEffect } from "../test/native-crash-fixture.ts";
import { catalogHarness, latestTool } from "./catalog-harness.ts";
import { catalogPostgres } from "./catalog-postgres.ts";
import { seedCatalog } from "./catalog-seed.ts";
import { catalogWorker } from "./catalog-worker.ts";
import { webHttp } from "./web-http.ts";

void test("native web search safely replays one invocation and commits refreshed attributed HTTP facts", { timeout: 360_000 }, async (context) => {
  const database = await catalogPostgres(context); await seedCatalog(database.sql);
  const address = await catalogWorker(context, database.connectionString, database.endpoint);
  const web = await webHttp(context);
  const { repo, session, models, toolContext, harness, lane, provider, requests } = await catalogHarness(context, address, undefined, web.webFetch);
  const authorizations: string[] = []; const reservations: string[] = [];
  toolContext.assertAuthorized = (id) => { authorizations.push(id); return Promise.resolve(); };
  toolContext.reserveToolUsage = (id) => { reservations.push(id); return Promise.resolve(); };
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Native Catalog Proof" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("web_search", { query: "Native Catalog Proof accepted title" }), { stopReason: "toolUse" }),
  ]);
  const fault = failCommitsAfterEffect(session, () => web.requests.length > 0);
  context.after(() => { fault.mock.restore(); });
  await assert.rejects(lane.prompt("Resolve the catalog title and find attributed background", undefined, BACKGROUND_CONTEXT), HarnessFault);
  assert.equal(web.requests.length, 1);
  fault.mock.restore(); await harness.close(BACKGROUND_CONTEXT);

  toolContext.session = await repo.open(session.metadata, BACKGROUND_CONTEXT);
  web.page.title = "Recovered web finding";
  provider.setResponses([fauxAssistantMessage("Recovered the attributed result.")]);
  const restored = await createPilgrimageHarness({ session: toolContext.session, models, model: provider.getModel(), toolContext }, BACKGROUND_CONTEXT);
  context.after(() => restored.harness.close(BACKGROUND_CONTEXT));
  const open = restored.open[0]; assert.ok(open);
  const resumed = await restored.harness.lane("main", BACKGROUND_CONTEXT);
  await resumed.drive({ operationId: open.operationId, waitForRetry: false }, BACKGROUND_CONTEXT);
  const result = await latestTool(resumed, "web_search");
  assert.partialDeepStrictEqual(result.message.details, {
    results: [{ title: "Recovered web finding", body: "Accepted title & attribution.", href: "https://bgm.tv/subject/1556", source_tier: "verified" }],
    execution: { operationId: open.operationId, args: { query: "Native Catalog Proof accepted title" } },
  });
  assert.match(JSON.stringify(result.message.content), /untrusted_web_result/);
  assert.partialDeepStrictEqual((await latestTool(resumed, "resolve_anime")).message.details, { outcome: "resolved", match: { bangumi_id: "1556" } });
  assert.deepEqual(requests, ["/catalog/resolve"]);
  assert.deepEqual(web.requests, [
    { url: "https://html.duckduckgo.com/html/?q=Native+Catalog+Proof+accepted+title", redirect: "manual", method: "GET" },
    { url: "https://html.duckduckgo.com/html/?q=Native+Catalog+Proof+accepted+title", redirect: "manual", method: "GET" },
  ]);
  assert.equal(reservations.length, 3); assert.equal(reservations[1], reservations[2]);
  assert.notEqual(reservations[0], reservations[1]);
  assert.deepEqual(authorizations, [open.operationId, open.operationId, open.operationId]);
});

void test("native web replay rejects revoked authorization before repeating the HTTP effect", { timeout: 360_000 }, async (context) => {
  const database = await catalogPostgres(context); await seedCatalog(database.sql);
  const address = await catalogWorker(context, database.connectionString, database.endpoint);
  const web = await webHttp(context);
  const { repo, session, models, toolContext, harness, lane, provider, requests } = await catalogHarness(context, address, undefined, web.webFetch);
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall("resolve_anime", { title: "Native Catalog Proof" }), { stopReason: "toolUse" }),
    fauxAssistantMessage(fauxToolCall("web_search", { query: "Native Catalog Proof" }), { stopReason: "toolUse" }),
  ]);
  const fault = failCommitsAfterEffect(session, () => web.requests.length > 0);
  context.after(() => { fault.mock.restore(); });
  await assert.rejects(lane.prompt("Find the catalog anime and web provenance", undefined, BACKGROUND_CONTEXT), HarnessFault);
  fault.mock.restore(); await harness.close(BACKGROUND_CONTEXT);
  let authorizations = 0; let reservations = 0;
  toolContext.assertAuthorized = () => { authorizations += 1; return Promise.reject(new Error("test identity revoked")); };
  toolContext.reserveToolUsage = () => { reservations += 1; return Promise.resolve(); };
  toolContext.session = await repo.open(session.metadata, BACKGROUND_CONTEXT);
  provider.setResponses([fauxAssistantMessage("Access was revoked.")]);
  const restored = await createPilgrimageHarness({ session: toolContext.session, models, model: provider.getModel(), toolContext }, BACKGROUND_CONTEXT);
  context.after(() => restored.harness.close(BACKGROUND_CONTEXT));
  const open = restored.open[0]; assert.ok(open);
  const resumed = await restored.harness.lane("main", BACKGROUND_CONTEXT);
  await resumed.drive({ operationId: open.operationId, waitForRetry: false }, BACKGROUND_CONTEXT);
  const entries = await resumed.findEntries({ type: "message" }, BACKGROUND_CONTEXT);
  const result = entries.find((entry) => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "web_search");
  assert.ok(result?.type === "message" && result.message.role === "toolResult");
  assert.equal(result.message.isError, true); assert.match(JSON.stringify(result.message.content), /test identity revoked/);
  assert.equal(authorizations, 1); assert.equal(reservations, 0); assert.equal(web.requests.length, 1);
  assert.deepEqual(requests, ["/catalog/resolve"]);
});
