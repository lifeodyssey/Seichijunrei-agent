import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { once } from "node:events";
import type { Notification } from "pg";
import { operationMeta } from "@earendil-works/pi-agent-core/harness/session";
import { pool, IDENTITY } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";
import { blockedAdmission } from "./interleaving-postgres.ts";
import type { InterleavingReport } from "./interleaving.worker.ts";

void test("a new request and SDK callback wait for failed Neon reattachment before any business work", { timeout: 60_000 }, async (context) => {
  const { worker } = await businessWorker(context, { TEST_LOST_REPLY: "accept" }, new URL("./reattach-contention.worker.ts", import.meta.url));
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: context.signal }).then((events) => events as [Notification], () => undefined);
  const pending: Promise<unknown>[] = [];
  const post = (path: string, input = submission) => {
    const request = worker.dispatchFetch(`https://host.test${path}`, { method: "POST", body: JSON.stringify(input), signal: context.signal })
      .then(async (response) => ({ status: response.status, body: await response.text() }));
    pending.push(request.catch(() => undefined)); return request;
  };
  const lost = await post("/submit");
  assert.equal(lost.status, 500, lost.body);
  const initial = await pool.query<{ operation_id: string; state: string }>("SELECT operation_id,state FROM agent_admissions");
  assert.equal(initial.rowCount, 1); assert.equal(initial.rows[0]?.state, "pending");
  const operationId = initial.rows[0].operation_id;
  const locked = await holdNativeMetadata(context);
  const reopening = post("/reattach");
  try {
    const blocked = await blockedAdmission(locked.pid, context.signal);
    assert.equal(blocked.length, 1);
    assert.match(blocked[0]?.query ?? "", /pi_sessions/);
    assert.match(blocked[0]?.query ?? "", /metadata/);
    const second = post("/submit", { ...submission, clientMessageId: "second", text: "A conflicting new request" });
    const scheduled = await post("/schedule"); assert.equal(scheduled.status, 200, scheduled.body);
    const contenders = await post("/contenders"); assert.equal(contenders.status, 200, contenders.body);
    const during = JSON.parse(contenders.body) as InterleavingReport;
    await assertPendingReattachment(during, initial.rows, operationId);
    context.diagnostic(JSON.stringify({ stage: "blocked metadata read", query: blocked[0]?.query, report: during }));
    await locked.release();
    const failed = await reopening; assert.equal(failed.status, 500, failed.body);
    const blockedRequest = await second; assert.equal(blockedRequest.status, 200, blockedRequest.body);
    assert.deepEqual(JSON.parse(blockedRequest.body), { kind: "blocked", operationId: null });
    const event = await settled;
    assert.ok(event, "The SDK callback must recover and settle the legitimate original operation");
    assert.equal(event[0].channel, "host_test_settled"); assert.equal(event[0].payload, operationId);
    const rows = await pool.query("SELECT operation_id,state,quota_refunded_at FROM agent_admissions");
    assert.deepEqual(rows.rows, [{ operation_id: operationId, state: "settled", quota_refunded_at: null }]);
    assert.deepEqual((await pool.query("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY])).rows, [{ message_count: "1" }]);
    assert.equal((await pool.query("SELECT operation_id FROM agent_open_operations")).rowCount, 0);
    const report = await post("/report"); assert.equal(report.status, 200, report.body);
    const final = JSON.parse(report.body) as InterleavingReport;
    assert.equal(final.initialized, 1); assert.equal(final.maxActive, 1); assert.equal(final.maxDrives, 1);
    assert.equal(final.sessions, 2); assert.equal(final.harnesses, 2); assert.equal(final.driveCalls, 1);
    const failures = await post("/reopen-report"); assert.equal(failures.status, 200, failures.body);
    assert.equal(JSON.parse(failures.body), 1);
    context.diagnostic(JSON.stringify({ stage: "recovered", operationId, report: final, failedAttachments: 1 }));
  } finally { await locked.release(); await Promise.all(pending); }
});

async function assertPendingReattachment(during: InterleavingReport, initial: { operation_id: string; state: string }[], operationId: string) {
  assert.equal(during.requests, 2);
  assert.ok(during.callbacks >= 2, "Both the explicit reattach and actual SDK callback must have arrived");
  assert.equal(during.active, 0); assert.equal(during.maxActive, 1); assert.equal(during.driveCalls, 0);
  assert.equal(during.initialized, 1); assert.equal(during.sessions, 1); assert.equal(during.harnesses, 1);
  assert.deepEqual((await pool.query("SELECT operation_id,state FROM agent_admissions")).rows, initial);
  assert.deepEqual((await pool.query("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY])).rows, [{ message_count: "1" }]);
  assert.deepEqual((await pool.query("SELECT key FROM pi_scalar_values WHERE namespace=$1", [operationMeta("unused").namespace])).rows, [{ key: operationId }]);
  assert.equal((await pool.query("SELECT operation_id FROM agent_settlements WHERE settled_at IS NOT NULL")).rowCount, 0);
}

/** Block the actual metadata SELECT in NeonSessionRepo.open, without substituting that public API. */
async function holdNativeMetadata(context: TestContext) {
  const locker = await pool.connect(); let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    try { await locker.query("ROLLBACK"); } finally { locker.release(); }
  };
  context.after(release);
  await locker.query("BEGIN");
  await locker.query("LOCK TABLE pi_sessions IN ACCESS EXCLUSIVE MODE");
  const result = await locker.query<{ pid: number }>("SELECT pg_backend_pid() pid");
  const pid = result.rows[0]?.pid; assert.ok(pid);
  return { pid, release };
}
