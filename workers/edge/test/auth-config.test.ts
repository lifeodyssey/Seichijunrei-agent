import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const WRANGLER = readFileSync(`${ROOT}workers/edge/wrangler.toml`, "utf8");
const TOP_LEVEL = WRANGLER.slice(0, WRANGLER.indexOf("\n[vars]\n"));
const READ_CONFIG_SCRIPT = `
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_readConfig } = await import("wrangler");
const config = unstable_readConfig({ config: process.argv[1], env: process.argv[2] });
process.stdout.write(String(config.name));
`;
const READ_RUNTIME_CONFIG_SCRIPT = `
process.env.WRANGLER_WRITE_LOGS = "false";
const { unstable_readConfig } = await import("wrangler");
const config = unstable_readConfig({ config: process.argv[1], env: "staging" });
process.stdout.write(String(config.vars?.RUNTIME_CONFIG ?? ""));
`;

function blockFor(header: string): string {
  const start = WRANGLER.indexOf(`\n${header}\n`) + 1;
  assert.notEqual(start, 0, `missing Wrangler section ${header}`);
  const next = WRANGLER.indexOf("\n[", start + header.length);
  return WRANGLER.slice(start, next === -1 ? undefined : next);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasAssignment(block: string, key: string, value: string): boolean {
  return new RegExp(`^${key}\\s*=\\s*"${escapeRegExp(value)}"$`, "m").test(block);
}

function parsedWorkerName(environment: string): string {
  return execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", READ_CONFIG_SCRIPT, `${ROOT}workers/edge/wrangler.toml`, environment],
    { encoding: "utf8" },
  );
}

function stagingAuthBaseUrl(): string {
  const path = `${ROOT}apps/web/wrangler.jsonc`;
  const raw = execFileSync(process.execPath, ["--input-type=module", "--eval", READ_RUNTIME_CONFIG_SCRIPT, path], { encoding: "utf8" });
  const config = JSON.parse(raw) as { neonAuthBaseUrl?: unknown };
  if (typeof config.neonAuthBaseUrl !== "string") assert.fail("web staging config must declare its Neon Auth SDK endpoint");
  return config.neonAuthBaseUrl;
}

// AUTH-2 #950 hard cut: the JWKS URL is the edge's ONLY identity source;
// the activation flag and issuer slot are deleted. Production must not carry
// a JWKS until its branch is provisioned (empty fails closed).
void test("staging pins the Neon Auth JWKS as the only identity source", () => {
  const staging = blockFor("[env.staging.vars]");
  const expected = `${stagingAuthBaseUrl()}/.well-known/jwks.json`;
  assert.equal(hasAssignment(staging, "NEON_AUTH_JWKS_URL", expected), true, "edge JWKS must match the web SDK endpoint");
  assert.equal(staging.includes("REDACTED"), false, "staging auth must not deploy a placeholder endpoint");
});

void test("production has no JWKS yet — unprovisioned fails closed", () => {
  const prod = blockFor("[env.production.vars]");
  assert.equal(hasAssignment(prod, "NEON_AUTH_JWKS_URL", ""), false, "production JWKS must stay unset until the branch is provisioned");
});

void test("bare Wrangler deploy has no target, while named environments keep theirs", () => {
  assert.equal(/^name\s*=/m.test(TOP_LEVEL), false, "top-level Wrangler config must not select a deploy target");
  assert.equal(hasAssignment(blockFor("[[containers]]"), "name", "animichi-runtimecontainer"), true);
  assert.equal(hasAssignment(blockFor("[env.production]"), "name", "animichi"), true);
  assert.equal(hasAssignment(blockFor("[env.staging]"), "name", "animichi-staging"), true);
});

void test("named Wrangler environments pass the real config parser", () => {
  const environments = [
    ["staging", "animichi-staging"],
    ["production", "animichi"],
  ] as const;
  for (const [environment, expectedName] of environments) {
    assert.equal(parsedWorkerName(environment), expectedName);
  }
});

function deploymentFile(path: string): string {
  return readFileSync(`${ROOT}${path}`, "utf8");
}

void test("CORS_ALLOWED_ORIGIN is a wrangler var for staging and production (issue #1047)", () => {
  const staging = blockFor("[env.staging.vars]");
  const prod = blockFor("[env.production.vars]");
  assert.equal(hasAssignment(staging, "CORS_ALLOWED_ORIGIN", "https://animichi-web-staging.zhenjiazhou0127.workers.dev"), true, "staging CORS is a wrangler var");
  assert.equal(hasAssignment(prod, "CORS_ALLOWED_ORIGIN", "https://animichi.com"), true, "production CORS is a wrangler var");
});

void test("deploy workflows carry neither value as a GitHub secret (issue #1047)", () => {
  const paths = [".github/workflows/cd.yml"];
  for (const path of paths) {
    const text = deploymentFile(path);
    assert.equal(text.includes("secrets.NEON_AUTH_JWKS_URL"), false, `${path} must not reference secrets.NEON_AUTH_JWKS_URL`);
    assert.equal(text.includes("secrets.CORS_ALLOWED_ORIGIN"), false, `${path} must not reference secrets.CORS_ALLOWED_ORIGIN`);
  }
});

void test("NEON_AUTH_ENABLED and NEON_AUTH_ISSUER remain absent from deploy workflows", () => {
  const paths = [".github/workflows/cd.yml"];
  for (const path of paths) {
    const text = deploymentFile(path);
    assert.equal(text.includes("NEON_AUTH_ENABLED"), false, `${path} must not turn the disabled public var into a secret`);
    assert.equal(text.includes("NEON_AUTH_ISSUER"), false, `${path} must not turn the public issuer into a secret`);
  }
});
