import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { identityPolicySchema } from "@animichi/contract/identity";
import { DEFAULT_IDENTITY_POLICY } from "@animichi/contract/identity-policy";
import { createWorkerApp } from "../src/app.ts";
import { nativeAgentReceiver, type NativeAgentCall } from "./doubles/native-agent-receiver.ts";
import { stubCtx } from "../src/container/entry-env.ts";
import { authRateLimitConfigFrom, rateLimitConfigFrom } from "../src/protect/rate-limiter.ts";

// AUTH-1 #945: the explicit public/anonymous/authenticated matrix. Every
// numeric cell is pinned at its consumers — the deployed wrangler.toml config,
// the rate-limiter defaults, and the closed identity-class schema — so a
// divergent hardcoded value, a restored api_keys table, an accepted `agent`
// class, or a BYOK header promoting an anonymous caller all fail here.

const WRANGLER_TOML = fileURLToPath(new URL("../wrangler.toml", import.meta.url));
const wranglerToml = readFileSync(WRANGLER_TOML, "utf8");
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/neon/", import.meta.url));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockFor(header: string): string {
  const match = new RegExp(`^${escapeRegExp(header)}$`, "m").exec(wranglerToml);
  assert.ok(match, `wrangler.toml must contain a "${header}" section header`);
  const start = match.index;
  const next = wranglerToml.indexOf("\n[", start + header.length);
  return wranglerToml.slice(start, next === -1 ? undefined : next);
}

function numericInBlock(header: string, key: string): number {
  const match = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*"([^"]+)"`, "m").exec(blockFor(header));
  assert.ok(match, `"${header}" must set ${key}`);
  const value = Number(match[1]);
  assert.ok(Number.isFinite(value), `${key} in "${header}" must be numeric`);
  return value;
}

const ANON = DEFAULT_IDENTITY_POLICY.anonymous;
const AUTH = DEFAULT_IDENTITY_POLICY.authenticated;
const anonRate = ANON.rateLimit;
const authRate = AUTH.rateLimit;
assert.ok(anonRate, "the anonymous class must define a rate limit in the policy");
assert.ok(authRate, "the authenticated class must define a rate limit in the policy");

for (const [header, label] of [
  ["[vars]", "root/dev"],
  ["[env.production.vars]", "production"],
  ["[env.staging.vars]", "staging"],
] as const) {
  void test(`anonymous matrix cells match the IdentityPolicy in ${label}`, () => {
    assert.equal(numericInBlock(header, "ANON_RATE_LIMIT"), anonRate.limit);
    assert.equal(numericInBlock(header, "ANON_RATE_LIMIT_WINDOW_SECONDS"), anonRate.windowSeconds);
    assert.equal(numericInBlock(header, "ANON_DAILY_MESSAGE_QUOTA"), ANON.dailyMessageQuota);
    assert.equal(numericInBlock(header, "ANON_DAILY_COST_BUDGET_USD"), ANON.dailyCostBudgetUsd);
  });

  void test(`authenticated matrix cells match the IdentityPolicy in ${label}`, () => {
    assert.equal(numericInBlock(header, "AUTH_RATE_LIMIT"), authRate.limit);
    assert.equal(numericInBlock(header, "AUTH_RATE_LIMIT_WINDOW_SECONDS"), authRate.windowSeconds);
  });
}

void test("rate-limiter defaults come from the IdentityPolicy, never hardcoded literals", () => {
  assert.deepEqual(rateLimitConfigFrom({}), { limit: anonRate.limit, windowSeconds: anonRate.windowSeconds });
  assert.deepEqual(authRateLimitConfigFrom({}), { limit: authRate.limit, windowSeconds: authRate.windowSeconds });
});

void test("the identity matrix is closed: an agent class is rejected by the schema", () => {
  const withAgent = {
    ...DEFAULT_IDENTITY_POLICY,
    agent: { rateLimit: null, dailyMessageQuota: null, dailyCostBudgetUsd: null },
  };
  assert.equal(identityPolicySchema.safeParse(withAgent).success, false, "an accepted agent class would resurrect the deleted identity path");
});

void test("api_keys is absent from the hard-cut baseline", () => {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort();
  const sql = (name: string): string => readFileSync(`${MIGRATIONS_DIR}${name}`, "utf8");
  assert.deepEqual(files, [
    "20260826000000_extensions.sql",
    "20260826000001_roles.sql",
    "20260826000002_functions.sql",
    "20260826000003_catalog.sql",
    "20260826000004_agent.sql",
    "20260826000005_users.sql",
    "20260829000000_fix_coordinate_sync_precedence.sql",
    "20260902000000_agent_runs.sql",
    "20260904000000_platform_usage_scope.sql",
  ]);
  assert.ok(files.every((name) => !/public\.api_keys/i.test(sql(name))));
});

void test("anonymous BYOK is never promoted to authenticated (the native identity stays anonymous)", async () => {
  const captured: NativeAgentCall[] = [];
  const app = createWorkerApp({
    authenticate: () => Promise.resolve({ ok: false, reason: "absent" } as const),
    turnstileGate: { check: () => Promise.resolve({ ok: true, errorCodes: [] }) },
    agentTurns: nativeAgentReceiver(captured),
  });
  const env = {
    EDGE_SHOWCASE_MODE: "false",
    ANON_ACCESS_ENABLED: "true",
    ANON_ID_SECRET: "fixed-test-hmac-key-0000000000000000",
    TURNSTILE_SECRET: "fixed-test-turnstile-secret-0000000",
    EDGE_GUARD: {
      idFromName: () => "id",
      get: () => ({
        fetch: () => Promise.resolve(new Response(JSON.stringify({ allowed: true, retryAfterSeconds: 0 }))),
      }),
    },
  } as never;
  const res = await app.request("/v1/chat", {
    method: "POST",
    headers: {
      "X-BYOK-Provider": "openai-compatible",
      "X-BYOK-Key": "sk-fake",
      "X-BYOK-Base-Url": "https://evil.example",
    },
  }, env, stubCtx);
  assert.equal(res.status, 200, "the anonymous chat flow still serves the request");
  const forwarded = captured[0];
  assert.ok(forwarded, "the native tier must receive the anonymous identity");
  assert.equal(forwarded.identity.userType, "anonymous");
  assert.match(forwarded.identity.userId, /^anon_/);
});
