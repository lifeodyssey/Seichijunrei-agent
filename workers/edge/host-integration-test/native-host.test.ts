import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { once } from "node:events";
import { pool, IDENTITY } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";

void test("the actual scheduled host admits on Neon and settles without another client request", async (context) => {
  const { worker } = await businessWorker(context);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  const committed = once(observer, "notification", { signal: AbortSignal.timeout(30_000) }).then(() => true, () => false);
  const admitted = await worker.dispatchFetch("https://host.test/submit", { method: "POST", body: JSON.stringify(submission) });
  const body = await admitted.text();
  assert.equal(admitted.status, 200, body);
  const admission = JSON.parse(body) as { kind: string; operationId: string };
  assert.equal(admission.kind, "accepted");
  assert.equal(await committed, true, "The native scheduled callback must commit settlement without another request");
  const rows = await pool.query<{ state: string; settled_at: Date | null; last_usage_seq: number }>("SELECT a.state, s.settled_at, s.last_usage_seq FROM agent_admissions a JOIN agent_settlements s USING (operation_id) WHERE a.operation_id = $1", [admission.operationId]);
  assert.equal(rows.rows[0]?.state, "settled");
  assert.ok(rows.rows[0].settled_at);
  assert.ok(rows.rows[0].last_usage_seq > 0);
  const quota = await pool.query<{ message_count: number }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id = $1", [IDENTITY]);
  assert.equal(Number(quota.rows[0]?.message_count), 1);
  const open = await pool.query<{ count: string }>("SELECT count(*) FROM agent_open_operations WHERE operation_id = $1", [admission.operationId]);
  assert.equal(Number(open.rows[0]?.count), 0);
});

void test("a fresh host lost after native acceptance recovers from its existing scan with no client retry", async (context) => {
  const resources = await businessWorker(context);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  const committed = once(observer, "notification", { signal: AbortSignal.timeout(45_000) }).then(() => true, () => false);
  await pool.query("ALTER TABLE agent_open_operations ADD CONSTRAINT host_test_lost_reply CHECK (false)");
  context.after(async () => { await pool.query("ALTER TABLE agent_open_operations DROP CONSTRAINT IF EXISTS host_test_lost_reply"); });
  const response = await resources.worker.dispatchFetch("https://host.test/submit", { method: "POST", body: JSON.stringify(submission) });
  assert.equal(response.status, 500, await response.text());
  const pending = await pool.query<{ operation_id: string; state: string }>("SELECT operation_id, state FROM agent_admissions WHERE client_message_id = 'first'");
  assert.equal(pending.rows[0]?.state, "pending");
  await pool.query("ALTER TABLE agent_open_operations DROP CONSTRAINT host_test_lost_reply");
  await resources.restart();
  assert.equal(await committed, true, "The persisted native interval must discover the accepted operation after restart");
  const rows = await pool.query<{ state: string; settled_at: Date | null }>("SELECT a.state, s.settled_at FROM agent_admissions a JOIN agent_settlements s USING (operation_id) WHERE a.operation_id = $1", [pending.rows[0].operation_id]);
  assert.equal(rows.rows[0]?.state, "settled");
  assert.ok(rows.rows[0].settled_at);
  const quota = await pool.query<{ message_count: number }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id = $1", [IDENTITY]);
  assert.equal(Number(quota.rows[0]?.message_count), 1);
});

async function lostReplyCase(context: TestContext, stage: "accept" | "terminal", status: number) {
  const { worker } = await businessWorker(context, { TEST_LOST_REPLY: stage });
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  const committed = once(observer, "notification", { signal: AbortSignal.timeout(45_000) }).then(() => true, () => false);
  const response = await worker.dispatchFetch("https://host.test/submit", { method: "POST", body: JSON.stringify(submission) });
  assert.equal(response.status, status, await response.text());
  assert.equal(await committed, true, "Unknown native response loss must recover without cancellation");
  const rows = await pool.query<{ state: string; quota_refunded_at: Date | null }>("SELECT state, quota_refunded_at FROM agent_admissions WHERE client_message_id = 'first'");
  assert.equal(rows.rows[0]?.state, "settled");
  assert.equal(rows.rows[0].quota_refunded_at, null);
  const quota = await pool.query<{ message_count: number }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id = $1", [IDENTITY]);
  assert.equal(Number(quota.rows[0]?.message_count), 1);
  const report = await worker.dispatchFetch("https://host.test/reopen-report", { method: "POST", body: JSON.stringify(submission) });
  assert.equal(await report.json(), 1);
}

void test("accepted-but-thrown native Neon commit survives first failed reattachment and settles legitimate work", async (context) => {
  await lostReplyCase(context, "accept", 500);
});

void test("terminal-but-thrown native Neon commit survives first failed reattachment without cancelling or rebilling", async (context) => {
  await lostReplyCase(context, "terminal", 200);
});

void test("a waiting native operation retains only its deadline wake instead of creating immediate wake loops", async (context) => {
  const { worker } = await businessWorker(context, { TEST_RETRY: "true" });
  const response = await worker.dispatchFetch("https://host.test/submit", { method: "POST", body: JSON.stringify(submission) });
  assert.equal(response.status, 200, await response.text());
  const report = await worker.dispatchFetch("https://host.test/retry-report", { method: "POST", body: JSON.stringify(submission) });
  const body = await report.text();
  assert.equal(report.status, 200, body);
  const snapshot = JSON.parse(body) as { notBefore: number; schedules: { type: string; time: number }[] };
  assert.deepEqual(snapshot.schedules.filter((schedule) => schedule.type !== "interval").map((schedule) => schedule.time), [Math.ceil(snapshot.notBefore / 1000)]);
});
