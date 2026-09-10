import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { envWithContainer, stubCtx } from "../src/container/entry-env.ts";

void test("/v1 public route -> container, no auth called", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/search/preview?q=test", {}, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
});

void test("/v1 guide route (regex) is public -> container, no auth, client X-User stripped", async () => {
  let authCalled = false;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: false, reason: "absent" } as const); };
  const app = createWorkerApp({ authenticate });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/bangumi/12345/guide", { headers: { "X-User-Id": "forged" } }, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.equal(authCalled, false);
  assert.equal(cap.req?.headers.get("X-User-Id"), null);
});

void test("/v1 authed route without creds -> 401, container not hit", async () => {
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const cap: { req?: Request } = {};
  const res = await app.request("/v1/chat", { method: "POST" }, envWithContainer(cap), stubCtx);
  assert.equal(res.status, 401);
  assert.equal(cap.req, undefined);
});

void test("verified authentication reaches the native tier as a separate identity", async () => {
  const calls: NativeAgentCall[] = [];
  const authenticate = () => Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const);
  const app = createWorkerApp({ authenticate, agentTurns: nativeAgentReceiver(calls) });
  const res = await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt" } }, envWithContainer({}), stubCtx);
  assert.equal(res.status, 200);
  assert.deepEqual(calls[0]?.identity, { userId: "u1", userType: "human" });
});

void test("client-forged identity headers cannot override the native authenticated identity", async () => {
  const calls: NativeAgentCall[] = [];
  const authenticate = () => Promise.resolve({ ok: true, userId: "real", userType: "human" } as const);
  const app = createWorkerApp({ authenticate, agentTurns: nativeAgentReceiver(calls) });
  await app.request("/v1/chat", { method: "POST", headers: { Authorization: "Bearer jwt", "X-User-Id": "forged", "X-User-Type": "admin" } }, envWithContainer({}), stubCtx);
  assert.deepEqual(calls[0]?.identity, { userId: "real", userType: "human" });
  assert.equal(calls[0].request.headers.get("X-User-Id"), "forged");
});

void test("public route strips caller identity and bearer before container forwarding", async () => {
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const cap: { req?: Request } = {};
  const headers = { Authorization: "Bearer private", "X-User-Id": "forged" };
  const res = await app.request("/v1/search/preview?q=test", { headers }, envWithContainer(cap), stubCtx);
  assert.equal(await res.text(), "container");
  assert.ok(cap.req);
  assert.equal(cap.req.headers.get("X-User-Id"), null);
  assert.equal(cap.req.headers.get("Authorization"), null);
});

void test("/v1/users with valid auth -> USERS gets X-User identity, no Authorization", async () => {
  let authCalled = false;
  let received: Request | undefined;
  const authenticate = () => { authCalled = true; return Promise.resolve({ ok: true, userId: "u1", userType: "human" } as const); };
  const app = createWorkerApp({ authenticate });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: (req: Request) => { received = req; return Promise.resolve(new Response("users")); } },
    CONTAINER: {
      idFromName: () => "id",
      get: () => ({ fetch: () => Promise.resolve(new Response("container")) }),
    },
  } as never;
  const res = await app.request("/v1/users/saved-routes", {
    headers: { Authorization: "Bearer x", "X-User-Id": "forged" },
  }, env, stubCtx);
  assert.equal(await res.text(), "users");
  assert.equal(authCalled, true, "the edge must verify the users bearer itself");
  assert.ok(received);
  assert.equal(received.headers.get("X-User-Id"), "u1");
  assert.equal(received.headers.get("X-User-Type"), "human");
  assert.equal(received.headers.get("Authorization"), null, "raw bearer must never reach the users service");
});

void test("/v1/users with an invalid credential 401s without hitting USERS", async () => {
  let received = false;
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "invalid" }) });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: () => { received = true; return Promise.resolve(new Response("users")); } },
  } as never;
  const res = await app.request("/v1/users/saved-routes", { headers: { Authorization: "Bearer bad" } }, env, stubCtx);
  assert.equal(res.status, 401);
  assert.equal(received, false);
});

void test("/v1/users with no credential 401s — anonymous is never allowed on users", async () => {
  let received = false;
  const app = createWorkerApp({ authenticate: () => Promise.resolve({ ok: false, reason: "absent" }) });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    USERS: { fetch: () => { received = true; return Promise.resolve(new Response("users")); } },
  } as never;
  const res = await app.request("/v1/users/saved-routes", {}, env, stubCtx);
  assert.equal(res.status, 401);
  assert.equal(received, false);
});
