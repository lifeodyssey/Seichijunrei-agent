/**
 * W4-1 (#1314): where each deployed environment gets the agent tier's Neon DSN.
 *
 * The agent runs in a CONTAINER, which has no Secrets Store binding of its own,
 * so the DSN only ever travels one way: Pulumi writes a store secret →
 * `[[env.<env>.secrets_store_secrets]]` binds it onto THIS Worker →
 * `CONTAINER_ENV_KEYS` forwards it into the container (and, since W1, the
 * Worker's own agent tier reads it directly). Every link in that chain is a
 * string that has to match a string somebody else wrote, and none of them are
 * checked until a deploy: wrangler resolves `secret_name` against the store at
 * deploy time, and `env.<binding>.get()` throws at runtime.
 *
 * #855 left production deliberately unbound because its store secret did not
 * exist. This card lifts that, and the two facts worth pinning are the ones a
 * careless copy of the staging block would get wrong: staging and production
 * share ONE Cloudflare Secrets Store (the account plan refuses a second), so
 * the two environments' DSNs must differ by `secret_name` — while the BINDING
 * name stays identical, because `container-env.ts` forwards one key regardless
 * of environment.
 *
 * test-type: unit (parses checked-in files; no network, no clock, no mocks).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

import { CONTAINER_ENV_KEYS } from "../src/container/container-env.ts";

const WRANGLER = readFileSync(fileURLToPath(new URL("../wrangler.toml", import.meta.url)), "utf8");

interface StoreBinding {
  environment: string;
  binding: string;
  storeId: string;
  secretName: string;
}

/** Every `[[env.<env>.secrets_store_secrets]]` block the config declares. */
function storeBindings(): StoreBinding[] {
  const blocks = WRANGLER.matchAll(
    /\[\[env\.(\w+)\.secrets_store_secrets\]\]\nbinding = "([^"]+)"\nstore_id = "([^"]+)"\nsecret_name = "([^"]+)"/g,
  );
  return [...blocks].map((block) => ({
    environment: block[1] ?? "",
    binding: block[2] ?? "",
    storeId: block[3] ?? "",
    secretName: block[4] ?? "",
  }));
}

function agentDsnBindingFor(environment: string): StoreBinding {
  const found = storeBindings().find(
    (candidate) => candidate.environment === environment && candidate.binding === "AGENT_SVC_DATABASE_URL",
  );
  assert.ok(found, `env.${environment} must bind AGENT_SVC_DATABASE_URL from the Secrets Store`);
  return found;
}

void test("both deployed environments bind the agent data-plane DSN", () => {
  const environments = storeBindings()
    .filter((candidate) => candidate.binding === "AGENT_SVC_DATABASE_URL")
    .map((candidate) => candidate.environment)
    .sort();
  assert.deepEqual(environments, ["production", "staging"]);
});

void test("production reads its own store secret, never staging's", () => {
  // One shared store: identical secret_names across the two environments would
  // hand production staging's role password, not merely fail a deploy.
  assert.equal(agentDsnBindingFor("staging").secretName, "AGENT_SVC_DATABASE_URL");
  assert.equal(agentDsnBindingFor("production").secretName, "AGENT_SVC_DATABASE_URL_PROD");
});

void test("both environments resolve against the one account Secrets Store", () => {
  // The account plan refuses a second store (maximum_stores_exceeded), which is
  // the whole reason the production secret carries the _PROD suffix above.
  assert.equal(agentDsnBindingFor("production").storeId, agentDsnBindingFor("staging").storeId);
});

void test("the binding name is identical in both environments, so one forwarding key serves both", () => {
  assert.equal(agentDsnBindingFor("production").binding, agentDsnBindingFor("staging").binding);
  assert.ok(
    CONTAINER_ENV_KEYS.includes(agentDsnBindingFor("production").binding),
    "the container env allowlist must forward the name wrangler binds",
  );
});

void test("the production data-plane binding serves the native edge tier", () => {
  const productionVars = WRANGLER.slice(WRANGLER.indexOf("\n[env.production.vars]\n"), WRANGLER.indexOf("\n[env.staging]\n"));
  assert.doesNotMatch(productionVars, /^AGENT_TURN_ROUTE\s*=/m);
});
