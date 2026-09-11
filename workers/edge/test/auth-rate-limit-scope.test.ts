import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import type { Env } from "../src/env.ts";
import { classifyRatePolicy } from "../src/gateway/rate-policy.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

// P2-5 (issue #284 / Task 9, round 3): the authenticated cost-path allowlist
// was an exact-match `Array.includes`, so a trailing slash on the path
// bypassed the limiter outright — "/v1/byok/probe/" counted for nothing.
// Fable's follow-up finding: /v1/runtime + /v1/runtime/stream ran a full
// agent turn on the house model key (same cost shape as /v1/chat) and reach
// this same authenticated branch — both routes are RETIRED now (TURN-4 #955);
// route-inventory.test.ts pins that they match no table.
//
// The rate-limit DECISION now lives in ONE table, `classifyRatePolicy`, and
// routing delegates every branch to it (review REJECT #680). These unit
// assertions pin that table at the classification seam; the app-level tests
// below prove it holds through the real routing pipeline.

function isLimited(method: string, path: string): boolean {
  return classifyRatePolicy(method, path).limiter !== "none";
}

void test("the exact cost-bearing routes are limited", () => {
  assert.equal(isLimited("POST", "/v1/chat"), true);
});

void test("a trailing slash on an exact route still counts (P2-5)", () => {
  assert.equal(isLimited("POST", "/v1/chat/"), true);
});

void test("every route under /v1/byok/ counts, by prefix, not by an exact list", () => {
  assert.equal(isLimited("POST", "/v1/byok/probe"), true);
  assert.equal(isLimited("POST", "/v1/byok/probe/"), true, "a trailing slash must not bypass the BYOK prefix");
  assert.equal(isLimited("POST", "/v1/byok/anything-future"), true, "new BYOK routes are covered without an edit here");
});

void test("authenticated reads are NOT limited; writes are", () => {
  assert.equal(isLimited("GET", "/v1/conversations"), false);
  assert.equal(isLimited("GET", "/v1/conversations/abc/messages"), false);
  assert.equal(isLimited("GET", "/v1/conversations/abc/routes"), false);
  assert.equal(isLimited("GET", "/v1/users/profile"), false);
  assert.equal(isLimited("PATCH", "/v1/conversations/abc"), true, "a PATCH write is a guarded mutation class");
});

void test("a sibling path is not mistaken for a byok route by a naive substring check", () => {
  assert.equal(isLimited("POST", "/v1/byoke/probe"), false);
  assert.equal(isLimited("POST", "/v1/byok"), false, "the prefix requires the trailing slash boundary");
});

// #479 P1-1 review follow-up (closes the #464 follow-up too): `URL.pathname`
// does NOT decode `%XX` escapes, but the container's ASGI router does before
// matching its own routes. `/v1/%62yok/probe` ("b" percent-encoded) used to
// read here as "not /v1/byok/" — zero limiter calls — while still landing on
// `handle_byok_probe` in the container: an authenticated caller could burst
// an unbounded number of real outbound probe calls by percent-encoding one
// letter per request. classifyRatePolicy percent-decodes, so the split-brain
// is closed inside the single decision table.

void test("a percent-encoded BYOK path is still counted (policy unit)", () => {
  assert.equal(isLimited("POST", "/v1/%62yok/probe"), true);
  assert.equal(isLimited("POST", "/v1/byok/%70robe"), true);
});

void test("a percent-encoded chat path is still counted (policy unit)", () => {
  assert.equal(isLimited("POST", "/v1/%63hat"), true);
});

void test("a malformed percent-encoding fails CLOSED (counted), not open", () => {
  // #479 round-3 review follow-up (Opus): the original fixtures here
  // ("/v1/byok/probe%", "/v1/byok/probe%zz") were vacuous — the malformed
  // escape sat AFTER an already-literal, undecoded "/v1/byok/" prefix, so
  // even a mutation that returned the RAW pathname on decode failure
  // (instead of failing closed) would still match the prefix check and
  // read as limited, for the wrong reason. These fixtures instead put the
  // malformed escape INSIDE the prefix/route token itself, so only the
  // real fail-closed branch (a durable cell for an undecodable /v1 path)
  // can make the assertion pass.
  assert.equal(isLimited("POST", "/v1/%zzyok/probe"), true);
  assert.equal(isLimited("POST", "/v1/%zzhat"), true);
});

// ── Real `app.request` regression: the fix must hold through the actual
// routing pipeline, not just the pure `classifyRatePolicy` function in
// isolation — a pure-function-only suite would pass even if some OTHER
// path (e.g. `authenticatedForward`) stopped consulting the policy.

const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);
const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function env(guard: ReturnType<typeof fakeGuard>["namespace"]): Env {
  return {
    EDGE_GUARD: guard,
    EDGE_SHOWCASE_MODE: "false",
    AUTH_RATE_LIMIT: "1",
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
  } as unknown as Env;
}

function authedApp() {
  return createWorkerApp({ agentTurns: nativeAgentReceiver(),
        authenticate: () => Promise.resolve({ ok: true, userId: "user-a", userType: "human" } as const),
  });
}

const POST = { method: "POST", headers: { Authorization: "Bearer jwt" } };

void test("a real request to a percent-encoded /v1/byok/ path is rate-limited end-to-end", async () => {
  const guard = fakeGuard(NOW).namespace;
  const app = authedApp();
  const e = env(guard);
  const first = await app.request("/v1/byok/probe", POST, e, stubCtx);
  assert.equal(first.status, 200, "the plain path spends the one-request window");
  const encoded = await app.request("/v1/%62yok/probe", POST, e, stubCtx);
  assert.equal(
    encoded.status,
    429,
    "the percent-encoded path must share the same identity's already-spent window, not get a free pass",
  );
});

void test("a real request to a percent-encoded /v1/chat path is rate-limited end-to-end", async () => {
  const guard = fakeGuard(NOW).namespace;
  const app = authedApp();
  const e = env(guard);
  const first = await app.request("/v1/chat", POST, e, stubCtx);
  assert.equal(first.status, 200);
  const encoded = await app.request("/v1/%63hat", POST, e, stubCtx);
  assert.equal(encoded.status, 429);
});
