import assert from "node:assert/strict";
import test from "node:test";
import { createWorkerApp } from "../src/app.ts";
import { turnRoutePolicy } from "../src/gateway/routing-policy.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { latchBudget, utcDayKey } from "../src/protect/cost-breaker.ts";

const sessionId = "11111111-1111-4111-8111-111111111111";
const path = `/v1/conversations/${sessionId}/stream`;
const env = { EDGE_SHOWCASE_MODE: "false" } as never;
const execution = { waitUntil(promise: Promise<unknown>) { void promise; }, passThroughOnException() { return undefined; } } as ExecutionContext;

void test("the native reconnect endpoint is a GET that names an existing session", () => {
  assert.deepEqual(turnRoutePolicy().select("GET", path), { kind: "stream", sessionId });
  assert.equal(turnRoutePolicy().select("POST", path), null);
  assert.equal(turnRoutePolicy().select("GET", "/v1/conversations/%ZZ/stream"), null);
});

void test("stream reconnection passes verified identity and query without submitting model input", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: true, userId: "owner", userType: "human" }),
    agentTurns: { ...nativeAgentReceiver(), stream: (_env, request, identity, id) => {
      calls.push({ request, identity, sessionId: id });
      return Promise.resolve(new Response(null, { status: 204 }));
    } },
  });
  const response = await app.request(`${path}?operation_id=existing`, {}, env, execution);
  assert.equal(response.status, 204);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.deepEqual(call.identity, { userId: "owner", userType: "human" });
  assert.equal(call.sessionId, sessionId);
  assert.equal(call.request.method, "GET");
  assert.equal(new URL(call.request.url).search, "?operation_id=existing");
  assert.equal(await call.request.text(), "");
});

void test("an invalid bearer cannot reach the native stream through anonymous fallback", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "invalid" }),
    agentTurns: nativeAgentReceiver(calls),
  });
  const response = await app.request(path, {}, env, execution);
  assert.equal(response.status, 401);
  assert.deepEqual(calls, []);
});

void test("exhausted platform budget permits anonymous stream reads while refusing new turns", async (context) => {
  const now = Date.UTC(2026, 8, 10);
  context.mock.timers.enable({ apis: ["Date"], now });
  const guard = fakeGuard(now);
  await latchBudget(guard.namespace, utcDayKey(now));
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }),
    turnstileGate: { check: () => Promise.resolve({ ok: true, errorCodes: [] }) },
    agentTurns: nativeAgentReceiver(calls, () => new Response(null, { status: 204 })),
  });
  const visitorEnv = { EDGE_SHOWCASE_MODE: "false", ANON_ACCESS_ENABLED: "true", EDGE_GUARD: guard.namespace,
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000", TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000" } as never;
  const resumed = await app.request(path, {}, visitorEnv, execution);
  assert.equal(resumed.status, 204);
  assert.match(calls[0]?.identity.userId ?? "", /^anon_[0-9a-f]{32}$/);
  assert.equal(calls.length, 1);
  const newTurn = await app.request("/v1/chat", { method: "POST" }, visitorEnv, execution);
  assert.equal(newTurn.status, 403);
  assert.equal(calls.length, 1);
});
