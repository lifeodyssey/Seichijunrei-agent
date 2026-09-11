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
export const SESSION_ID = "01992000-0000-7000-8000-000000000051";
export const IDENTITY = "anon_00000000000000000000000000000051";

before(async () => {
  const postgres = resources.postgres = await startTestPostgres({ database: "native_selection", budget: AGENT_DB_SETUP_BUDGET });
  pool = resources.pool = new pg.Pool({ connectionString: postgres.dsn });
  await promisify(execFile)("pnpm", ["exec", "prisma", "db", "migrate", "--db", postgres.dsn, "--json"], {
    cwd: fileURLToPath(new URL("../../../packages/pi-session-neon/", import.meta.url)),
    env: { ...process.env, DO_NOT_TRACK: "1" }, maxBuffer: 5 * 1024 * 1024,
  });
  database = resources.database = postgresClient<Contract>({ contractJson, url: postgres.dsn });
});

beforeEach(async () => {
  await pool.query("TRUNCATE pi_sessions CASCADE");
  await pool.query("DELETE FROM sessions WHERE id = $1", [SESSION_ID]);
  await pool.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [SESSION_ID, IDENTITY]);
});

after(async () => {
  try { await Promise.all([resources.database?.close(), resources.pool?.end()]); }
  finally { await resources.postgres?.stop(); }
});
