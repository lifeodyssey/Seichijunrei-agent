import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { pool, SESSION, IDENTITY } from "./postgres.ts";
import { businessWorker, submission } from "./worker.ts";

void test("the independent obligation scan settles a terminal beyond the admission page without its auxiliary index", async (context) => {
  const { worker } = await businessWorker(context);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_terminal");
  const terminal = once(observer, "notification", { signal: AbortSignal.any([context.signal, AbortSignal.timeout(30_000)]) }).then(() => true, () => false);
  await pool.query("ALTER TABLE agent_settlements ADD CONSTRAINT host_test_billing_outage CHECK (settled_at IS NULL)");
  try {
    const response = await worker.dispatchFetch("https://host.test/submit", { method: "POST", body: JSON.stringify(submission) });
    const responseBody = await response.text();
    assert.equal(response.status, 200, responseBody);
    const accepted = JSON.parse(responseBody) as { operationId: string };
    assert.equal(await terminal, true);
    const failed = await worker.dispatchFetch("https://host.test/wake", { method: "POST", body: JSON.stringify(submission) });
    assert.equal(failed.status, 500, await failed.text());
    await pool.query(`INSERT INTO agent_admissions (id, session_id, client_message_id, kind, operation_id, identity_id, payer, request_digest, state)
      SELECT ('00000000-0000-7000-8000-' || lpad(i::text, 12, '0'))::uuid, $1, 'older-' || i, 'model', 'unknown-' || i, $2, 'anon', 'unresolved', 'accepted'
      FROM generate_series(1, 50) AS i`, [SESSION, IDENTITY]);
    await pool.query("DELETE FROM agent_open_operations WHERE operation_id = $1", [accepted.operationId]);
    await pool.query("ALTER TABLE agent_settlements DROP CONSTRAINT host_test_billing_outage");
    const recovered = await worker.dispatchFetch("https://host.test/wake", { method: "POST", body: JSON.stringify(submission) });
    assert.equal(recovered.status, 200, await recovered.text());
    const rows = await pool.query<{ state: string; settled_at: Date | null }>("SELECT a.state, s.settled_at FROM agent_admissions a JOIN agent_settlements s USING (operation_id) WHERE a.operation_id = $1", [accepted.operationId]);
    assert.equal(rows.rows[0]?.state, "settled");
    assert.ok(rows.rows[0].settled_at);
    const unresolved = await pool.query<{ count: string }>("SELECT count(*) FROM agent_admissions WHERE state = 'accepted'");
    assert.equal(Number(unresolved.rows[0]?.count), 50);
    const quota = await pool.query<{ message_count: number }>("SELECT message_count FROM anon_daily_message_count WHERE anon_id = $1", [IDENTITY]);
    assert.equal(Number(quota.rows[0]?.message_count), 1);
  } finally { await pool.query("ALTER TABLE agent_settlements DROP CONSTRAINT IF EXISTS host_test_billing_outage"); }
});
