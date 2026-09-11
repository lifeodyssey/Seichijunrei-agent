import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { TURNSTILE_HEADER, createTurnstileGate } from "../src/protect/turnstile.ts";
import { stubCtx } from "../src/container/entry-env.ts";

/**
 * Issue #447 review, P1-1: the armed path exercised with the REAL gate (only
 * the siteverify network call is stubbed), against Cloudflare's actual
 * single-use token semantics — a replayed token answers `timeout-or-duplicate`.
 *
 * This is the attack the card exists to close: drop the `aid` cookie, get a
 * fresh identity and a fresh rate-limit bucket, and replay one solved token.
 */

const ANON_ENV = {
  ANON_ACCESS_ENABLED: "true",
  ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
  TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
  EDGE_SHOWCASE_MODE: "false",
};
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const SOLVED = "solved-token";

/** Cloudflare's real contract: a token verifies once, then is a duplicate. */
function singleUseSiteverify(calls: string[]): typeof fetch {
  const spent = new Set<string>();
  return (_input, init) => {
    const token = siteverifyToken(init);
    calls.push(token);
    const fresh = !spent.has(token);
    spent.add(token);
    return Promise.resolve(Response.json(tokenVerdict(fresh)));
  };
}

function siteverifyToken(init?: RequestInit): string {
  const rawBody = init?.body;
  const bodyText = rawBody instanceof URLSearchParams ? rawBody.toString() : typeof rawBody === "string" ? rawBody : "";
  return new URLSearchParams(bodyText).get("response") ?? "";
}

function tokenVerdict(fresh: boolean) {
  return fresh ? { success: true } : { success: false, "error-codes": ["timeout-or-duplicate"] };
}

function anonEnv() {
  return { ...ANON_ENV, EDGE_GUARD: fakeGuard(NOW).namespace } as never;
}

/** The real gate, wired exactly as `createWorkerApp` builds its default. */
function realGateApp(calls: string[], captured: NativeAgentCall[]) {
  return createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    agentTurns: nativeAgentReceiver(captured),
    turnstileGate: createTurnstileGate({ fetchImpl: singleUseSiteverify(calls) }),
  });
}

function chat(headers: Record<string, string> = {}) {
  return { method: "POST", headers };
}

const solved = { [TURNSTILE_HEADER]: SOLVED, "CF-Connecting-IP": "203.0.113.7" };

void test("a genuinely solved token verifies once and the turn is forwarded", async () => {
  const calls: string[] = [];
  const captured: NativeAgentCall[] = [];
  const res = await realGateApp(calls, captured).request("/v1/chat", chat(solved), anonEnv(), stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [SOLVED]);
  assert.equal(captured.length, 1);
});

void test("the same visitor's follow-up turn rides the window without re-verifying", async () => {
  const calls: string[] = [];
  const captured: NativeAgentCall[] = [];
  const env = anonEnv();
  const app = realGateApp(calls, captured);
  const first = await app.request("/v1/chat", chat(solved), env, stubCtx);
  const cookie = String(first.headers.get("Set-Cookie")).split(";")[0] ?? "";
  const second = await app.request("/v1/chat", chat({ ...solved, Cookie: cookie }), env, stubCtx);
  assert.equal(second.status, 200);
  assert.deepEqual(calls, [SOLVED]);
  assert.equal(captured.length, 2);
});

void test("replaying the token from a dropped cookie is rejected, not waved through", async () => {
  const calls: string[] = [];
  const captured: NativeAgentCall[] = [];
  const env = anonEnv();
  const app = realGateApp(calls, captured);
  await app.request("/v1/chat", chat(solved), env, stubCtx);
  const replay = await app.request("/v1/chat", chat(solved), env, stubCtx);
  assert.equal(replay.status, 403);
  assert.deepEqual(calls, [SOLVED, SOLVED], "the replay must reach siteverify, not the local window");
  assert.equal(captured.length, 1);
});

void test("the cookie-drop replay stays rejected however often it is retried", async () => {
  const calls: string[] = [];
  const captured: NativeAgentCall[] = [];
  const env = anonEnv();
  const app = realGateApp(calls, captured);
  await app.request("/v1/chat", chat(solved), env, stubCtx);
  await app.request("/v1/chat", chat(solved), env, stubCtx);
  const third = await app.request("/v1/chat", chat(solved), env, stubCtx);
  assert.equal(third.status, 403);
  assert.equal(captured.length, 1);
});
