import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver } from "./doubles/native-agent-receiver.ts";
import { createShowcaseMode, type ShowcaseMode } from "../src/proxy/showcase.ts";
import type { GuardNamespace } from "../src/protect/guard-store.ts";

// S0-v2 GOAL C / C9: the showcase gate is the backend half of "prod is a
// landing-only showcase". Armed, every functional route under /v1 and the
// public catalog read answer 403 before any binding (EDGE_GUARD included) is
// touched; the landing's own surface (/healthz, /img/*, /tiles/*) stays up.
// Only the literal "false" opens the backend; unset/empty/malformed fail
// closed, warn-once per gate. All ACs are `unit` (stubs, no network/clock).

const stubCtx = { waitUntil(p: Promise<unknown>) { void p; }, passThroughOnException() { return undefined; } } as unknown as ExecutionContext;

/** An EDGE_GUARD stand-in that always allows and records EVERY namespace
 * access in `touched` — a denied request must leave it at ZERO (thread B,
 * mutation-verified). */
function trackingGuard(touched: { count: number }): GuardNamespace {
  const record = () => { touched.count += 1; };
  const shard = {
    fetch: () => { record(); return Promise.resolve(new Response('{"allowed":true,"retryAfterSeconds":0}')); },
  };
  return {
    idFromName: (name) => { record(); return name as unknown as DurableObjectId; },
    get: () => { record(); return shard; },
  };
}

/** A binding stub whose fetch records one access and answers `body`. */
function fetchStub(touched: { count: number }, body: string) {
  return { fetch: () => { touched.count += 1; return Promise.resolve(new Response(body)); } };
}

/** Bindings-only env — NO EDGE_SHOWCASE_MODE key; missing-var cases must spread this (B2: a "true" key would test the wrong state). */
function baseEnv(touched: { count: number }) {
  return {
    CONTAINER: { idFromName: () => "id", get: () => fetchStub(touched, "container") },
    USERS: fetchStub(touched, "users"),
    CATALOG: fetchStub(touched, "cat"),
    EDGE_GUARD: trackingGuard(touched),
  } as never;
}

const functionalEnv = (touched: { count: number }) => ({ ...(baseEnv(touched) as object), EDGE_SHOWCASE_MODE: "true" } as never);

/** A gate wired to a captured warn log instead of console: per-case state, so
 * warn-once assertions never depend on which test ran first. */
function capturedWarnGate(): { gate: ShowcaseMode; warns: string[] } {
  const warns: string[] = [];
  return { gate: createShowcaseMode((message) => { warns.push(message); }), warns };
}

// ── the strict-boolean contract (C1-style, worker-side) ─────────────────────

// test-type: unit
void test("AC: a malformed value warns once per gate, then stays silent", () => {
  const { gate, warns } = capturedWarnGate();
  assert.equal(gate.isEnabled("TRUE"), true);
  assert.equal(gate.isEnabled("1"), true);
  assert.equal(gate.isEnabled("yes"), true);
  assert.equal(warns.length, 1, "a misconfigured value must be visible, not silent — but only once");
  assert.match(warns[0] ?? "", /EDGE_SHOWCASE_MODE=.*failing closed/);
});

// test-type: unit
void test("AC: an UNSET EDGE_SHOWCASE_MODE denies AND warns — a missing binding must not deny in silence", () => {
  const { gate, warns } = capturedWarnGate();
  assert.equal(gate.isEnabled(undefined), true);
  assert.equal(warns.length, 1, "unset must warn once (observability of a misconfigured deploy)");
});

// test-type: unit
void test("AC: only the literal \"false\" opens the backend", () => {
  const gate = createShowcaseMode();
  assert.equal(gate.isEnabled("false"), false);
});

// test-type: unit
void test("AC: \"true\" arms the gate", () => {
  const gate = createShowcaseMode();
  assert.equal(gate.isEnabled("true"), true);
});

// test-type: unit
void test("AC: unset, empty and malformed values fail closed", () => {
  const gate = createShowcaseMode();
  for (const raw of [undefined, "", "TRUE", "False", "1", "yes", " true", "true "]) {
    assert.equal(gate.isEnabled(raw), true, `expected ${JSON.stringify(raw)} to fail closed`);
  }
});

// ── showcase=true: functional routes 403, no binding ever touched ───────────

// test-type: unit
void test("AC: showcase=true — POST /v1/chat is 403 showcase_denied; container, guard and auth untouched", async () => {
  const touched = { count: 0 };
  let authCalled = false;
  const app = createWorkerApp({
    authenticate: () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); },
  });
  const res = await app.request("/v1/chat", { method: "POST" }, functionalEnv(touched), stubCtx);
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: { code: "showcase_denied", message: "Not available in showcase mode." } });
  assert.equal(touched.count, 0, "no binding — EDGE_GUARD included — may be read before the denial");
  assert.equal(authCalled, false);
});

// test-type: unit
void test("AC: showcase=true — every other functional route is 403 and touches no binding", async () => {
  const app = createWorkerApp({});
  const paths = ["/v1/photo-search", "/v1/users/saved-routes", "/v1/search/preview", "/catalog/public/anime-overview/3302"];
  for (const path of paths) {
    const touched = { count: 0 };
    const res = await app.request(path, {}, functionalEnv(touched), stubCtx);
    assert.equal(res.status, 403, `${path} must be denied in showcase mode`);
    assert.equal(touched.count, 0, `${path} must not touch any binding, EDGE_GUARD included`);
  }
});

// ── showcase=true: the landing's own surface stays reachable ────────────────

// test-type: unit
void test("AC: showcase=true — /healthz still reaches the container", async () => {
  const touched = { count: 0 };
  const app = createWorkerApp({});
  const res = await app.request("/healthz", {}, functionalEnv(touched), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(touched.count, 1);
});

// test-type: unit
void test("AC: showcase=true — /img/* still routes to the image proxy", async () => {
  const app = createWorkerApp({});
  const res = await app.request("/img/a..b", {}, { EDGE_SHOWCASE_MODE: "true" }, stubCtx);
  assert.equal(res.status, 400, "the image-proxy '..' guard runs, so the route is reachable, not 403");
});

// test-type: unit
void test("AC: showcase=true — /tiles/* still serves map assets", async () => {
  const app = createWorkerApp({});
  const env = { EDGE_SHOWCASE_MODE: "true", MAP_TILES: { get: () => Promise.resolve({ body: new Response("mvt").body, etag: "t", size: 3 }) } } as never;
  const res = await app.request("/tiles/14/135/892.mvt", {}, env, stubCtx);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "mvt");
});

// ── showcase=false: everything behaves exactly as before ────────────────────

// test-type: unit
void test("AC: showcase=false — authenticated /v1/chat reaches the native tier, rate limit still armed", async () => {
  const touched = { count: 0 };
  const app = createWorkerApp({
    agentTurns: nativeAgentReceiver([], () => { touched.count += 1; return new Response("agent"); }),
    authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const),
  });
  const env = { ...(functionalEnv(touched) as object), EDGE_SHOWCASE_MODE: "false" };
  const res = await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, env, stubCtx);
  assert.equal(await res.text(), "agent");
  // idFromName + get + fetch on EDGE_GUARD (checkRateLimit), then the native receiver.
  assert.equal(touched.count, 4);
});

// test-type: unit
void test("AC: showcase=false — /v1/users/saved-routes and the public catalog read work as before", async () => {
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const) });
  const touched = { count: 0 };
  const env = { ...(functionalEnv(touched) as object), EDGE_SHOWCASE_MODE: "false" };
  const users = await app.request("/v1/users/saved-routes", { headers: { Authorization: "Bearer jwt" } }, env, stubCtx);
  assert.equal(await users.text(), "users");
  const catalog = await app.request("/catalog/public/anime-overview/3302", {}, env, stubCtx);
  assert.equal(await catalog.text(), "cat");
  assert.equal(touched.count, 2);
});

// ── fail-closed: unset or malformed EDGE_SHOWCASE_MODE ──────────────────────

// test-type: unit
void test("AC: a missing EDGE_SHOWCASE_MODE denies functional routes but keeps /healthz up", async () => {
  const app = createWorkerApp({});
  const touched = { count: 0 };
  const env = baseEnv(touched);
  const res = await app.request("/v1/chat", { method: "POST" }, env, stubCtx);
  assert.equal(res.status, 403, "an unset variable must never silently open the backend");
  assert.equal(touched.count, 0);
  const health = await app.request("/healthz", {}, env, stubCtx);
  assert.equal(await health.text(), "container");
});

// test-type: unit
void test("AC: malformed values (\"TRUE\", \"1\", empty) deny functional routes", async () => {
  const app = createWorkerApp({});
  for (const malformed of ["TRUE", "1", ""]) {
    const env = { ...(functionalEnv({ count: 0 }) as object), EDGE_SHOWCASE_MODE: malformed };
    const res = await app.request("/v1/chat", { method: "POST" }, env, stubCtx);
    assert.equal(res.status, 403, `EDGE_SHOWCASE_MODE=${JSON.stringify(malformed)} must fail closed`);
  }
});
