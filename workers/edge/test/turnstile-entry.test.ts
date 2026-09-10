import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { stubCtx } from "../src/container/entry-env.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { TURNSTILE_HEADER, createTurnstileGate, type TurnstileGate } from "../src/protect/turnstile.ts";
import { recordingGate, stubFetch, type Call, type GateCall } from "./doubles/turnstile-doubles.ts";

const SECRET = "fixed-test-hmac-key-0000000000000000";
const TURNSTILE_SECRET = "fixed-test-turnstile-secret-0000000";
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);
const SOLVED = "solved-token";
const solvedHeaders = { [TURNSTILE_HEADER]: SOLVED, "CF-Connecting-IP": "203.0.113.7" };

function containerFetch(captured: { requests: Request[] }, request: Request): Promise<Response> {
  captured.requests.push(request);
  return Promise.resolve(new Response("container"));
}

function containerStub(captured: { requests: Request[] }) {
  return {
    idFromName: () => "id",
    get: () => ({ fetch: (request: Request) => containerFetch(captured, request) }),
  };
}

function anonEnv(captured: { requests: Request[] }) {
  return {
    ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: SECRET,
    TURNSTILE_SECRET, EDGE_SHOWCASE_MODE: "false",
    EDGE_GUARD: fakeGuard(NOW).namespace, CONTAINER: containerStub(captured),
  } as never;
}

function app(captured: { calls: NativeAgentCall[] }, gate: TurnstileGate, authenticated = false) {
  const authenticate = authenticated
    ? () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const)
    : () => Promise.resolve({ ok: false, reason: "absent" } as const);
  return createWorkerApp({ authenticate, turnstileGate: gate, agentTurns: nativeAgentReceiver(captured.calls) });
}

function post(headers: Record<string, string> = {}) {
  return { method: "POST", headers };
}

void test("an authenticated caller bypasses entry verification", async () => {
  const captured = { requests: [] as Request[], calls: [] as NativeAgentCall[] };
  const calls: GateCall[] = [];
  const response = await app(captured, recordingGate(calls, null), true).request(
    "/v1/turnstile/verify", post({ Authorization: "Bearer jwt" }), anonEnv(captured), stubCtx,
  );
  assert.equal(response.status, 204);
  assert.equal(calls.length, 0);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

void test("a solved entry mints the aid used by the first chat turn", async () => {
  const captured = { requests: [] as Request[], calls: [] as NativeAgentCall[] };
  const calls: GateCall[] = [];
  const worker = app(captured, recordingGate(calls, SOLVED));
  const env = anonEnv(captured);
  const verified = await worker.request("/v1/turnstile/verify", post(solvedHeaders), env, stubCtx);
  const cookie = String(verified.headers.get("Set-Cookie")).split(";")[0] ?? "";
  assert.equal(verified.status, 204);
  assert.match(cookie, /^aid=/);
  const turn = await worker.request("/v1/chat", post({ ...solvedHeaders, Cookie: cookie }), env, stubCtx);
  assert.equal(turn.status, 200);
  assert.equal(calls.length, 2);
});

void test("the first chat reuses the entry pass without another siteverify", async () => {
  const captured = { requests: [] as Request[], calls: [] as NativeAgentCall[] };
  const calls: Call[] = [];
  const worker = app(captured, createTurnstileGate({ fetchImpl: stubFetch(calls, true), now: () => NOW }));
  const env = anonEnv(captured);
  const verified = await worker.request("/v1/turnstile/verify", post(solvedHeaders), env, stubCtx);
  const cookie = String(verified.headers.get("Set-Cookie")).split(";")[0] ?? "";
  const turn = await worker.request("/v1/chat", post({ ...solvedHeaders, Cookie: cookie }), env, stubCtx);
  assert.equal(turn.status, 200);
  assert.equal(calls.length, 1);
});

void test("the entry pass survives a different isolate and gate", async () => {
  const captured = { requests: [] as Request[], calls: [] as NativeAgentCall[] };
  const firstCalls: Call[] = [];
  const secondCalls: GateCall[] = [];
  const env = anonEnv(captured);
  const first = app(captured, createTurnstileGate({ fetchImpl: stubFetch(firstCalls, true) }));
  const verified = await first.request("/v1/turnstile/verify", post(solvedHeaders), env, stubCtx);
  const cookies = verified.headers.get("Set-Cookie") ?? "";
  const browserCookie = [/aid=[^;,]+/.exec(cookies)?.[0], /turnstile_pass=[^;,]+/.exec(cookies)?.[0]]
    .filter((value): value is string => value !== undefined).join("; ");
  const turn = await app(captured, recordingGate(secondCalls, null)).request(
    "/v1/chat", post({ Cookie: browserCookie }), env, stubCtx,
  );
  assert.equal(turn.status, 200);
  assert.equal(firstCalls.length, 1);
  assert.equal(secondCalls.length, 0);
  assert.equal(cookies.includes(SOLVED), false);
});

void test("a rejected entry fails closed without minting a cookie", async () => {
  const captured = { requests: [] as Request[], calls: [] as NativeAgentCall[] };
  const response = await app(captured, recordingGate([], null)).request(
    "/v1/turnstile/verify", post(solvedHeaders), anonEnv(captured), stubCtx,
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

void test("entry fails closed when its Turnstile secret is missing", async () => {
  const captured = { requests: [] as Request[], calls: [] as NativeAgentCall[] };
  const calls: GateCall[] = [];
  const env = { ...(anonEnv(captured) as object), TURNSTILE_SECRET: undefined } as never;
  const response = await app(captured, recordingGate(calls, SOLVED)).request(
    "/v1/turnstile/verify", post(solvedHeaders), env, stubCtx,
  );
  assert.equal(response.status, 403);
  assert.equal(calls.length, 0);
});

void test("the entry verification endpoint rejects non-POST methods", async () => {
  const captured = { requests: [] as Request[], calls: [] as NativeAgentCall[] };
  const response = await app(captured, recordingGate([], SOLVED)).request(
    "/v1/turnstile/verify", { method: "GET" }, anonEnv(captured), stubCtx,
  );
  assert.equal(response.status, 405);
});
