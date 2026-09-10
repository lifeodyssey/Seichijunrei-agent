import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { startTestPostgres, SPIKE_SETUP_BUDGET, hookTimeoutMs } from "@animichi/test-postgres";
import pg from "pg";
import { FIXED_NOW } from "../migrate.worker.helpers";
import { nativeApp, TARGET } from "./prisma-fixture";
import { clonePrismaDatabase, servePrismaPostgres } from "./prisma-postgres";
import { grantDatabaseCreate, migratorRole } from "./prisma-role";
import { saveEvidence } from "./preflight.postgres";

let server: Awaited<ReturnType<typeof startTestPostgres>>;
let client: pg.Client;
let app: Awaited<ReturnType<typeof nativeApp>>;
let databaseDsn: string;
const resources: { server?: typeof server; client?: pg.Client } = {};
let caseNumber = 0;

beforeAll(async () => { server = resources.server = await startTestPostgres({ database: "native_delivery", budget: SPIKE_SETUP_BUDGET }); }, hookTimeoutMs(SPIKE_SETUP_BUDGET));
afterAll(async () => { await resources.server?.stop(); });
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: FIXED_NOW });
  const dsn = databaseDsn = await clonePrismaDatabase(server.dsn, `native_delivery_case_${String(caseNumber++)}`);
  client = resources.client = new pg.Client(dsn);
  await client.connect();
  servePrismaPostgres(dsn);
  app = await nativeApp(dsn);
}, hookTimeoutMs(SPIKE_SETUP_BUDGET));
afterEach(async () => { await resources.client?.end(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("previews native operations through authenticated HTTP without initializing the marker", async () => {
  const response = await app.preview();
  const body: unknown = await response.json();
  expect({ status: response.status, body }).toMatchObject({ status: 200, body: { compatible: true, prisma: {
    targetHash: TARGET, markerHash: "empty", usedLiveMarker: true,
    migrations: [{ spaceId: "app", from: "empty", to: TARGET }],
  } } });
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
  expect((await client.query("SELECT to_regclass('public.pi_sessions') AS sessions")).rows).toEqual([{ sessions: null }]);
});

it("applies the sealed native graph and replays with zero migrations while preserving data", async () => {
  const first = await app.migrate();
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ success: true, prisma: { markerHash: TARGET, migrationsApplied: 1,
    applied: [{ operationsExecuted: 20 }] } });
  await client.query("INSERT INTO pi_sessions (id, metadata) VALUES ('preserved', '{\"id\":\"preserved\",\"value\":\"null\"}')");
  const preview = await app.preview();
  expect(await preview.json()).toMatchObject({ prisma: { markerHash: TARGET, migrations: [], usedLiveMarker: true } });
  const replay = await app.migrate();
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ success: true, prisma: { markerHash: TARGET, migrationsApplied: 0 } });
  expect((await client.query("SELECT id, metadata FROM pi_sessions")).rows).toEqual([{ id: "preserved", metadata: { id: "preserved", value: "null" } }]);
});

it("rechecks Atlas history inside apply after a previously successful preview", async () => {
  expect((await app.preview()).status).toBe(200);
  await client.query("UPDATE public.atlas_schema_revisions SET hash = repeat('x', 43) || '=' WHERE version = '20260904000000'");
  const refused = await app.migrate();
  expect(refused.status).toBe(422);
  expect(await refused.json()).toMatchObject({ success: false, error: "divergent_history" });
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
});

it("lets Prisma roll back conflicting DDL and the native marker together", async () => {
  await client.query("CREATE TABLE public.pi_records (saved text); INSERT INTO pi_records VALUES ('preserved')");
  const response = await app.migrate();
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ success: false });
  expect((await client.query("SELECT * FROM pi_records")).rows).toEqual([{ saved: "preserved" }]);
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
  expect((await client.query("SELECT to_regclass('public.pi_session_records') AS sessions")).rows).toEqual([{ sessions: null }]);
});

it("requires database CREATE for the non-superuser migrator and succeeds with the inherited grant", async () => {
  const dsn = await migratorRole(client, databaseDsn);
  servePrismaPostgres(dsn);
  const roleApp = await nativeApp(dsn);
  expect((await roleApp.preview()).status).toBe(200);
  expect((await roleApp.migrate()).status).toBe(500);
  expect((await client.query("SELECT to_regnamespace('prisma_contract') AS marker")).rows).toEqual([{ marker: null }]);
  await grantDatabaseCreate(client, dsn);
  const result = await roleApp.migrate();
  const body: unknown = await result.json();
  expect({ status: result.status, body }).toMatchObject({ status: 200, body: {
    success: true, prisma: { markerHash: TARGET, migrationsApplied: 1 },
  } });
  expect((await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = 'migrator'")).rows).toEqual([{ rolsuper: false }]);
  expect((await client.query("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='prisma_contract'")).rows).toEqual([{ owner: "migrator" }]);
  await saveEvidence("native-migrator-role", { superuser: false, withoutDatabaseCreate: { preview: 200, apply: 500 }, withDatabaseCreate: { status: result.status, body }, markerSchemaOwner: "migrator" });
});
