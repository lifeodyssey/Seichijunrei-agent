import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { pool, SESSION } from "./postgres.ts";
import { defaultWorker, chatHeaders, chatBody } from "./default-worker.ts";
import { operationToolsNetwork } from "./operation-tools-fixture.ts";

void test("actual BYOK tools use the caller's translation model and requested Chinese locale without platform spending", async (context) => {
  const { worker, requests } = await defaultWorker(context, { TEST_IDENTITY: "member-native", TEST_USER_TYPE: "user" }, operationToolsNetwork(true));
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: AbortSignal.timeout(30_000) }).then(() => true, () => false);
  const response = await worker.dispatchFetch("https://host.test/v1/chat", { method: "POST", body: chatBody,
    headers: { ...chatHeaders, "x-locale": "zh", "x-byok-provider": "openai-compatible", "x-byok-base-url": "https://api.openai.com/v1", "x-byok-model": "gpt-4.1", "x-byok-key": "private-caller-key" } });
  assert.equal(response.status, 200);
  const wire = await response.text();
  assert.equal(await settled, true);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map((request) => request.headers.get("authorization")), Array<string>(3).fill("Bearer private-caller-key"));
  assert.deepEqual(requests.map((request) => new URL(request.url).hostname), Array<string>(3).fill("api.openai.com"));
  const translation = await pool.query<{ payer: string; source: string }>("SELECT payload->'message'->'details'->>'payer' payer,payload->'message'->'details'->>'source' source FROM pi_records WHERE payload->'message'->>'toolName'='translate_anime_title'");
  assert.deepEqual(translation.rows, [{ payer: "byok", source: "llm" }]);
  const city = await pool.query<{ city: string }>("SELECT payload->'message'->'details'->'rows'->0->>'city' city FROM pi_records WHERE payload->'message'->>'toolName'='search_bangumi'");
  assert.deepEqual(city.rows, [{ city: "东京" }]);
  const billing = await pool.query("SELECT scope,requests,input_tokens,output_tokens,cost_usd FROM daily_usage");
  assert.deepEqual(billing.rows, [{ scope: "byok", requests: "3", input_tokens: "90", output_tokens: "60", cost_usd: "0.000000" }]);
  const stored = await pool.query("SELECT value FROM pi_scalar_values UNION ALL SELECT payload FROM pi_records");
  assert.doesNotMatch(JSON.stringify(stored.rows) + wire, /private-caller-key|server-private-key/);
});

void test("a cold default host recovers the accepted operation's Japanese locale and shared GPS before executing catalog tools", async (context) => {
  const resources = await defaultWorker(context, {}, operationToolsNetwork(false, true));
  const observer = await pool.connect();
  context.after(async () => { try { await observer.query("UNLISTEN *"); } finally { observer.release(); } });
  await observer.query("UNLISTEN *");
  await observer.query("LISTEN host_test_settled");
  const settled = once(observer, "notification", { signal: AbortSignal.timeout(45_000) }).then(() => true, () => false);
  await pool.query("ALTER TABLE agent_open_operations ADD CONSTRAINT host_test_lost_reply CHECK(false)");
  context.after(async () => { await pool.query("ALTER TABLE agent_open_operations DROP CONSTRAINT IF EXISTS host_test_lost_reply"); });
  const response = await resources.worker.dispatchFetch("https://host.test/v1/chat", { method: "POST", headers: { ...chatHeaders, "x-locale": "ja" }, body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "Nearby" }] }], origin_lat: 35.5, origin_lng: 139.5 }) });
  assert.equal(response.status, 500, await response.text());
  await pool.query("ALTER TABLE agent_open_operations DROP CONSTRAINT host_test_lost_reply");
  await resources.restart();
  assert.equal(await settled, true);
  const city = await pool.query<{ city: string }>("SELECT payload->'message'->'details'->'rows'->0->>'city' city FROM pi_records WHERE session_id=$1 AND payload->'message'->>'toolName'='search_bangumi'", [SESSION]);
  assert.deepEqual(city.rows, [{ city: "東京" }]);
  assert.equal(resources.requests.length, 2);
  assert.equal(resources.catalogRequests.length, 2);
  const nearby = resources.catalogRequests.find((request) => new URL(request.url).pathname === "/catalog/nearby");
  assert.ok(nearby);
  assert.deepEqual(await nearby.json(), { lat: 35.5, lng: 139.5, radius_m: 5000 });
});
