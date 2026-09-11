import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import type { Env } from "../src/env.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { stubCtx } from "../src/container/entry-env.ts";

// Task 9 (#284): per-identity rate limiting on the authenticated /v1/* path,
// scoped to cost-bearing routes only (chat, byok/probe) — not
// every authenticated route. Previously no limiter ran here at all; BYOK
// makes that unbounded. Reads are deliberately NOT counted — see below.

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

/** Fetch rejects outright (dropped connection / overloaded DO), not a
 * well-formed error response — must fail closed (AC4), see OUTAGES below. */
function rejectingGuard() {
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.reject(new Error("connection lost")) }),
  };
}

/** A 200 with a non-JSON body — `response.json()` throws here too. */
function nonJsonOkGuard() {
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.resolve(new Response("not json", { status: 200 })) }),
  };
}

function brokenGuard() {
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get: () => ({ fetch: () => Promise.resolve(new Response("down", { status: 500 })) }),
  };
}

/** A typed test-env factory: every call site gets `Env`'s shape instead of
 * repeating an untyped `as never` escape hatch. `extra` still widens freely
 * (env vars, feature flags) since those are genuinely optional on `Env`. */
function env(guard = fakeGuard(NOW).namespace, extra: Record<string, unknown> = {}): Env {
  return {
    EDGE_GUARD: guard,
    EDGE_SHOWCASE_MODE: "false",
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
    ...extra,
  } as unknown as Env;
}

function authedApp(userId = "user-a") {
  return createWorkerApp({ agentTurns: nativeAgentReceiver(),
    authenticate: () => Promise.resolve({ ok: true, userId, userType: "human" } as const),
  });
}

function req(path: string, headers: Record<string, string> = {}) {
  return { method: "POST", headers: { Authorization: "Bearer jwt", ...headers } };
}

// ── AC1: happy path counted per-identity + burst → 429 ─────────────────────

void test("a happy-path authenticated /v1/chat request is allowed and counted; a burst beyond the limit returns 429 with Retry-After", async () => {
  const e = env(fakeGuard(NOW).namespace, { AUTH_RATE_LIMIT: "1" });
  const app = authedApp();
  const first = await app.request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(first.status, 200, "the happy path (within the limit) must still be allowed");
  const res = await app.request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  const body = (await res.json()) as { error: { code: string } };
  assert.equal(body.error.code, "rate_limited");
});

// ── AC2: /v1/byok/probe covered by the same limiter ────────────────────────

void test("/v1/chat and /v1/byok/probe share one identity's window (probe is limited by prior chat use)", async () => {
  const e = env(fakeGuard(NOW).namespace, { AUTH_RATE_LIMIT: "1" });
  const app = authedApp();
  await app.request("/v1/chat", req("/v1/chat"), e, stubCtx);
  const res = await app.request("/v1/byok/probe", req("/v1/byok/probe"), e, stubCtx);
  assert.equal(res.status, 429, "probe must be limited by the same identity's already-spent window");
});

// ── AC3: identity isolation ─────────────────────────────────────────────────

void test("user A's burst never consumes user B's allowance", async () => {
  const guard = fakeGuard(NOW).namespace;
  const e = env(guard, { AUTH_RATE_LIMIT: "1" });
  await authedApp("user-a").request("/v1/chat", req("/v1/chat"), e, stubCtx);
  const res = await authedApp("user-b").request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(res.status, 200);
});

void test("an anonymous caller's allowance is unaffected by authenticated traffic", async () => {
  const guard = fakeGuard(NOW).namespace;
  const e = env(guard, {
    AUTH_RATE_LIMIT: "1", ANON_RATE_LIMIT: "1", ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
  });
  await authedApp("user-a").request("/v1/chat", req("/v1/chat"), e, stubCtx);
  // The scope under test is the rate limiter, not the #447 Turnstile gate.
  const anonApp = createWorkerApp({ agentTurns: nativeAgentReceiver(),
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    turnstileGate: { check: () => Promise.resolve({ ok: true, errorCodes: [] }) },
  });
  const res = await anonApp.request("/v1/chat", { method: "POST", headers: {} }, e, stubCtx);
  assert.equal(res.status, 200);
});

// ── scope: authenticated READS never consume the cost-path allowance ───────

void test("an authenticated read (GET /v1/conversations et al) never consumes the /v1/chat allowance", async () => {
  const e = env(fakeGuard(NOW).namespace, { AUTH_RATE_LIMIT: "1" });
  const app = authedApp();
  const get = { method: "GET", headers: { Authorization: "Bearer jwt" } };
  for (const path of ["/v1/conversations", "/v1/conversations/abc/messages", "/v1/conversations/abc/routes"]) {
    await app.request(path, get, e, stubCtx);
  }
  const res = await app.request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(res.status, 200, "reads must not have spent the one-request /v1/chat window");
});

// ── AC4 (#680): high-cost classes FAIL CLOSED on EVERY guard-outage shape.
// This deliberately supersedes T9-AC4's fail-open contract for /v1/chat: a
// cost-bearing LLM turn that cannot be metered must NOT run unmetered. The
// fail-open-with-alert path now belongs to cacheable public reads only. ─────

const OUTAGES: [string, () => ReturnType<typeof brokenGuard>][] = [
  ["a server error", brokenGuard],
  ["a rejected fetch promise (dropped connection / DO overload)", rejectingGuard],
  ["a non-JSON 200 body", nonJsonOkGuard],
];

for (const [label, guard] of OUTAGES) {
  void test(`the limiter fails CLOSED when the shard answers with ${label}`, async () => {
    const res = await authedApp().request("/v1/chat", req("/v1/chat"), env(guard()), stubCtx);
    assert.equal(res.status, 503, "a high-cost turn must not execute on a limiter outage (AC4)");
    const body = (await res.json()) as { error: { code: string } };
    assert.equal(body.error.code, "rate_limit_unavailable");
  });
}

// ── AC5: the key is the identity only, never caller-supplied input ─────────

void test("varying X-BYOK-* headers or base_url never changes whose allowance is spent", async () => {
  const e = env(fakeGuard(NOW).namespace, { AUTH_RATE_LIMIT: "1" });
  const app = authedApp("user-a");
  await app.request(
    "/v1/chat",
    req("/v1/chat", { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "sk-forged", "X-BYOK-Base-Url": "https://evil.example" }),
    e, stubCtx,
  );
  const res = await app.request(
    "/v1/chat",
    req("/v1/chat", { "X-BYOK-Provider": "anthropic", "X-BYOK-Key": "different-key" }),
    e, stubCtx,
  );
  assert.equal(res.status, 429, "same identity must still be limited regardless of BYOK headers");
});

void test("an unauthenticated caller cannot spend an authenticated identity's allowance by forging X-BYOK-* headers", async () => {
  const guard = fakeGuard(NOW).namespace;
  const e = env(guard, { AUTH_RATE_LIMIT: "1", ANON_ACCESS_ENABLED: "false" });
  const anonApp = createWorkerApp({ agentTurns: nativeAgentReceiver(), authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const) });
  const forged = await anonApp.request(
    "/v1/chat",
    { method: "POST", headers: { "X-BYOK-Provider": "openai-compatible", "X-BYOK-Key": "sk-forged" } },
    e, stubCtx,
  );
  assert.equal(forged.status, 401);
  // Prove the forged attempt did not touch user-a's allowance: with the
  // window sized to exactly one request, a real authenticated request from
  // user-a right after must still succeed.
  const authed = await authedApp("user-a").request("/v1/chat", req("/v1/chat"), e, stubCtx);
  assert.equal(authed.status, 200, "the forged anonymous request must not have consumed any authenticated identity's quota");
});
