import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";

const SECRET = "fixed-test-hmac-key-0000000000000000";
const ANON_ENV = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: SECRET, EDGE_SHOWCASE_MODE: "false" };

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

const authOk = () => Promise.resolve({ ok: true, userId: "real-user-1", userType: "human" } as const);

/** An EDGE_GUARD stand-in that always allows (mirrors entry.test.ts): the
 * adoption route is not in AUTH_RATE_LIMITED_EXACT, but it still passes
 * through `authenticatedForward`'s check, which reads `env.EDGE_GUARD`. */
const alwaysAllowGuard = {
  idFromName: (name: string) => name as unknown as DurableObjectId,
  get: () => ({
    fetch: () =>
      Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))),
  }),
};

function environmentWithContainer(captured: { req?: Request }, body: object = { adopted: 1, noop_class: "adopted" }) {
  return {
    ...ANON_ENV,
    EDGE_GUARD: alwaysAllowGuard,
    CONTAINER: containerStub(captured, body),
  } as never;
}

function containerStub(captured: { req?: Request }, body: object) {
  return {
    idFromName: () => "id",
    get: () => ({
      fetch: (r: Request) => { captured.req = r; return Promise.resolve(new Response(JSON.stringify(body), { status: 200 })); },
    }),
  };
}

async function anonCookieFor(userId: string): Promise<string> {
  // Mirrors auth.ts's HMAC scheme with the fixed test secret above.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const raw = userId.replace(/^anon_/, "");
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(raw));
  const hex = Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `aid=${raw}.${hex}`;
}

void test("a valid aid cookie reaches the container as X-Anon-Id, exactly", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "a".repeat(32));
  await app.request("/v1/sessions/adopt", { method: "POST", headers: { Cookie: cookie } }, environmentWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-Anon-Id"), "anon_" + "a".repeat(32));
});

void test("a non-POST adopt request answers 405 and is never forwarded (SESSION-2 #960)", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const res = await app.request(
    "/v1/sessions/adopt", { method: "GET" }, environmentWithContainer(cap), stubCtx,
  );
  assert.equal(res.status, 405);
  assert.equal(cap.req, undefined);
});

void test("no aid cookie -> no X-Anon-Id forwarded, and no Set-Cookie on the response", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const res = await app.request(
    "/v1/sessions/adopt", { method: "POST" }, environmentWithContainer(cap, { adopted: 0, noop_class: "no_rows" }), stubCtx,
  );
  assert.equal(cap.req?.headers.get("X-Anon-Id"), null);
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("a tampered aid cookie -> no X-Anon-Id forwarded, and no Set-Cookie on the response", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const res = await app.request(
    "/v1/sessions/adopt",
    { method: "POST", headers: { Cookie: `aid=${"a".repeat(32)}.${"b".repeat(64)}` } },
    environmentWithContainer(cap, { adopted: 0, noop_class: "no_rows" }),
    stubCtx,
  );
  assert.equal(cap.req?.headers.get("X-Anon-Id"), null);
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("a client-forged X-Anon-Id is overwritten by the edge's own resolution", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "c".repeat(32));
  await app.request(
    "/v1/sessions/adopt",
    { method: "POST", headers: { Cookie: cookie, "X-Anon-Id": "anon_" + "f".repeat(32) } },
    environmentWithContainer(cap),
    stubCtx,
  );
  assert.equal(cap.req?.headers.get("X-Anon-Id"), "anon_" + "c".repeat(32));
  assert.notEqual(cap.req.headers.get("X-Anon-Id"), "anon_" + "f".repeat(32));
});

// Owner ruling (#507) REVERSING S1.7 rev5 P2-b: the adoption no longer retires
// the `aid` cookie. Retiring it minted a fresh identity on the next anonymous
// turn and reset the per-identity quota, making "exhaust quota -> free login ->
// log out -> new allowance" a loop the D12 banner walks visitors into. After a
// successful adoption the anonymous identity owns nothing anyway, so what a
// shared browser inherits is an empty identity plus the day's quota count --
// which is the point. Asserted on BOTH outcomes so a re-introduction fails here.

void test("a successful adoption does NOT retire the aid cookie (#507 reversal)", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "d".repeat(32));
  const res = await app.request(
    "/v1/sessions/adopt", { method: "POST", headers: { Cookie: cookie } }, environmentWithContainer(cap, { adopted: 1, noop_class: "adopted" }), stubCtx,
  );
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("the surviving identity keeps working: a later anonymous turn reuses it", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const anonId = "anon_" + "d".repeat(32);
  const cookie = await anonCookieFor(anonId);
  const adopted = await app.request(
    "/v1/sessions/adopt", { method: "POST", headers: { Cookie: cookie } }, environmentWithContainer(cap, { adopted: 1, noop_class: "adopted" }), stubCtx,
  );
  // Nothing in the response tells the browser to drop `aid`, so the same
  // cookie still resolves to the same identity -- and therefore to the same
  // per-identity quota bucket, which is what closes the log-out-for-more loop.
  assert.equal(adopted.headers.get("Set-Cookie"), null);
  await app.request("/v1/sessions/adopt", { method: "POST", headers: { Cookie: cookie } }, environmentWithContainer(cap), stubCtx);
  assert.equal(cap.req?.headers.get("X-Anon-Id"), anonId);
});

void test("a no-op adoption (adopted: 0, noop_class: no_rows) sets no cookie either", async () => {
  const cap: { req?: Request } = {};
  const app = createWorkerApp({ authenticate: authOk });
  const cookie = await anonCookieFor("anon_" + "e".repeat(32));
  const res = await app.request(
    "/v1/sessions/adopt", { method: "POST", headers: { Cookie: cookie } }, environmentWithContainer(cap, { adopted: 0, noop_class: "no_rows" }), stubCtx,
  );
  assert.equal(res.headers.get("Set-Cookie"), null);
});

void test("an adoption-only X-Anon-Id header cannot replace the native chat identity", async () => {
  const calls: NativeAgentCall[] = [];
  const app = createWorkerApp({ authenticate: authOk, agentTurns: nativeAgentReceiver(calls) });
  const cookie = await anonCookieFor("anon_" + "b".repeat(32));
  const res = await app.request("/v1/chat", { method: "POST", headers: { Cookie: cookie, "X-Anon-Id": "anon_" + "b".repeat(32) } }, environmentWithContainer({}), stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0]?.identity, { userId: "real-user-1", userType: "human" });
});
