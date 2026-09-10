import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import pg from "pg";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET, startTestPostgres } from "@animichi/test-postgres";
import { issuedToken } from "../migrate.worker.helpers";
import { requestMetadata, TARGET } from "./prisma-fixture";
import { buildPrismaWorker } from "./prisma-bundle";
import { startPrismaWorker } from "./prisma-workerd";
import { grantDatabaseCreate, migratorRole } from "./prisma-role";
import { saveEvidence } from "./preflight.postgres";

let runtime: Awaited<ReturnType<typeof startPrismaWorker>>;
let token: string;
const resources: { runtime?: typeof runtime; server?: Awaited<ReturnType<typeof startTestPostgres>>; directory?: string; client?: pg.Client } = {};

beforeAll(async () => {
  const directory = resources.directory = await mkdtemp(join(tmpdir(), "native-migrator-worker-"));
  await buildPrismaWorker(directory);
  const server = resources.server = await startTestPostgres({ database: "native_delivery_worker", budget: SPIKE_SETUP_BUDGET });
  const client = resources.client = new pg.Client(server.dsn);
  await client.connect();
  const dsn = await migratorRole(client, server.dsn);
  await grantDatabaseCreate(client, dsn);
  const signed = await issuedToken();
  token = signed.token;
  const started = performance.now();
  runtime = resources.runtime = await startPrismaWorker(directory, dsn, signed.jwk);
  await saveEvidence("native-workerd-startup-timing", { readyMs: performance.now() - started });
}, hookTimeoutMs(SPIKE_SETUP_BUDGET));

afterAll(async () => {
  await resources.runtime?.close();
  await resources.client?.end();
  await resources.server?.stop();
  await rm(resources.directory ?? "/nonexistent-native-worker-test", { recursive: true, force: true });
});

function post(path: string, body = requestMetadata) {
  return runtime.worker.dispatchFetch(`https://migrator.test/${path}`, { method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function applyReceipt() {
  const response = await post("migrate");
  // Miniflare requires immediate consumption of each dispatchFetch body.
  return { status: response.status, body: await response.json() as {
    prisma: { markerHash: string; migrationsApplied: number };
  } };
}

it("runs authenticated preview and concurrent apply through the deployed entry and fixed DO with a non-superuser role", async () => {
  const started = performance.now();
  const health = await runtime.worker.dispatchFetch("https://migrator.test/healthz");
  expect(await health.json()).toMatchObject({ prismaTarget: TARGET });
  const healthy = performance.now();
  const preview = await post("preflight");
  const previewBody: unknown = await preview.json();
  const sealedCount = (previewBody as { prisma: { migrations: unknown[] } }).prisma.migrations.length;
  expect({ status: preview.status, body: previewBody }).toMatchObject({ status: 200, body: {
    compatible: true, prisma: { targetHash: TARGET, markerHash: "empty", usedLiveMarker: true },
  } });
  const previewed = performance.now();
  const applied = await Promise.all([applyReceipt(), applyReceipt()]);
  expect(applied.map((response) => response.status)).toEqual([200, 200]);
  const bodies = applied.map((response) => response.body);
  expect(bodies.map((body) => body.prisma.markerHash)).toEqual([TARGET, TARGET]);
  expect(bodies.map((body) => body.prisma.migrationsApplied).sort()).toEqual([0, sealedCount]);
  const migrated = performance.now();
  const replay = await post("preflight");
  const replayBody: unknown = await replay.json();
  expect(replayBody).toMatchObject({ prisma: { markerHash: TARGET, migrations: [], usedLiveMarker: true } });
  const replayed = performance.now();
  await saveEvidence("native-workerd-phase-timing", { healthMs: healthy - started,
    previewMs: previewed - healthy, concurrentApplyMs: migrated - previewed,
    replayMs: replayed - migrated, totalMs: replayed - started });
  await saveEvidence("native-workerd-fixed-lock", { applied, replay: replayBody });
}, SPIKE_SETUP_BUDGET.chainMarginMs);

it("rejects a requested native target absent from the sealed graph before reading a database", async () => {
  const response = await post("migrate", { ...requestMetadata, expectedPrismaRef: "f".repeat(64) });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "stale_prisma_bundle", prismaTarget: TARGET });
});
