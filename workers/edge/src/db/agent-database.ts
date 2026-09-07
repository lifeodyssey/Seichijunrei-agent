/// <reference types="@cloudflare/workers-types" />

/**
 * The agent tier's Neon connection (issue #1251). The edge writes the turn
 * tables itself from W1 on, so it needs the `agent_svc` DSN the container has
 * been getting from the Cloudflare Secrets Store binding
 * `AGENT_SVC_DATABASE_URL` (`docs/ops/secrets.md`, #912) — the binding is now
 * a Worker consumer as well as a container one.
 *
 * The WebSocket driver, not the HTTP one: the intake is a multi-statement
 * INTERACTIVE transaction (the run insert needs the message insert's id, and
 * the dedupe branch is decided between them), and `drizzle-orm/neon-http`
 * answers `transaction()` with "No transactions support in neon-http driver".
 * A pool is opened per unit of work and closed after it, the shape Neon
 * documents for Workers — an isolate may be evicted between requests, so a
 * pool that outlives one is a leaked connection.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import type { SQL } from "drizzle-orm";
import { readStoreOrString } from "../container/container-env.ts";

/**
 * The statement surface every agent-tier query is written against — the same narrow
 * executor `workers/users` uses (`DbExecutor`). Narrow on purpose: it is what
 * BOTH Postgres drivers expose, so the statements proven against a disposable
 * PostgreSQL container in `db-test/` are the very statements Neon runs.
 */
export interface AgentStatements {
  execute(query: SQL): Promise<{ rows: unknown[] }>;
}

/** Runs one unit of work inside one database transaction. */
export interface AgentTransactions {
  run<T>(work: (statements: AgentStatements) => Promise<T>): Promise<T>;
}

/** The `agent_svc` DSN, from the Secrets Store binding or a plain string. */
async function agentDsn(env: Record<string, unknown>): Promise<string> {
  const dsn = await readStoreOrString(env.AGENT_SVC_DATABASE_URL);
  if (dsn === undefined) throw new Error("AGENT_SVC_DATABASE_URL is not bound");
  return dsn;
}

/**
 * The agent data plane, already bound to the environment that names it: one
 * unit of work in, its result out.
 *
 * A caller that holds this needs to know nothing about pools or DSNs, which is
 * what lets a lane with a real PostgreSQL but no Neon endpoint drive a
 * composition end to end — the pool above speaks the Neon WebSocket protocol
 * and cannot reach a plain container (`agent-db-test/postgres-arm.ts`).
 */
export type AgentDatabase = <T>(work: (transactions: AgentTransactions) => Promise<T>) => Promise<T>;

/** The agent data plane this environment names. */
export function agentDatabaseIn(env: Record<string, unknown>): AgentDatabase {
  return (work) => withAgentDatabase(env, work);
}

/** Open the agent data plane for one unit of work, and close it after. */
export async function withAgentDatabase<T>(
  env: Record<string, unknown>,
  work: (transactions: AgentTransactions) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: await agentDsn(env) });
  try {
    return await work(poolTransactions(pool));
  } finally {
    await pool.end();
  }
}

/** Adapt a Neon pool to the transaction port. */
function poolTransactions(pool: Pool): AgentTransactions {
  const database = drizzle(pool);
  return { run: (work) => database.transaction((tx) => work(tx)) };
}
