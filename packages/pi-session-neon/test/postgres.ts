import { after, before, beforeEach } from "node:test";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import postgresClient, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import pg from "pg";
import contractJson from "../src/contract.json" with { type: "json" };
import type { Contract } from "../src/contract.d.ts";
import { TABLE_CATALOG, type TableShape } from "./catalog.ts";
import { migrate } from "./prisma-migration.ts";

export let postgres: TestPostgres;
export let pool: pg.Pool;
export let database: PostgresClient<Contract>;
export let oldTables: TableShape[];
const resources: { postgres?: TestPostgres; pool?: pg.Pool; database?: PostgresClient<Contract> } = {};
export const SESSION_ID = "schema-test";
export const METADATA = { id: SESSION_ID, createdAt: 123, storageVersion: 1, parentSessionId: "deleted-parent" };

before(async () => {
  postgres = resources.postgres = await startTestPostgres({ database: "harness_schema", budget: AGENT_DB_SETUP_BUDGET });
  pool = resources.pool = new pg.Pool({ connectionString: postgres.dsn });
  oldTables = (await pool.query<TableShape>(TABLE_CATALOG)).rows;
  await pool.query("INSERT INTO daily_usage (usage_date, scope, requests, cost_usd) VALUES ('2026-09-08', 'user', 7, 9.12)");
  await migrate(postgres.dsn);
  database = resources.database = postgresClient<Contract>({ contractJson, url: postgres.dsn });
});

beforeEach(async () => {
  await pool.query("TRUNCATE pi_sessions CASCADE; DELETE FROM daily_usage WHERE usage_date = '2026-09-09'; DELETE FROM anon_daily_message_count WHERE usage_date = '2026-09-09'");
  await database.orm.public.PiSession.create({ id: SESSION_ID, metadata: METADATA });
});

after(async () => {
  try { await Promise.all([resources.database?.close(), resources.pool?.end()]); }
  finally { await resources.postgres?.stop(); }
});
