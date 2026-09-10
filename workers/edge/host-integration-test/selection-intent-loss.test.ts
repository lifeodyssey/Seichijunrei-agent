import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { pool, SESSION, IDENTITY } from "./postgres.ts";
import { businessWorker } from "./worker.ts";
import { seedSelectionOffer, selectedItinerary } from "./seed-selection.ts";

void test("a scheduled recovery executes committed selection input after its acknowledgement is lost before append", { timeout: 60_000 }, async (context) => {
  await seedSelectionOffer();
  await pool.query(`CREATE FUNCTION host_test_selection_settled() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_notify('host_test_selection_settled', NEW.client_message_id); RETURN NEW; END $$;
    CREATE TRIGGER host_test_selection_settled AFTER UPDATE ON agent_admissions FOR EACH ROW
    WHEN (NEW.kind = 'selection' AND OLD.state = 'pending' AND NEW.state = 'settled') EXECUTE FUNCTION host_test_selection_settled()`);
  context.after(async () => { await pool.query("DROP TRIGGER host_test_selection_settled ON agent_admissions; DROP FUNCTION host_test_selection_settled()"); });
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_selection_settled");
  const settled = once(observer, "notification", { signal: context.signal });
  void settled.catch(() => undefined);
  const entered = Promise.withResolvers<Request>();
  const release = Promise.withResolvers<undefined>();
  context.after(() => { release.resolve(undefined); });
  let calls = 0;
  const { worker } = await businessWorker(context, { TEST_SELECTION_INTENT_LOSS: "true" }, new URL("./persistence-windows.worker.ts", import.meta.url), async (request) => {
    calls += 1; entered.resolve(request.clone()); await release.promise;
    return Response.json(selectedItinerary);
  });
  const selection = { of: "points", pointIds: ["point-native"], origin: null, locale: "ja" };
  const input = { sessionId: SESSION, identityId: IDENTITY, payer: "anon", clientMessageId: "selection-lost", selection };
  const post = { method: "POST", body: JSON.stringify(input), signal: context.signal };
  const response = await worker.dispatchFetch("https://host.test/selection", post);
  assert.equal(response.status, 500, await response.text());
  assert.deepEqual(await (await entered.promise).json(), { point_ids: ["point-native"] });
  const pending = await pool.query("SELECT kind,state,operation_id,selection_request FROM agent_admissions WHERE client_message_id='selection-lost'");
  assert.deepEqual(pending.rows, [{ kind: "selection", state: "pending", operation_id: null, selection_request: selection }]);
  assert.deepEqual((await pool.query("SELECT * FROM pi_records WHERE payload->>'customType'='animichi.selection'")).rows, []);
  release.resolve(undefined);
  await settled;
  const committed = await pool.query("SELECT payload->'data'->>'requestKey' AS request_key,payload->'data'->>'origin' AS origin FROM pi_records WHERE payload->>'customType'='animichi.selection'");
  assert.deepEqual(committed.rows, [{ request_key: "selection-lost", origin: "server" }]);
  assert.deepEqual((await pool.query("SELECT state FROM agent_admissions WHERE client_message_id='selection-lost'")).rows, [{ state: "settled" }]);
  assert.equal(calls, 1);
  const woken = await worker.dispatchFetch("https://host.test/wake", post);
  assert.equal(woken.status, 200, await woken.text());
  assert.deepEqual((await pool.query("SELECT payload->'data'->>'requestKey' AS request_key,payload->'data'->>'origin' AS origin FROM pi_records WHERE payload->>'customType'='animichi.selection'")).rows, committed.rows);
  assert.equal(calls, 1);
  assert.deepEqual((await pool.query("SELECT * FROM anon_daily_message_count")).rows, []);
  assert.deepEqual((await pool.query("SELECT * FROM agent_open_operations")).rows, []);
  assert.deepEqual((await pool.query("SELECT * FROM agent_settlements")).rows, []);
});
