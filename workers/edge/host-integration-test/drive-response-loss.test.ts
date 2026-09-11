import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { once } from "node:events";
import { pool, IDENTITY } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";
import type { LostReplyStage } from "./lost-reply.ts";

interface Admission { state: string; quota_refunded_at: Date | null; settled_at: Date | null }
interface Usage { scope: string; requests: string; input_tokens: string; output_tokens: string; cost_usd: string }

async function responseLossWithQueryOutage(context: TestContext, stage: LostReplyStage, terminalCount: string) {
  const { worker } = await businessWorker(context, { TEST_LOST_REPLY: stage, TEST_WITNESS_OUTAGE: "true" });
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: context.signal }).then(() => true, () => false);
  const post = async (path: string) => {
    const response = await worker.dispatchFetch(`https://host.test/${path}`, { method: "POST", body: JSON.stringify(submission), signal: context.signal });
    return { status: response.status, body: await response.text() };
  };
  assert.equal((await post("submit")).status, 200);
  assert.ok(Number((await post("evidence-failure")).body) >= 1, "An actual native result read must fail before checking pending state");
  const pending = await pool.query<Admission>("SELECT a.state,a.quota_refunded_at,s.settled_at FROM agent_admissions a JOIN agent_settlements s USING(operation_id)");
  assert.deepEqual(pending.rows, [{ state: "accepted", quota_refunded_at: null, settled_at: null }]);
  assert.equal((await pool.query<{ message_count: string }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY])).rows[0]?.message_count, "1");
  assert.equal((await pool.query<{ count: string }>("SELECT count(*) FROM daily_usage")).rows[0]?.count, "0");
  assert.equal((await pool.query<{ count: string }>("SELECT count(*) FROM pi_records WHERE kind='entry' AND payload->'message'->>'role'='assistant'")).rows[0]?.count, "1");
  assert.equal((await pool.query<{ count: string }>("SELECT count(*) FROM pi_scalar_values WHERE namespace='pi.result'")).rows[0]?.count, terminalCount);
  assert.equal((await post("restore-evidence")).status, 200);
  assert.equal(await settled, true, "The existing native scheduled callback must finish after evidence reads recover");
  const final = await pool.query<Admission>("SELECT a.state,a.quota_refunded_at,s.settled_at FROM agent_admissions a JOIN agent_settlements s USING(operation_id)");
  assert.ok(final.rows[0]);
  assert.equal(final.rows[0].state, "settled");
  assert.equal(final.rows[0].quota_refunded_at, null);
  assert.ok(final.rows[0].settled_at);
  assert.deepEqual((await pool.query("SELECT value->>'status' AS status FROM pi_scalar_values WHERE namespace='pi.result'")).rows, [{ status: "completed" }]);
  const charged = await pool.query<Usage>("SELECT scope,requests,input_tokens,output_tokens,cost_usd FROM daily_usage ORDER BY scope");
  assert.equal(charged.rows.length, 1);
  assert.equal(charged.rows[0]?.requests, "1");
  assert.equal(Number((await post("reopen-report")).body), 1);
  assert.equal((await post("wake")).status, 200);
  assert.equal((await post("wake")).status, 200);
  assert.deepEqual((await pool.query<Usage>("SELECT scope,requests,input_tokens,output_tokens,cost_usd FROM daily_usage ORDER BY scope")).rows, charged.rows);
  assert.equal((await pool.query<{ message_count: string }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY])).rows[0]?.message_count, "1");
}

void test("a committed intermediate drive survives lost acknowledgement and a held native evidence outage", { timeout: 150_000 }, async (context) => {
  await responseLossWithQueryOutage(context, "drive", "0");
});

void test("a committed terminal survives lost acknowledgement and a held native evidence outage", { timeout: 150_000 }, async (context) => {
  await responseLossWithQueryOutage(context, "terminal", "1");
});
