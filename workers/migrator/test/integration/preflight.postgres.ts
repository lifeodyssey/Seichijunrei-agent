import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { createCleanDatabase, startTestPostgres, SPIKE_SETUP_BUDGET } from "@animichi/test-postgres";
import { expect, vi } from "vitest";
import type { RevisionFixture } from "../preflight-fixtures";

const FIXTURE_DIR = new URL("../fixtures/preflight-chain/", import.meta.url);
const SCHEMA_SQL = `SELECT n.nspname, c.relname, c.relkind, a.attname,
  format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull,
  pg_get_expr(d.adbin, d.adrelid) AS default_value
  FROM pg_namespace n LEFT JOIN pg_class c ON c.relnamespace = n.oid
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
  ORDER BY n.nspname, c.relname, a.attnum`;

async function applyFixture(dsn: string, extra: string[] = []): Promise<void> {
  await promisify(execFile)(process.env.ATLAS_BIN ?? "atlas", ["migrate", "apply", "--dir", FIXTURE_DIR.href,
    "--url", dsn, "--revisions-schema", "public", ...extra], { env: { ...process.env, ATLAS_NO_UPDATE_NOTIFIER: "1" } });
}

export async function nativeBaselineDatabase(baseDsn: string) {
  const dsn = await createCleanDatabase(baseDsn, "preflight_native_baseline");
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    await client.query("CREATE TABLE public.preflight_example (id integer PRIMARY KEY)");
    await applyFixture(dsn, ["--baseline", "20260101000000"]);
    return { dsn, client };
  } catch (error) {
    await client.end();
    throw error;
  }
}

export async function startPreflightDatabase() {
  const plane = await startTestPostgres({ database: "preflight_chain_validation", budget: SPIKE_SETUP_BUDGET });
  try {
    const dsn = await createCleanDatabase(plane.dsn, "preflight_fixture");
    await applyFixture(dsn);
    const client = new pg.Client(dsn);
    await client.connect();
    await client.query("CREATE TABLE public.saved_revisions AS TABLE public.atlas_schema_revisions");
    return { dsn, client, stop: async () => { await client.end(); await plane.stop(); } };
  } catch (error) {
    await plane.stop();
    throw error;
  }
}

/** Fixture setup writes occur before the measured preflight interval. */
export async function setRevisions(client: pg.Client, rows: readonly RevisionFixture[]): Promise<void> {
  await client.query("DROP TABLE IF EXISTS public.atlas_schema_revisions");
  await client.query("CREATE TABLE public.atlas_schema_revisions (LIKE public.saved_revisions)");
  for (const row of rows) {
    await client.query(`INSERT INTO public.atlas_schema_revisions
      (version, description, type, applied, total, hash, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, Object.values(row));
  }
}

export async function databaseSnapshot(client: pg.Client): Promise<string> {
  const schema = await client.query<unknown[]>(SCHEMA_SQL);
  const constraints = await client.query<unknown[]>(`SELECT conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conname`);
  const routines = await client.query<unknown[]>(`SELECT proname, prosrc FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace ORDER BY proname, prosrc`);
  const tables = await client.query<{ name: string }>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  const rows = [];
  for (const { name } of tables.rows) {
    const result = await client.query<{ row: unknown }>(
      `SELECT to_jsonb(t) AS row FROM public."${name.replaceAll('"', '""')}" t ORDER BY to_jsonb(t)::text`);
    rows.push({ table: name, rows: result.rows });
  }
  return JSON.stringify({ schema: schema.rows, constraints: constraints.rows, routines: routines.rows, rows });
}

interface NeonBatch {
  queries: { query: string; params: string[] }[];
}

/** Only the HTTP boundary is replaced: the native SDK generates this payload,
 * and native pg executes each query on the disposable server with those modes. */
export function servePostgres(dsn: string) {
  const captures: { readOnly: string | null; isolation: string | null; batch: NeonBatch }[] = [];
  const transport = vi.fn<typeof fetch>(async (_input, options) => {
    const headers = new Headers(options?.headers);
    expect(headers.get("Neon-Connection-String")).toBe(dsn);
    expect(typeof options?.body).toBe("string");
    const batch = JSON.parse(options?.body as string) as NeonBatch;
    captures.push({ readOnly: headers.get("Neon-Batch-Read-Only"), isolation: headers.get("Neon-Batch-Isolation-Level"), batch });
    expect(headers.get("Neon-Batch-Read-Only")).toBe("true");
    expect(headers.get("Neon-Batch-Isolation-Level")).toBe("RepeatableRead");
    return executeBatch(dsn, batch);
  });
  vi.stubGlobal("fetch", transport);
  return { transport, captures };
}

async function executeBatch(dsn: string, batch: NeonBatch): Promise<Response> {
  const client = new pg.Client(dsn);
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const results = [];
    for (const { query, params } of batch.queries) {
      results.push(await client.query<unknown[]>({ text: query, values: params, rowMode: "array" }));
    }
    await client.query("COMMIT");
    return Response.json({ results });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof pg.DatabaseError) return Response.json({ code: error.code, message: error.message }, { status: 400 });
    throw error;
  } finally {
    await client.end();
  }
}

export async function saveEvidence(name: string, evidence: unknown): Promise<void> {
  const directory = process.env.PREFLIGHT_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.json`), JSON.stringify(evidence, null, 2) + "\n");
}
