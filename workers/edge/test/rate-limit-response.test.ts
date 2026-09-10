import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import { RATE_LIMIT_ENVELOPE_FIELDS, classifyRatePolicy } from "../src/gateway/rate-policy.ts";
import { rateLimitedResponse, rateLimitUnavailableResponse } from "../src/gateway/responses.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { stubCtx, alwaysAllowGuard } from "../src/container/entry-env.ts";

// AC3 (#680): limited requests return a typed 429 with Retry-After and
// the DOCUMENTED rate-limit fields; rate limit stays DISTINCT from daily
// quota (the 403 budget code). This file pins the wire contract at the
// public response seam and through the composed app.

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);

void test("rateLimitedResponse is a typed 429 with Retry-After and the documented envelope", async () => {
  const res = rateLimitedResponse(42);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "42");
  assert.equal(res.headers.get("Content-Type"), "application/json");
  const parsed = (await res.json()) as { error: { code: string; message: string; retry_after_seconds: number } };
  const err = parsed.error;
  assert.equal(err.code, "rate_limited");
  assert.ok(typeof err.message === "string" && err.message.length > 0);
  assert.equal(err.retry_after_seconds, 42);
  assert.deepEqual(Object.keys(err), [...RATE_LIMIT_ENVELOPE_FIELDS]);
});

void test("the fail-closed limiter outage response is a DISTINCT typed 503, not a 429", async () => {
  const res = rateLimitUnavailableResponse();
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), {
    error: { code: "rate_limit_unavailable", message: "Rate limiter temporarily unavailable. Please retry." },
  });
});

// Rate limit and daily quota are distinct in the ROUTE POLICY too (AC3 + AC1):
// the policy names quota as a SEPARATE cell from the limiter.
void test("the policy keeps rate limit and daily quota as SEPARATE cells", () => {
  const p = classifyRatePolicy("POST", "/v1/chat");
  assert.equal(p.limiter, "durable");
  assert.equal(p.quota, "none");
});

// Through the composed app: anonymous burst 429 (rate-limited) is distinct
// from the daily-budget 403 (quota).
const SECRET = "fixed-test-hmac-key-0000000000000000";
const ANON = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: SECRET, TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000", EDGE_SHOWCASE_MODE: "false" };
const passingGate = { check: () => Promise.resolve({ ok: true, errorCodes: [] }) };

function anonApp(response = () => new Response("agent")) {
  return createWorkerApp({ agentTurns: nativeAgentReceiver([], response), authenticate: () => Promise.resolve({ ok: false, reason: "absent" }), turnstileGate: passingGate });
}

void test("an anonymous burst 429 is typed rate_limited, distinct from the quota code", async () => {
  const captured = { requests: [] as Request[] };
  const env = {
    ...ANON,
    ANON_RATE_LIMIT: "1",
    EDGE_GUARD: fakeGuard(NOW).namespace,
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: (r: Request) => { captured.requests.push(r); return Promise.resolve(new Response("ok")); } }) },
  } as never;
  const app = anonApp();
  const cookie = String((await app.request("/v1/chat", { method: "POST" }, env, stubCtx)).headers.get("Set-Cookie")).split(";")[0] ?? "";
  const res = await app.request("/v1/chat", { method: "POST", headers: { Cookie: cookie } }, env, stubCtx);
  assert.equal(res.status, 429);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limited", "burst rejection must be rate_limited, not a quota code");
});

void test("the daily-budget breaker stays a DISTINCT 403 (quota), not a 429 (rate limit)", async () => {
  const captured = { requests: [] as Request[] };
  const env = {
    ...ANON,
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: (r: Request) => { captured.requests.push(r); return Promise.resolve(new Response(JSON.stringify({ error: { code: "anon_budget_exhausted" } }), { status: 403 })); } }) },
  } as never;
  const res = await anonApp(() => Response.json({ error: { code: "anon_budget_exhausted" } }, { status: 403 })).request("/v1/chat", { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "anon_budget_exhausted", "daily quota exhaustion is a 403, not a rate-limit 429");
});
// AC5 (#1011): the EDGE applies the accepted user/write cost class to a users
// mutation and the limited reply is the typed 429 with Retry-After and the
// documented rate-limit fields — DISTINCT from the daily quota 403. This is
// the composed-app assertion for the users write cell specifically.
function authedUsersApp() {
  return createWorkerApp({ authenticate: () => Promise.resolve({ ok: true, userId: "u-ac5", userType: "human" } as const) });
}

function usersEnv(guard: unknown): Record<string, unknown> {
  return {
    EDGE_SHOWCASE_MODE: "false",
    AUTH_RATE_LIMIT: "1",
    AUTH_RATE_LIMIT_WINDOW_SECONDS: "60",
    EDGE_GUARD: guard,
    USERS: { fetch: () => Promise.resolve(new Response("users")) },
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  };
}

void test("a limited users POST via the durable user/write class returns a typed 429 with Retry-After and the envelope", async () => {
  const app = authedUsersApp();
  const env = usersEnv(fakeGuard(NOW).namespace);
  const post = { method: "POST", headers: { Authorization: "Bearer jwt" } };
  const first = await app.request("/v1/users/saved-routes", post, env, stubCtx);
  assert.equal(first.status, 200, "the first users write spends the one-slot window");
  const limited = await app.request("/v1/users/saved-routes", post, env, stubCtx);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("Retry-After"), "the typed 429 must carry Retry-After");
  const body = (await limited.json()) as { error: { code: string; message: string; retry_after_seconds: number } };
  assert.equal(body.error.code, "rate_limited", "a limited write must be rate_limited, never a quota 403");
  assert.ok(typeof body.error.message === "string" && body.error.message.length > 0);
  assert.ok(body.error.retry_after_seconds >= 1);
  assert.deepEqual(Object.keys(body.error), [...RATE_LIMIT_ENVELOPE_FIELDS]);
});
