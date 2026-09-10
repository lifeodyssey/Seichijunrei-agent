import { after, before, beforeEach } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, URL } from "node:url";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import postgresClient, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";
import pg from "pg";

export let database: PostgresClient<Contract>;
export let pool: pg.Pool;
const resources: { postgres?: TestPostgres; database?: PostgresClient<Contract>; pool?: pg.Pool } = {};
export const SESSION_ID = "01992000-0000-7000-8000-000000000046";
export const IDENTITY = "anon_00000000000000000000000000000046";
export const NOW = Date.parse("2026-09-10T12:00:00Z");
export const DAY = "2026-09-10";

before(async () => {
  const postgres = resources.postgres = await startTestPostgres({ database: "native_admission", budget: AGENT_DB_SETUP_BUDGET });
  pool = resources.pool = new pg.Pool({ connectionString: postgres.dsn });
  await promisify(execFile)("pnpm", ["exec", "prisma", "db", "migrate", "--db", postgres.dsn, "--json"], {
    cwd: fileURLToPath(new URL("../../../packages/pi-session-neon/", import.meta.url)),
    env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 5 * 1024 * 1024,
  });
  database = resources.database = postgresClient<Contract>({ contractJson, url: postgres.dsn });
});

beforeEach(async () => {
  await pool.query("TRUNCATE pi_sessions CASCADE; DELETE FROM anon_daily_message_count WHERE usage_date = '2026-09-10'");
  await pool.query("DELETE FROM sessions WHERE id = $1", [SESSION_ID]);
  await database.orm.public.PiSession.create({ id: SESSION_ID, metadata: { id: SESSION_ID, createdAt: NOW, storageVersion: 1 } });
});

after(async () => {
  try { await Promise.all([resources.database?.close(), resources.pool?.end()]); }
  finally { await resources.postgres?.stop(); }
});

export async function quotaCount() {
  const result = await pool.query<{ count: number }>("SELECT message_count::integer AS count FROM anon_daily_message_count WHERE usage_date = $1 AND anon_id = $2", [DAY, IDENTITY]);
  return result.rows[0]?.count ?? 0;
}
