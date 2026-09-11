// Issue #441: a presented-but-unverifiable credential must 401, never silently
// become an anonymous identity. Covers both halves of the contract: the reason
// `authenticate` reports, and the branch `createWorkerApp` takes on it.
import test from "node:test";
import assert from "node:assert/strict";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";
import { authenticate, type AuthResult } from "../src/identity/auth.ts";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { fakeGuard } from "./doubles/guard-doubles.ts";

const ENV = { NEON_AUTH_JWKS_URL: "https://neon-441.example.test/.well-known/jwks.json" };
const SECRET = "fixed-test-hmac-key-0000000000000000";
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

const stubCtx = {
  waitUntil(promise: Promise<unknown>) { void promise; },
  passThroughOnException() { return undefined; },
} as unknown as ExecutionContext;

function requestedUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (input: RequestInfo | URL) => Promise.resolve(handler(requestedUrl(input)));
}

function bearer(token: string): Request {
  return new Request("https://app.example.test/v1/chat", { headers: { Authorization: `Bearer ${token}` } });
}

async function edFixture(host: string, exp: string | number = "1h") {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = { ...await exportJWK(publicKey), kid: "fake-eddsa-key" };
  const token = await new SignJWT({}).setProtectedHeader({ alg: "EdDSA", kid: jwk.kid })
    .setIssuer(host).setAudience(host).setSubject("fake-user")
    .setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { jwk, token };
}

function jwks(jwk: JWK): Response {
  return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
}

/** The edge's Neon environment for a token issued against `host`. */
function neonFor(host: string) {
  return { ...ENV, NEON_AUTH_JWKS_URL: `${host}/.well-known/jwks.json` };
}

// ── `authenticate` reports WHY it failed ───────────────────────────────────

void test("an absent Authorization header reports reason absent", async () => {
  const request = new Request("https://app.example.test/v1/chat");
  const result = await authenticate(request, ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(result, { ok: false, reason: "absent" });
});

void test("a non-Bearer Authorization scheme reports reason absent", async () => {
  const request = new Request("https://app.example.test/v1/chat", { headers: { Authorization: "Basic dXNlcjpwdw==" } });
  const result = await authenticate(request, ENV, stubFetch(() => new Response("", { status: 200 })));
  assert.deepEqual(result, { ok: false, reason: "absent" });
});

void test("an expired bearer JWT reports reason invalid", async () => {
  const host = "https://neon-441-expired.example.test";
  const { jwk, token } = await edFixture(host, Math.floor(Date.now() / 1000) - 60);
  const result = await authenticate(bearer(token), neonFor(host), stubFetch(() => jwks(jwk)));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

void test("a bearer JWT signed by an untrusted key reports reason invalid", async () => {
  const host = "https://neon-441-signature.example.test";
  const trusted = await edFixture(host);
  const untrusted = await edFixture(host);
  const result = await authenticate(bearer(untrusted.token), neonFor(host), stubFetch(() => jwks(trusted.jwk)));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

void test("a malformed bearer token reports reason invalid", async () => {
  const result = await authenticate(bearer("not-a-jwt"), ENV, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

void test("a bearer scheme with no token reports reason absent", async () => {
  // Header values are trimmed before we see them, so `Bearer` + whitespace is
  // the same string as a bare scheme: nothing was actually presented.
  const result = await authenticate(bearer("   "), ENV, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(result, { ok: false, reason: "absent" });
});

void test("an sk_ credential reports reason invalid (AUTH-1: api_keys deleted)", async () => {
  const result = await authenticate(bearer("sk_fake_unknown"), ENV, stubFetch(() => new Response("", { status: 500 })));
  assert.deepEqual(result, { ok: false, reason: "invalid" });
});

// ── the /v1 branch honours the reason ──────────────────────────────────────

function anonEnv() {
  return { ANON_ACCESS_ENABLED: "true", TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    ANON_ID_SECRET: SECRET, EDGE_SHOWCASE_MODE: "false", EDGE_GUARD: fakeGuard(NOW).namespace } as never;
}

/** #441 is about which credential verdict may become anonymous, so the #447
 * Turnstile gate is stubbed to a pass here; `turnstile-arm.test.ts` owns it. */
const passingGate = { check: () => Promise.resolve({ ok: true, errorCodes: [] }) };

function appWith(result: AuthResult, calls: NativeAgentCall[] = []) {
  return createWorkerApp({
    authenticate: () => Promise.resolve(result),
    turnstileGate: passingGate,
    agentTurns: nativeAgentReceiver(calls),
  });
}

void test("an invalid credential 401s instead of becoming anonymous", async () => {
  const captured: NativeAgentCall[] = [];
  const response = await appWith({ ok: false, reason: "invalid" }, captured).request(
    "/v1/chat", { method: "POST" }, anonEnv(), stubCtx,
  );
  assert.equal(response.status, 401);
  assert.equal(captured.length, 0);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

void test("an invalid credential 401 carries the typed unauthorized code", async () => {
  const captured: NativeAgentCall[] = [];
  const response = await appWith({ ok: false, reason: "invalid" }, captured).request(
    "/v1/chat", { method: "POST" }, anonEnv(), stubCtx,
  );
  const body = await response.json() as { error: { code: string } };
  assert.equal(body.error.code, "unauthorized");
});

void test("an invalid credential is recorded so a 401 storm is visible", async () => {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (line: unknown) => { warnings.push(String(line)); };
  try {
    await appWith({ ok: false, reason: "invalid" }).request(
      "/v1/chat", { method: "POST" }, anonEnv(), stubCtx,
    );
  } finally {
    console.warn = original;
  }
  const records = warnings.map((line) => JSON.parse(line) as { event: string; path?: string });
  const record = records.find((entry) => entry.event === "edge_auth_invalid_credential");
  assert.deepEqual(record, { event: "edge_auth_invalid_credential", path: "/v1/chat" });
});

void test("an absent credential reaches the native tier with anonymous identity", async () => {
  const captured: NativeAgentCall[] = [];
  const response = await appWith({ ok: false, reason: "absent" }, captured).request(
    "/v1/chat", { method: "POST" }, anonEnv(), stubCtx,
  );
  assert.equal(response.status, 200);
  assert.equal(captured[0]?.identity.userType, "anonymous");
});
