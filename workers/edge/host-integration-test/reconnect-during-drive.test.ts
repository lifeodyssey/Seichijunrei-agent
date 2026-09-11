import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { reconnectWorker } from "./reconnect-worker.ts";
import { chatBody, chatHeaders } from "./default-worker.ts";
import { pool, IDENTITY } from "./postgres.ts";

void test("a disconnected production client reattaches before its native model drive completes without a second admission", { timeout: 60_000 }, async (context) => {
  const { worker, entered, release, requests } = await reconnectWorker(context);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: context.signal }).then(() => true, () => false);
  const options = { method: "POST", headers: chatHeaders, body: chatBody };
  const first = await worker.dispatchFetch("https://host.test/v1/chat", options);
  assert.equal(first.status, 200);
  const operationId = first.headers.get("x-operation-id");
  await first.body?.cancel();
  await entered;
  // The model cannot complete until this request returns; the timeout only guards a deadlock.
  const reconnected = await worker.dispatchFetch("https://host.test/v1/chat", {
    ...options, signal: AbortSignal.any([context.signal, AbortSignal.timeout(20_000)]),
  }).then((response) => response, () => undefined);
  assert.ok(reconnected, "The existing turn must be watchable while its model response is still withheld");
  assert.equal(reconnected.status, 200);
  assert.equal(reconnected.headers.get("x-operation-id"), operationId);
  const reading = reconnected.text();
  const changed = await worker.dispatchFetch("https://host.test/v1/chat", {
    ...options, body: JSON.stringify({ messages: [{ id: "user", role: "user", parts: [{ type: "text", text: "A changed request" }] }] }),
    signal: AbortSignal.any([context.signal, AbortSignal.timeout(20_000)]),
  });
  assert.equal(changed.status, 409, await changed.text());
  release();
  const wire = await reading;
  assert.match(wire, /Reconnected to the same native turn/);
  assert.equal(wire.match(/\[DONE\]/g)?.length, 1);
  assert.doesNotMatch(wire, /server-private-key/);
  assert.equal(await settled, true);
  assert.equal(requests.length, 1);
  const admissions = await pool.query<{ state: string; operation_id: string }>("SELECT state,operation_id FROM agent_admissions");
  assert.deepEqual(admissions.rows, [{ state: "settled", operation_id: operationId }]);
  const quota = await pool.query<{ message_count: number }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY]);
  assert.equal(Number(quota.rows[0]?.message_count), 1);
  const billed = await pool.query<{ requests: number; input_tokens: number; output_tokens: number; cost_usd: string }>(
    "SELECT requests::integer,input_tokens::integer,output_tokens::integer,cost_usd::text FROM daily_usage WHERE scope='anon'",
  );
  assert.equal(billed.rows.length, 1);
  const bill = billed.rows[0];
  assert.ok(bill);
  assert.equal(bill.requests, 1);
  assert.equal(bill.input_tokens, 30);
  assert.equal(bill.output_tokens, 20);
  assert.ok(Number(bill.cost_usd) > 0, "The one execution must be charged rather than silently omitted");
});
