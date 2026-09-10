import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { reconnectWorker } from "./reconnect-worker.ts";
import { defaultWorker, chatBody, chatHeaders } from "./default-worker.ts";
import { pool, IDENTITY, SESSION } from "./postgres.ts";

const streamUrl = `https://host.test/v1/conversations/${SESSION}/stream`;

void test("GET resumes a native drive without the original input or a second admission", { timeout: 60_000 }, async (context) => {
  const { worker, entered, release, requests } = await reconnectWorker(context);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: context.signal }).then(() => true, () => false);
  const first = await worker.dispatchFetch("https://host.test/v1/chat", { method: "POST", headers: chatHeaders, body: chatBody });
  assert.equal(first.status, 200);
  const operationId = first.headers.get("x-operation-id");
  assert.ok(operationId);
  await first.body?.cancel();
  await entered;
  const options = { signal: AbortSignal.any([context.signal, AbortSignal.timeout(20_000)]) };
  const resumed = await worker.dispatchFetch(`${streamUrl}?operation_id=${operationId}`, options);
  assert.equal(resumed.status, 200);
  assert.equal(resumed.headers.get("x-operation-id"), operationId);
  const reading = resumed.text();
  const discovered = await worker.dispatchFetch(streamUrl, options);
  assert.equal(discovered.status, 200);
  assert.equal(discovered.headers.get("x-operation-id"), operationId);
  await discovered.body?.cancel();
  const absent = await worker.dispatchFetch(`${streamUrl}?operation_id=unknown`, options);
  assert.equal(absent.status, 404, await absent.text());
  release();
  const wire = await reading;
  assert.match(wire, /"type":"data-response"/);
  assert.match(wire, /Reconnected to the same native turn/);
  assert.equal(wire.match(/\[DONE\]/g)?.length, 1);
  assert.doesNotMatch(wire, /server-private-key/);
  assert.equal(await settled, true);
  assert.equal(requests.length, 1);
  assert.deepEqual((await pool.query("SELECT state,operation_id FROM agent_admissions")).rows, [{ state: "settled", operation_id: operationId }]);
  assert.deepEqual((await pool.query("SELECT message_count FROM anon_daily_message_count WHERE anon_id=$1", [IDENTITY])).rows, [{ message_count: "1" }]);
});

void test("missing or foreign conversations cannot create native state through stream lookup", async (context) => {
  const { worker, requests } = await defaultWorker(context);
  const missing = await worker.dispatchFetch(streamUrl);
  const missingBody = await missing.text();
  assert.equal(missing.status, 404, missingBody);
  await pool.query("INSERT INTO sessions(id,user_id) VALUES($1,'other-owner')", [SESSION]);
  const forbidden = await worker.dispatchFetch(streamUrl);
  const forbiddenBody = await forbidden.text();
  assert.equal(forbidden.status, 404, forbiddenBody);
  assert.equal(forbiddenBody, missingBody);
  assert.equal((await pool.query("SELECT id FROM pi_sessions")).rowCount, 0);
  assert.equal((await pool.query("SELECT operation_id FROM agent_admissions")).rowCount, 0);
  assert.equal(requests.length, 0);
});

void test("an owned empty conversation returns the official no-stream status without booting a model", async (context) => {
  const { worker, requests } = await defaultWorker(context);
  await pool.query("INSERT INTO sessions(id,user_id) VALUES($1,$2)", [SESSION, IDENTITY]);
  const response = await worker.dispatchFetch(streamUrl);
  assert.equal(response.status, 204);
  assert.equal((await pool.query("SELECT id FROM pi_sessions")).rowCount, 0);
  assert.equal(requests.length, 0);
});

void test("cold stream lookup restores a completed native answer without billing or executing it again", { timeout: 60_000 }, async (context) => {
  const resources = await defaultWorker(context);
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *; LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: context.signal }).then(() => true, () => false);
  const first = await resources.worker.dispatchFetch("https://host.test/v1/chat", { method: "POST", headers: chatHeaders, body: chatBody });
  const operationId = first.headers.get("x-operation-id");
  assert.match(await first.text(), /Hello from the native host/);
  assert.equal(await settled, true);
  const before = await pool.query("SELECT * FROM agent_settlements");
  const restarted = await resources.restart();
  const response = await restarted.dispatchFetch(streamUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-operation-id"), operationId);
  assert.match(await response.text(), /Hello from the native host/);
  assert.equal(resources.requests.length, 1);
  assert.deepEqual((await pool.query("SELECT * FROM agent_settlements")).rows, before.rows);
  await pool.query("UPDATE sessions SET user_id='other-owner' WHERE id=$1", [SESSION]);
  const forbidden = await restarted.dispatchFetch(streamUrl);
  assert.equal(forbidden.status, 404, await forbidden.text());
});
