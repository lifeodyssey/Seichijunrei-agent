import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";
import { stubCtx } from "../src/container/entry-env.ts";

// AC2 (#680): users mutations, Chat, BYOK and other expensive operations are
// NO LONGER bypassed by routing order, encoding, a trailing slash, or another
// isolate. These are real composed-app regressions, not pure-function checks.

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);

function env(guard: unknown, extra: Record<string, unknown> = {}) {
  return {
    EDGE_SHOWCASE_MODE: "false",
    AUTH_RATE_LIMIT: "1",
    AUTH_RATE_LIMIT_WINDOW_SECONDS: "60",
    EDGE_GUARD: guard,
    CONTAINER: { idFromName: () => "id", get: () => ({ fetch: () => Promise.resolve(new Response("ok")) }) },
    USERS: { fetch: () => Promise.resolve(new Response("users")) },
    ...extra,
  } as never;
}

function authedApp() {
  return createWorkerApp({ agentTurns: nativeAgentReceiver(), authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const) });
}

const POST = { method: "POST", headers: { Authorization: "Bearer jwt" } };

void test("a trailing slash on /v1/chat cannot bypass the burst window", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  assert.equal((await app.request("/v1/chat", POST, e, stubCtx)).status, 200);
  const res = await app.request("/v1/chat/", POST, e, stubCtx);
  assert.equal(res.status, 429, "the trailing slash must share the identity's already-spent window");
});

void test("percent-encoding /v1/byok/ cannot bypass the burst window", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  assert.equal((await app.request("/v1/byok/probe", POST, e, stubCtx)).status, 200);
  const res = await app.request("/v1/%62yok/probe", POST, e, stubCtx);
  assert.equal(res.status, 429, "the encoded path must share the identity's window");
});

void test("routing order does not matter: chat then byok shares one identity's window", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  assert.equal((await app.request("/v1/chat", POST, e, stubCtx)).status, 200);
  const res = await app.request("/v1/byok/probe", POST, e, stubCtx);
  assert.equal(res.status, 429, "BYOK after chat must count against the same identity");
});

void test("a users MUTATION is not bypassed by a trailing slash", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  const post = { method: "POST", headers: { Authorization: "Bearer jwt" } };
  assert.equal((await app.request("/v1/users/saved-routes", post, e, stubCtx)).status, 200);
  const res = await app.request("/v1/users/saved-routes/", post, e, stubCtx);
  assert.equal(res.status, 429, "a users mutation with a trailing slash must not bypass the window");
});

void test("a users mutation is not bypassed by the GET read path's order", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  const get = { method: "GET", headers: { Authorization: "Bearer jwt" } };
  // Reads are unmanaged (never spend the window), so several GETs then a
  // single mutation must still consume exactly one slot — not zero (bypass)
  // and not more (overcount).
  await app.request("/v1/users/saved-routes", get, e, stubCtx);
  await app.request("/v1/users/saved-routes", get, e, stubCtx);
  const mutation = await app.request("/v1/users/saved-routes", POST, e, stubCtx);
  assert.equal(mutation.status, 200, "reads never spend the mutation window");
  const second = await app.request("/v1/users/saved-routes", POST, e, stubCtx);
  assert.equal(second.status, 429, "the second mutation after reads is still limited");
});

void test("another isolate cannot reset an identity's spent window", async () => {
  // Sharing one guard double models the single durable authority: a second
  // app instance (another isolate) sees the first's spent window, so it
  // cannot bypass by re-entering the limiter fresh.
  const guard = fakeGuard(NOW).namespace;
  const e = env(guard);
  const appA = authedApp();
  const appB = authedApp();
  assert.equal((await appA.request("/v1/chat", POST, e, stubCtx)).status, 200);
  const res = await appB.request("/v1/chat", POST, e, stubCtx);
  assert.equal(res.status, 429, "isolate B must see isolate A's spent window");
});

// AC2 (review REJECT #680): the AUTH cost path previously consulted only
// isAuthRateLimited (which matched /v1/chat + /v1/byok/*), leaving
// authenticated /v1/feedback, PATCH /v1/conversations/*, /v1/photo-search
// and /v1/photo-search/confirm unguarded. They now route through the SAME
// policy-driven guard as chat/BYOK: prove it by spending the one-request
// AUTH window on that class and seeing the second the caller shares reject.

void test("authenticated POST /v1/photo-search is guarded by the policy path", async () => {
  const app = authedApp();
  const guard = fakeGuard(NOW);
  const e = env(guard.namespace);
  assert.equal((await app.request("/v1/photo-search", POST, e, stubCtx)).status, 200);
  const second = await app.request("/v1/photo-search", POST, e, stubCtx);
  assert.equal(second.status, 429, "an authenticated photo-search must spend the identity's durable window");
  assert.ok(guard.calls.some((c) => c.method === "POST"), "the durable guard seam must be consulted");
});

void test("authenticated POST /v1/photo-search/confirm is guarded by the policy path", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  assert.equal((await app.request("/v1/photo-search/confirm", POST, e, stubCtx)).status, 200);
  const second = await app.request("/v1/photo-search/confirm", POST, e, stubCtx);
  assert.equal(second.status, 429, "an authenticated photo-search confirm must fail closed on the shared window");
});

void test("authenticated POST /v1/feedback is guarded by the policy path", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  assert.equal((await app.request("/v1/feedback", POST, e, stubCtx)).status, 200);
  const second = await app.request("/v1/feedback", POST, e, stubCtx);
  assert.equal(second.status, 429, "an authenticated feedback write must spend the identity's window");
});

void test("authenticated PATCH /v1/conversations/* is guarded by the policy path", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  const patch = { method: "PATCH", headers: { Authorization: "Bearer jwt" } };
  assert.equal((await app.request("/v1/conversations/conv-123", patch, e, stubCtx)).status, 200);
  const second = await app.request("/v1/conversations/conv-123", patch, e, stubCtx);
  assert.equal(second.status, 429, "a PATCH conversation (rename) must be a guarded durable mutation");
});

void test("an authenticated GET conversation read stays unmanaged (never spends the window)", async () => {
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  const get = { method: "GET", headers: { Authorization: "Bearer jwt" } };
  await app.request("/v1/conversations/conv-123", get, e, stubCtx);
  await app.request("/v1/conversations/conv-123/messages", get, e, stubCtx);
  const res = await app.request("/v1/conversations/conv-123", get, e, stubCtx);
  assert.equal(res.status, 200, "reads are unmanaged and must never consume a window slot");
});

void test("an authenticated PATCH shares the identity window with chat (one limiter cell)", async () => {
  // Defeats any two-source-of-truth drift: chat and a PATCH conversation are
  // both durable fail-closed mutations, so they spend the SAME identity bucker.
  const app = authedApp();
  const e = env(fakeGuard(NOW).namespace);
  const patch = { method: "PATCH", headers: { Authorization: "Bearer jwt" } };
  assert.equal((await app.request("/v1/chat", POST, e, stubCtx)).status, 200);
  const res = await app.request("/v1/conversations/conv-1", patch, e, stubCtx);
  assert.equal(res.status, 429, "chat and a PATCH conversation must share one identity's window");
});
