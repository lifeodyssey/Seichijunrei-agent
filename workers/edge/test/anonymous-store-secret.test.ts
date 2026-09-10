import test from "node:test";
import assert from "node:assert/strict";
import { resolveAnonymous, resolveAnonymousReadOnly } from "../src/identity/anonymous-id.ts";

void test("anonymous identity signs and verifies its cookie with a store-bound ANON_ID_SECRET", async () => {
  const env = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: { get: () => Promise.resolve("store-anonymous") } };
  const first = await resolveAnonymous(new Request("https://example.test/v1/chat"), env);
  assert.ok(first?.setCookie);
  const request = new Request("https://example.test/v1/chat", { headers: { Cookie: first.setCookie } });
  assert.deepEqual(await resolveAnonymousReadOnly(request, env), { userId: first.userId, setCookie: null });
});

void test("disabled anonymous access never fetches its store secret", async () => {
  const env = { ANON_ACCESS_ENABLED: "false", ANON_ID_SECRET: { get: () => Promise.reject(new Error("must not read")) } };
  assert.equal(await resolveAnonymous(new Request("https://example.test/v1/chat"), env), null);
});

void test("an empty anonymous store value refuses an identity", async () => {
  const env = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: { get: () => Promise.resolve("") } };
  assert.equal(await resolveAnonymous(new Request("https://example.test/v1/chat"), env), null);
});

void test("an unavailable anonymous store fails without issuing an identity", async () => {
  const env = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: { get: () => Promise.reject(new Error("store unavailable")) } };
  await assert.rejects(resolveAnonymous(new Request("https://example.test/v1/chat"), env), /store unavailable/);
});

void test("rotation invalidates an anonymous cookie signed by the old key", async () => {
  let value = "initial-anonymous";
  const env = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: { get: () => Promise.resolve(value) } };
  const first = await resolveAnonymous(new Request("https://example.test/v1/chat"), env);
  assert.ok(first?.setCookie);
  value = "rotated-anonymous";
  const request = new Request("https://example.test/v1/chat", { headers: { Cookie: first.setCookie } });
  assert.equal(await resolveAnonymousReadOnly(request, env), null);
});
