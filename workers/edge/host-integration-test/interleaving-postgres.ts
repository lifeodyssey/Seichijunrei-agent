import type { TestContext } from "node:test";
import { pool, IDENTITY, SESSION } from "./postgres.ts";

/** A real conversation row lock pauses the native Prisma admission statement at PostgreSQL. */
export async function holdConversation(context: TestContext) {
  await pool.query("INSERT INTO sessions (id, user_id) VALUES ($1, $2)", [SESSION, IDENTITY]);
  const locker = await pool.connect();
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try { await locker.query("ROLLBACK"); } finally { locker.release(); }
  };
  context.after(release);
  await locker.query("BEGIN");
  await locker.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [SESSION]);
  const process = await locker.query<{ pid: number }>("SELECT pg_backend_pid() pid");
  const pid = process.rows[0]?.pid;
  if (pid === undefined) throw new Error("The lock owner has no PostgreSQL backend");
  return { pid, release };
}

/** Poll actual lock ownership, with the test signal as a deadlock guard; no elapsed-time assertion. */
export async function blockedAdmission(locker: number, signal: AbortSignal) {
  for (;;) {
    signal.throwIfAborted();
    const blocked = await pool.query<{ pid: number; query: string }>(
      "SELECT pid, query FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)) AND state='active'", [locker]);
    if (blocked.rows.length) return blocked.rows;
  }
}
