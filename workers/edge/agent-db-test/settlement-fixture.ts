import { after, before, beforeEach } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { AGENT_DB_SETUP_BUDGET, startTestPostgres, type TestPostgres } from "@animichi/test-postgres";
import postgresClient, { type PostgresClient } from "@prisma/orm-postgres/runtime";
import contractJson from "@animichi/pi-session-neon/contract" with { type: "json" };
import type { Contract } from "@animichi/pi-session-neon/types";

export let db: PostgresClient<Contract>;
let postgres: TestPostgres | undefined;
const resources: { db?: PostgresClient<Contract> } = {};
export const SESSION = "settlement-session";

before(async () => {
  postgres = await startTestPostgres({ database: "native_settlement", budget: AGENT_DB_SETUP_BUDGET });
  await promisify(execFile)("pnpm", ["exec", "prisma", "db", "migrate", "--db", postgres.dsn, "--json"], {
    cwd: fileURLToPath(new URL("../../../packages/pi-session-neon/", import.meta.url).href),
    env: { ...process.env, DO_NOT_TRACK: "1" },
  });
  db = resources.db = postgresClient<Contract>({ contractJson, url: postgres.dsn });
});

beforeEach(async () => {
  await db.orm.public.PiSession.where((row) => row.id.in([SESSION, "other-session"])).deleteAll();
  await db.runtime().execute(db.raw.sql`DELETE FROM daily_usage`.affectedCount().build());
  await db.runtime().execute(db.raw.sql`DELETE FROM anon_daily_message_count`.affectedCount().build());
  await session(SESSION);
});

after(async () => {
  try { await resources.db?.close(); }
  finally { await postgres?.stop(); }
});

export function session(id: string) {
  return db.orm.public.PiSession.create({ id, metadata: { id, createdAt: 1, storageVersion: 1 } });
}
