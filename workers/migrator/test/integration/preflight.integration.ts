import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import { PREFIX_CASES, REFUSAL_CASES } from "../preflight.cases";
import { HASH_A, metadata, preflightRequest, revision, signedApp } from "../preflight-fixtures";
import { FIXED_NOW } from "../migrate.worker.helpers";
import tripleSum from "../fixtures/preflight-three-chain/atlas.sum";
import { databaseSnapshot, nativeBaselineDatabase, saveEvidence, servePostgres, setRevisions, startPreflightDatabase } from "./preflight.postgres";

let database: Awaited<ReturnType<typeof startPreflightDatabase>>;

beforeAll(async () => { database = await startPreflightDatabase(); }, hookTimeoutMs(SPIKE_SETUP_BUDGET));
afterAll(async () => { await database.stop(); });
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW }));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("reads genuine Atlas v0.30.0 revisions as a complete compatible no-op", async () => {
  const native = await database.client.query<{ hash: string; type: string; applied: string; total: string }>(
    "SELECT hash, type::text, applied, total FROM public.atlas_schema_revisions ORDER BY version");
  expect(native.rows[0]?.hash).toBe(HASH_A);
  expect(native.rows[0]?.type).toBe("2");
  expect(native.rows[0]?.applied).toBe(native.rows[0]?.total);
  const { captures } = servePostgres(database.dsn);
  const { app, token, env } = await signedApp();
  const before = await databaseSnapshot(database.client);
  const response = await app.request(preflightRequest(metadata, token), undefined, { ...env, MIGRATOR_DATABASE_URL: database.dsn });
  const after = await databaseSnapshot(database.client);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ compatible: true, pendingCount: 0 });
  expect(after).toBe(before);
  await saveEvidence("native-atlas", { nativeRows: native.rows, captures, before, after });
});

it.each(PREFIX_CASES)("real PostgreSQL accepts $name without writes", async ({ name, rows, pendingCount }) => {
  await setRevisions(database.client, rows);
  const { captures } = servePostgres(database.dsn);
  const { app, token, env } = await signedApp();
  const before = await databaseSnapshot(database.client);
  const response = await app.request(preflightRequest(metadata, token), undefined, { ...env, MIGRATOR_DATABASE_URL: database.dsn });
  const after = await databaseSnapshot(database.client);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ compatible: true, pendingCount });
  expect(after).toBe(before);
  await saveEvidence(name, { captures, before, after });
});

it.each(REFUSAL_CASES)("real PostgreSQL refuses $name without writes", async ({ name, rows, error }) => {
  await setRevisions(database.client, rows);
  const { captures } = servePostgres(database.dsn);
  const { app, token, env } = await signedApp();
  const before = await databaseSnapshot(database.client);
  const response = await app.request(preflightRequest(metadata, token), undefined, { ...env, MIGRATOR_DATABASE_URL: database.dsn });
  const after = await databaseSnapshot(database.client);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error });
  expect(after).toBe(before);
  await saveEvidence(name, { captures, before, after });
});

it("refuses a missing ledger without creating it", async () => {
  await database.client.query("DROP TABLE public.atlas_schema_revisions");
  servePostgres(database.dsn);
  const { app, token, env } = await signedApp();
  const before = await databaseSnapshot(database.client);
  const response = await app.request(preflightRequest(metadata, token), undefined, { ...env, MIGRATOR_DATABASE_URL: database.dsn });
  const after = await databaseSnapshot(database.client);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "ledger_missing" });
  expect(after).toBe(before);
  await saveEvidence("missing-ledger", { before, after });
});

it("refuses an interior gap with a matching final head", async () => {
  const hash = tripleSum.trimEnd().split("\n").at(-1)?.split("h1:").at(-1) ?? "invalid";
  await setRevisions(database.client, [revision(), revision({ version: "20260103000000", description: "third", hash })]);
  servePostgres(database.dsn);
  const { app, token, env } = await signedApp();
  const body = { ...metadata, expectedHead: "20260103000000_third", atlasSum: tripleSum };
  const before = await databaseSnapshot(database.client);
  const response = await app.request(preflightRequest(body, token), undefined, { ...env, MIGRATOR_DATABASE_URL: database.dsn });
  const after = await databaseSnapshot(database.client);
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ compatible: false, error: "divergent_history" });
  expect(after).toBe(before);
  await saveEvidence("interior-gap", { before, after });
});

it("PostgreSQL itself rejects writes in the required transaction mode", async () => {
  const before = await databaseSnapshot(database.client);
  await database.client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const modes = await database.client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
  expect(modes.rows).toEqual([{ transaction_read_only: "on" }]);
  await expect(database.client.query("INSERT INTO public.preflight_example (id) VALUES (1575)")).rejects.toMatchObject({ code: "25006" });
  await database.client.query("ROLLBACK");
  const after = await databaseSnapshot(database.client);
  expect(after).toBe(before);
  await saveEvidence("postgres-read-only-denial", { sqlstate: "25006", before, after });
});

it("refuses the genuine Atlas --baseline revision", async () => {
  const baseline = await nativeBaselineDatabase(database.dsn);
  try {
    const native = await baseline.client.query<{ type: string }>("SELECT type::text FROM public.atlas_schema_revisions ORDER BY version");
    expect(native.rows[0]?.type).toBe("1");
    servePostgres(baseline.dsn);
    const { app, token, env } = await signedApp();
    const before = await databaseSnapshot(baseline.client);
    const response = await app.request(preflightRequest(metadata, token), undefined, { ...env, MIGRATOR_DATABASE_URL: baseline.dsn });
    const after = await databaseSnapshot(baseline.client);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ compatible: false, error: "baseline_cutover_required" });
    expect(after).toBe(before);
    await saveEvidence("native-atlas-baseline", { nativeRows: native.rows, before, after });
  } finally {
    await baseline.client.end();
  }
});
