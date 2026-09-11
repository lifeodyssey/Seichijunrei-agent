import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { hookTimeoutMs, SPIKE_SETUP_BUDGET, startTestPostgres } from "@animichi/test-postgres";
import type { Miniflare } from "miniflare";
import { selectedWorker } from "../selected-workerd";
import { databaseSnapshot, saveEvidence } from "./preflight.postgres";
import { applyNativeFixture, selectedDatabase, selectedPostgresTransport, type SqlCapture } from "./selected.postgres";

let plane: Awaited<ReturnType<typeof startTestPostgres>>;
let database: Awaited<ReturnType<typeof selectedDatabase>>;
let runtime: Miniflare | undefined;
let captures: SqlCapture[];

beforeAll(async () => { plane = await startTestPostgres({ database: "selected_apply", budget: SPIKE_SETUP_BUDGET }); }, hookTimeoutMs(SPIKE_SETUP_BUDGET));
beforeEach(async () => { database = await selectedDatabase(plane.dsn); captures = []; });
afterEach(async () => { await runtime?.dispose(); await database.client.end(); });
afterAll(async () => { await plane.stop(); });

async function worker() {
  const selected = await selectedWorker(selectedPostgresTransport(database.dsn, captures));
  runtime = selected.runtime;
  return selected;
}

it("applies selected B after a native read-only prefix check under the real DO lock", async () => {
  const selected = await worker();
  const response = await selected.request();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ success: true, appliedHead: "20260102000000_extend" });
  const rows = await database.client.query<{ version: string; type: string; applied: string; total: string }>(
    "SELECT version, type::text, applied::text, total::text FROM public.atlas_schema_revisions ORDER BY version");
  expect(rows.rows).toEqual([
    { version: "20260101000000", type: "2", applied: "1", total: "1" },
    { version: "20260102000000", type: "2", applied: "1", total: "1" },
  ]);
  expect(captures.find((capture) => capture.readOnly === "true")?.isolation).toBe("RepeatableRead");
  expect((await database.client.query("SELECT to_regclass('public.preflight_example_label') AS name")).rows).toEqual([{ name: null }]);
  await saveEvidence("selected-b-native-apply", { captures, rows: rows.rows });
});

it("refuses B without writes when native Atlas moves A to C after preflight", async () => {
  const selected = await worker();
  const preview = await selected.request("/preflight");
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ compatible: true });
  await applyNativeFixture(database.dsn);
  const before = await databaseSnapshot(database.client);
  captures.length = 0;
  const response = await selected.request();
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: "database_ahead" });
  expect(await databaseSnapshot(database.client)).toBe(before);
  expect(captures.flatMap(({ queries }) => queries).every(({ query }) => query.trimStart().startsWith("SELECT"))).toBe(true);
  await saveEvidence("selected-b-after-native-c", { captures, before, after: await databaseSnapshot(database.client) });
});

it("refuses a ledger removed after preflight without recreating it", async () => {
  const selected = await worker();
  const preview = await selected.request("/preflight");
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({ compatible: true });
  await database.client.query("DROP TABLE public.atlas_schema_revisions");
  const before = await databaseSnapshot(database.client);
  captures.length = 0;
  const response = await selected.request();
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ error: "ledger_missing" });
  expect(await databaseSnapshot(database.client)).toBe(before);
  expect(captures.flatMap(({ queries }) => queries).every(({ query }) => query.trimStart().startsWith("SELECT"))).toBe(true);
  await saveEvidence("selected-missing-ledger", { captures, before, after: await databaseSnapshot(database.client) });
});

it("rolls back failed B and refuses the queued request after its incomplete revision", async () => {
  await database.client.query("ALTER TABLE public.preflight_example ADD COLUMN label integer");
  const selected = await worker();
  const responses = await Promise.all([selected.request(), selected.request()].map(async (pending) => {
    const response = await pending;
    return { status: response.status, body: await response.json() };
  }));
  const bodies = responses.map(({ body }) => body);
  expect(responses.map(({ status }) => status).sort()).toEqual([422, 500]);
  expect(bodies).toEqual(expect.arrayContaining([expect.objectContaining({ error: "incomplete_revision" })]));
  expect(JSON.stringify(bodies)).not.toContain("already exists");
  expect((await database.client.query("SELECT applied::text, total::text FROM public.atlas_schema_revisions WHERE version = '20260102000000'")).rows)
    .toEqual([{ applied: "0", total: "1" }]);
  expect((await database.client.query("SELECT data_type FROM information_schema.columns WHERE table_name='preflight_example' AND column_name='label'")).rows)
    .toEqual([{ data_type: "integer" }]);
  await saveEvidence("selected-native-concurrent-refusal", { captures, bodies });
});
