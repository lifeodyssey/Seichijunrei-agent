import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { pool, IDENTITY } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";

const entry = new URL("./persistence-windows.worker.ts", import.meta.url);
const post = { method: "POST", body: JSON.stringify(submission) };

void test("failed durable scan registration prevents every business admission write", async (context) => {
  const { worker } = await businessWorker(context, {}, entry);
  const armed = await worker.dispatchFetch("https://host.test/arm-scan", post);
  assert.equal(armed.status, 200, await armed.text());
  const response = await worker.dispatchFetch("https://host.test/submit", post);
  assert.equal(response.status, 500, await response.text());
  const report = await worker.dispatchFetch("https://host.test/report", post);
  assert.deepEqual(await report.json(), { observations: [{ boundary: "scan-failure", admissions: 0, state: null, open: 0, intervals: 0 }], wakeCalls: 0 });
  assert.deepEqual((await pool.query("SELECT * FROM agent_admissions")).rows, []);
  assert.deepEqual((await pool.query("SELECT * FROM agent_open_operations")).rows, []);
  assert.deepEqual((await pool.query("SELECT * FROM agent_settlements")).rows, []);
  assert.deepEqual((await pool.query("SELECT * FROM anon_daily_message_count")).rows, []);
});

void test("the durable recurring scan settles accepted work after its first operation wake registration fails", { timeout: 60_000 }, async (context) => {
  const { worker } = await businessWorker(context, {}, entry);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: context.signal });
  void settled.catch(() => undefined);
  const armed = await worker.dispatchFetch("https://host.test/arm-wake", post);
  assert.equal(armed.status, 200, await armed.text());
  const response = await worker.dispatchFetch("https://host.test/submit", post);
  assert.equal(response.status, 500, await response.text());
  const report = await worker.dispatchFetch("https://host.test/report", post);
  const snapshot = await report.json() as { observations: unknown[] };
  assert.deepEqual(snapshot.observations, [{ boundary: "first-wake-failure", admissions: 1, state: "accepted", open: 1, intervals: 1 }]);
  const pending = await pool.query<{ operation_id: string }>("SELECT operation_id FROM agent_admissions");
  assert.ok(pending.rows[0]?.operation_id);
  await settled;
  const final = await pool.query<{ state: string; quota_refunded_at: Date | null; settled_at: Date | null }>("SELECT a.state,a.quota_refunded_at,s.settled_at FROM agent_admissions a JOIN agent_settlements s USING(operation_id)");
  assert.equal(final.rows[0]?.state, "settled");
  assert.equal(final.rows[0].quota_refunded_at, null);
  assert.ok(final.rows[0].settled_at);
  const result = await pool.query("SELECT value->>'status' AS status FROM pi_scalar_values WHERE namespace='pi.result' AND key=$1", [pending.rows[0].operation_id]);
  assert.deepEqual(result.rows, [{ status: "completed" }]);
  assert.deepEqual((await pool.query("SELECT * FROM agent_open_operations")).rows, []);
  const quota = await pool.query("SELECT message_count::integer AS count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY]);
  assert.deepEqual(quota.rows, [{ count: 1 }]);
});
