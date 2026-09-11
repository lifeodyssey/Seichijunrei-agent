import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { ANON_BUDGET_EXHAUSTED_CODE } from "../src/protect/cost-breaker.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { stubCtx } from "../src/container/entry-env.ts";

const SECRET = "fixed-test-hmac-key-0000000000000000";
const ANON_ENV = {
  ANON_ACCESS_ENABLED: "true",
  ANON_ID_SECRET: SECRET,
  TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
  EDGE_SHOWCASE_MODE: "false",
};
const NOW = Date.UTC(2026, 6, 26, 12, 0, 0);

function anonEnv(guard = fakeGuard(NOW).namespace) {
  return { ...ANON_ENV, EDGE_GUARD: guard } as never;
}

/** These tests are about the anonymous branch itself, so the Turnstile gate
 * (armed in #447) is stubbed to a pass. `turnstile-arm.test.ts` owns the
 * challenge behaviour. */
const passingGate = { check: () => Promise.resolve({ ok: true, errorCodes: [] }) };

function anonApp(calls: NativeAgentCall[], response = () => new Response("agent")) {
  return createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" }),
    turnstileGate: passingGate,
    agentTurns: nativeAgentReceiver(calls, response),
  });
}

function chat(headers: Record<string, string> = {}) {
  return { method: "POST", headers };
}

// ── the /v1 gate ───────────────────────────────────────────────────────────

void test("an anonymous /v1/chat reaches the native tier with verified anonymous identity", async () => {
  const captured: NativeAgentCall[] = [];
  const res = await anonApp(captured).request(
    "/v1/chat", chat(), anonEnv(), stubCtx,
  );
  assert.equal(await res.text(), "agent");
  assert.equal(captured[0]?.identity.userType, "anonymous");
  assert.match(captured[0].identity.userId, /^anon_[0-9a-f]{32}$/);
});

void test("the anonymous branch sets the identity cookie on the response", async () => {
  const captured: NativeAgentCall[] = [];
  const res = await anonApp(captured).request(
    "/v1/chat", chat(), anonEnv(), stubCtx,
  );
  assert.match(String(res.headers.get("Set-Cookie")), /^aid=/);
});

void test("a client-forged X-User-Id cannot survive the anonymous branch", async () => {
  const captured: NativeAgentCall[] = [];
  await anonApp(captured).request(
    "/v1/chat", chat({ "X-User-Id": "forged", "X-User-Type": "human" }),
    anonEnv(), stubCtx,
  );
  assert.notEqual(captured[0]?.identity.userId, "forged");
  assert.equal(captured[0]?.identity.userType, "anonymous");
});

void test("non-allowlisted /v1 paths still 401 for anonymous callers", async () => {
  const captured: NativeAgentCall[] = [];
  const res = await anonApp(captured).request(
    "/v1/feedback", chat(), anonEnv(), stubCtx,
  );
  assert.equal(res.status, 401);
  assert.equal(captured.length, 0);
});

void test("with anonymous access disabled /v1/chat keeps its 401", async () => {
  const captured: NativeAgentCall[] = [];
  const env = { ...(anonEnv() as object), ANON_ACCESS_ENABLED: "false" };
  const res = await anonApp(captured).request("/v1/chat", chat(), env, stubCtx);
  assert.equal(res.status, 401);
  assert.equal(captured.length, 0);
});

void test("exceeding the burst limit returns a friendly 429, not a bare status", async () => {
  const captured: NativeAgentCall[] = [];
  const env = { ...(anonEnv() as object), ANON_RATE_LIMIT: "1" };
  const cookie = String(
    (await anonApp(captured).request("/v1/chat", chat(), env, stubCtx)).headers.get("Set-Cookie"),
  ).split(";")[0] ?? "";
  const res = await anonApp(captured).request("/v1/chat", chat({ Cookie: cookie }), env, stubCtx);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  const body = (await res.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "rate_limited");
  assert.match(body.error.message, /少し待ってね/);
});

void test("a separate anonymous identity is not affected by another's burst limit", async () => {
  const captured: NativeAgentCall[] = [];
  const env = { ...(anonEnv() as object), ANON_RATE_LIMIT: "1" };
  const cookie = String(
    (await anonApp(captured).request("/v1/chat", chat(), env, stubCtx)).headers.get("Set-Cookie"),
  ).split(";")[0] ?? "";
  await anonApp(captured).request("/v1/chat", chat({ Cookie: cookie }), env, stubCtx);
  const other = await anonApp(captured).request("/v1/chat", chat(), env, stubCtx);
  assert.equal(other.status, 200);
});

// ── the daily-budget circuit breaker (X4) ──────────────────────────────────

const breakerTripped = () =>
  new Response(JSON.stringify({ error: { code: ANON_BUDGET_EXHAUSTED_CODE } }), { status: 403 });

void test("the native tier's breaker verdict becomes login guidance at the edge", async () => {
  const captured: NativeAgentCall[] = [];
  const res = await anonApp(captured, breakerTripped).request("/v1/chat", chat(), anonEnv(), stubCtx);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string; action: string } };
  assert.equal(body.error.code, ANON_BUDGET_EXHAUSTED_CODE);
  assert.equal(body.error.action, "login");
});

void test("once tripped the edge short-circuits without reaching the native tier again", async () => {
  const captured: NativeAgentCall[] = [];
  const env = anonEnv(fakeGuard(NOW).namespace);
  await anonApp(captured, breakerTripped).request("/v1/chat", chat(), env, stubCtx);
  const res = await anonApp(captured, breakerTripped).request("/v1/chat", chat(), env, stubCtx);
  assert.equal(res.status, 403);
  assert.equal(captured.length, 1);
});

void test("the breaker does not touch logged-in callers", async () => {
  const captured: NativeAgentCall[] = [];
  const env = anonEnv(fakeGuard(NOW).namespace);
  await anonApp(captured, breakerTripped).request("/v1/chat", chat(), env, stubCtx);
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
    agentTurns: nativeAgentReceiver(captured, breakerTripped),
  });
  const res = await app.request("/v1/chat", chat({ Authorization: "Bearer jwt" }), env, stubCtx);
  assert.equal(res.status, 403);
  assert.equal(captured[1]?.identity.userType, "human");
});

// ── streaming is not buffered by the budget guard ───────────────────────────
// `/v1/chat` answers with an SSE StreamingResponse. Reading a clone of it waits
// for the container to finish the entire turn, so the budget guard must decide
// on the status alone before it ever touches the body. This test pins that: the
// container's stream stays open, and the worker must still hand back a response.
// Passing `await response.clone().text()` as an argument (evaluated eagerly on
// every response, 200s included) hangs here forever.
void test("a still-open native stream is returned without being drained", async () => {
  const captured: NativeAgentCall[] = [];
  let release: (() => void) | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: first\n\n"));
      release = () => { controller.close(); };
    },
  });
  const container = () =>
    new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });

  const response = await Promise.race([
    anonApp(captured, container).fetch(
      new Request("https://animichi.test/v1/chat", chat()),
      anonEnv(),
      stubCtx,
    ),
    new Promise<"drained">((resolve) => { setTimeout(() => { resolve("drained"); }, 1_000); }),
  ]);

  assert.notEqual(response, "drained", "the guard drained the stream instead of checking status");
  assert.equal((response as Response).status, 200);
  release?.();
});
