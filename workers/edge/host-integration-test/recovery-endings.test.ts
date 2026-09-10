import assert from "node:assert/strict";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { pool, IDENTITY } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";

async function settlementObserver(context: TestContext, timeoutMs: number) {
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  return { settled: once(observer, "notification", { signal: AbortSignal.any([context.signal, AbortSignal.timeout(timeoutMs)]) }).then(() => true, () => false) };
}

async function assertCompleted(operationId: string) {
  const business = await pool.query("SELECT a.state,a.quota_refunded_at,s.settled_at IS NOT NULL AS settled FROM agent_admissions a JOIN agent_settlements s USING(operation_id) WHERE operation_id=$1", [operationId]);
  assert.deepEqual(business.rows, [{ state: "settled", quota_refunded_at: null, settled: true }]);
  const terminal = await pool.query("SELECT value->>'status' AS status FROM pi_scalar_values WHERE namespace='pi.result' AND key=$1", [operationId]);
  assert.deepEqual(terminal.rows, [{ status: "completed" }]);
  const open = await pool.query("SELECT operation_id FROM agent_open_operations WHERE operation_id=$1", [operationId]);
  assert.deepEqual(open.rows, []);
  const quota = await pool.query<{ message_count: number }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY]);
  assert.equal(Number(quota.rows[0]?.message_count), 1);
}

void test("the same live host repairs business commit after accept through its recurring SDK scan", { timeout: 90_000 }, async (context) => {
  const { worker } = await businessWorker(context);
  const { settled } = await settlementObserver(context, 45_000);
  await pool.query("ALTER TABLE agent_open_operations ADD CONSTRAINT host_test_same_instance CHECK(false)");
  try {
    const response = await worker.dispatchFetch("https://host.test/submit", { method: "POST", body: JSON.stringify(submission) });
    assert.equal(response.status, 500, await response.text());
    const pending = await pool.query("SELECT state,quota_refunded_at FROM agent_admissions WHERE client_message_id='first'");
    assert.deepEqual(pending.rows, [{ state: "pending", quota_refunded_at: null }]);
    assert.deepEqual((await pool.query("SELECT operation_id FROM agent_settlements")).rows, []);
    assert.deepEqual((await pool.query("SELECT operation_id FROM agent_open_operations")).rows, []);
    const native = await pool.query("SELECT v.key FROM pi_scalar_values v JOIN agent_admissions a ON a.operation_id=v.key WHERE v.namespace='pi.op.meta'");
    assert.equal(native.rows.length, 1, "Native accept must have committed despite the failed business transaction");
  } finally {
    await pool.query("ALTER TABLE agent_open_operations DROP CONSTRAINT host_test_same_instance");
  }
  assert.equal(await settled, true, "The same host's existing SDK scan must finish without a restart or another client request");
  const admission = await pool.query<{ operation_id: string }>("SELECT operation_id FROM agent_admissions WHERE client_message_id='first'");
  assert.ok(admission.rows[0]);
  await assertCompleted(admission.rows[0].operation_id);
});

void test("an operation accepted after create remains pending during retry and completes from its native deadline wake", { timeout: 120_000 }, async (context) => {
  const { worker } = await businessWorker(context, { TEST_RETRY: "true" });
  const { settled } = await settlementObserver(context, 90_000);
  const response = await worker.dispatchFetch("https://host.test/submit", { method: "POST", body: JSON.stringify(submission) });
  const responseBody = await response.text();
  assert.equal(response.status, 200, responseBody);
  const accepted = JSON.parse(responseBody) as { kind: string; operationId: string };
  assert.equal(accepted.kind, "accepted");
  const report = await worker.dispatchFetch("https://host.test/retry-report", { method: "POST", body: JSON.stringify(submission),
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(45_000)]),
  }).then((response) => response, () => undefined);
  assert.ok(report, "An operation accepted after create must reach its native retry boundary");
  const reportBody = await report.text();
  assert.equal(report.status, 200, reportBody);
  const snapshot = JSON.parse(reportBody) as { notBefore: number; schedules: { type: string; time: number }[] };
  assert.deepEqual(snapshot.schedules.filter((schedule) => schedule.type !== "interval").map((schedule) => schedule.time), [Math.ceil(snapshot.notBefore / 1000)]);
  const pending = await pool.query("SELECT a.state,a.quota_refunded_at,s.settled_at FROM agent_admissions a JOIN agent_settlements s USING(operation_id) WHERE operation_id=$1", [accepted.operationId]);
  assert.deepEqual(pending.rows, [{ state: "accepted", quota_refunded_at: null, settled_at: null }]);
  const terminal = await pool.query("SELECT key FROM pi_scalar_values WHERE namespace='pi.result' AND key=$1", [accepted.operationId]);
  assert.deepEqual(terminal.rows, [], "A transient failure cannot create a false terminal result");
  assert.equal(await settled, true, "The persisted SDK retry wake must complete without a client retry");
  await assertCompleted(accepted.operationId);
});
