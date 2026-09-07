import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

import { CONTAINER_ENV_KEYS, CONTAINER_REQUIRED_KEYS } from "../src/container/container-env.ts";

// #1050 — migrator-role isolation contract (Migration Executor, spec
// §"Database identity"). The dedicated `migrator` Postgres role is
// necessarily neon_superuser-grade; minimization is behavioral, and this test
// is the machine-checked half of rules (1)+(2): the migrator DSN secret
// (MIGRATOR_DATABASE_URL) must never reach any runtime Worker's standing
// environment nor any container env allowlist. Precedent: the GEMINI_API_KEY
// removal guard (container-env.test.ts) pins a removal by scanning config
// surfaces rather than only the code that reads them.
//
// test-type: unit (reads checked-in files; no network, no clock, no mocks).

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The migrator DSN secret name as declared in the database-access IaC and the
// token the runtime surfaces must never reference. Centralized so both sides
// of the contract stay in lockstep.
const MIGRATOR_SECRET = "MIGRATOR_DATABASE_URL";
const migratorSecretRegex = new RegExp(escapeRegExp(MIGRATOR_SECRET));

void test("MIGRATOR_DATABASE_URL is NOT in the container env forwarding allowlist", () => {
  assert.equal(CONTAINER_ENV_KEYS.includes(MIGRATOR_SECRET), false);
});

void test("MIGRATOR_DATABASE_URL is NOT in the container required-keys list", () => {
  assert.equal(CONTAINER_REQUIRED_KEYS.includes(MIGRATOR_SECRET), false);
});

void test("no runtime worker wrangler.toml binds the migrator DSN", () => {
  const workers = ["catalog", "users", "edge"];
  for (const worker of workers) {
    const toml = read(`workers/${worker}/wrangler.toml`);
    assert.doesNotMatch(toml, migratorSecretRegex, `${worker} wrangler.toml must not reference MIGRATOR_DATABASE_URL`);
    // The role name itself is equally off-limits in any binding/secret surface.
    assert.doesNotMatch(toml, /\bmigrator\b/, `${worker} wrangler.toml must not reference the migrator role`);
  }
});

void test("no deploy workflow ferries the migrator DSN as a worker secret", () => {
  for (const workflow of [".github/workflows/cd.yml"]) {
    assert.doesNotMatch(read(workflow), migratorSecretRegex, `${workflow} must not upload MIGRATOR_DATABASE_URL as a worker secret`);
  }
});

// #1365 — the negative assertion above only means something while the DSN
// actually arrives the other way. Every deployed migrator environment must bind
// it from the Secrets Store, and the two environments must bind DIFFERENT store
// secrets: staging and production share the account's single store, so one
// shared name would point the production Worker at the staging database.
void test("every migrator environment binds its own Secrets Store DSN", () => {
  const toml = read("workers/migrator/wrangler.toml");
  const bindings = [...toml.matchAll(/\[\[env\.(\w+)\.secrets_store_secrets]]\n([^[]*)/g)];
  const named = new Map<string, string>(bindings.map((match) => [match[1] ?? "", match[2] ?? ""]));
  assert.deepEqual([...named.keys()].sort(), ["production", "staging"]);
  for (const [env, body] of named) {
    assert.match(body, /binding = "MIGRATOR_DATABASE_URL"/, `${env} must bind the migrator DSN`);
  }
  const secretNames = [...named.values()].map((body) => /secret_name = "(\w+)"/.exec(body)?.[1] ?? "(none)");
  assert.equal(new Set(secretNames).size, 2, `staging and production must name different store secrets, saw ${secretNames.join(", ")}`);
});

void test("database-access IaC DOES provision the migrator role + MIGRATOR_DATABASE_URL store secret", () => {
  // The isolation assertions above are only meaningful while the migrator is
  // actually provisioned through the same IaC path as the runtime roles —
  // otherwise deleting the role would silently "pass" the negative checks.
  const databaseAccess = read("infra/database-access/index.ts");
  assert.match(databaseAccess, /name: "migrator"/, "database-access index.ts must declare the migrator role");
  assert.match(databaseAccess, migratorSecretRegex, "database-access index.ts must declare the MIGRATOR_DATABASE_URL store secret");
});

void test("migrator wrangler.toml has no Builds token binding", () => {
  const toml = read("workers/migrator/wrangler.toml");
  assert.doesNotMatch(toml, /BUILDS_API_TOKEN/);
  assert.doesNotMatch(toml, /CLOUDFLARE_API_TOKEN/);
});
