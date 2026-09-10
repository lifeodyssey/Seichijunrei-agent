import test from "node:test";
import assert from "node:assert/strict";
import { ANON_ID_PREFIX, anonymousEnabled, resolveAnonymous } from "../src/identity/auth.ts";

const SECRET = "fixed-test-hmac-key-0000000000000000";
const ANON_ENV = { ANON_ACCESS_ENABLED: "true", ANON_ID_SECRET: SECRET };

void test("anonymous access stays off unless both the flag and the secret are set", async () => {
  assert.equal(await anonymousEnabled({}), false);
  assert.equal(await anonymousEnabled({ ANON_ACCESS_ENABLED: "true" }), false);
  assert.equal(await anonymousEnabled({ ANON_ID_SECRET: SECRET }), false);
  assert.equal(await anonymousEnabled(ANON_ENV), true);
});

void test("a brand-new visitor with zero history is issued an identity at once", async () => {
  const identity = await resolveAnonymous(new Request("https://app.test/v1/chat"), ANON_ENV);
  assert.ok(identity);
  assert.match(identity.userId, new RegExp(`^${ANON_ID_PREFIX}[0-9a-f]{32}$`));
  assert.match(String(identity.setCookie), /^aid=[0-9a-f]{32}\.[0-9a-f]{64}; /);
});

void test("the issued cookie is HttpOnly, Secure and SameSite-scoped", async () => {
  const identity = await resolveAnonymous(new Request("https://app.test/v1/chat"), ANON_ENV);
  assert.match(String(identity?.setCookie), /HttpOnly/);
  assert.match(String(identity?.setCookie), /Secure/);
  assert.match(String(identity?.setCookie), /SameSite=Lax/);
});

async function returningVisitor(): Promise<{ first: string; second: string | null; cookie: string }> {
  const minted = await resolveAnonymous(new Request("https://app.test/v1/chat"), ANON_ENV);
  const cookie = String(minted?.setCookie).split(";")[0] ?? "";
  const repeat = await resolveAnonymous(
    new Request("https://app.test/v1/chat", { headers: { Cookie: cookie } }), ANON_ENV,
  );
  return { first: String(minted?.userId), second: repeat?.userId ?? null, cookie };
}

void test("a returning visitor keeps the same identity and gets no new cookie", async () => {
  const visitor = await returningVisitor();
  assert.equal(visitor.second, visitor.first);
  const repeat = await resolveAnonymous(
    new Request("https://app.test/v1/chat", { headers: { Cookie: visitor.cookie } }), ANON_ENV,
  );
  assert.equal(repeat?.setCookie, null);
});

void test("a forged anonymous cookie is discarded and a fresh identity minted", async () => {
  const forged = `aid=${"a".repeat(32)}.${"b".repeat(64)}`;
  const identity = await resolveAnonymous(
    new Request("https://app.test/v1/chat", { headers: { Cookie: forged } }), ANON_ENV,
  );
  assert.notEqual(identity?.userId, `${ANON_ID_PREFIX}${"a".repeat(32)}`);
  assert.notEqual(identity?.setCookie, null);
});

void test("a cookie signed with a different secret is rejected", async () => {
  const other = await resolveAnonymous(new Request("https://app.test/v1/chat"), {
    ...ANON_ENV, ANON_ID_SECRET: "a-different-fixed-test-key-000000",
  });
  const cookie = String(other?.setCookie).split(";")[0] ?? "";
  const identity = await resolveAnonymous(
    new Request("https://app.test/v1/chat", { headers: { Cookie: cookie } }), ANON_ENV,
  );
  assert.notEqual(identity?.userId, other?.userId);
});
