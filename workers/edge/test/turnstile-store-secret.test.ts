import test from "node:test";
import assert from "node:assert/strict";
import { guardTurnstile } from "../src/protect/turnstile.ts";

void test("Turnstile verification receives the store-bound TURNSTILE_SECRET value", async () => {
  const env = { TURNSTILE_SECRET: { get: () => Promise.resolve("store-turnstile") } };
  const received: string[] = [];
  const gate = { check: (_token: string | null, _ip: string, secret: string) => {
    received.push(secret);
    return Promise.resolve({ ok: true, errorCodes: [] });
  } };
  assert.equal(await guardTurnstile(new Request("https://example.test/v1/chat"), env, gate, "anon_test"), null);
  assert.deepEqual(received, ["store-turnstile"]);
});

const unusedGate = { check: () => Promise.reject(new Error("must not verify")) };

void test("an empty Turnstile store value denies verification", async () => {
  const env = { TURNSTILE_SECRET: { get: () => Promise.resolve("") } };
  const response = await guardTurnstile(new Request("https://example.test/v1/chat"), env, unusedGate, "anon_test");
  assert.equal(response?.status, 403);
});

void test("an unavailable Turnstile store never sends a verification request", async () => {
  const env = { TURNSTILE_SECRET: { get: () => Promise.reject(new Error("store unavailable")) } };
  await assert.rejects(guardTurnstile(new Request("https://example.test/v1/chat"), env, unusedGate, "anon_test"), /store unavailable/);
});
