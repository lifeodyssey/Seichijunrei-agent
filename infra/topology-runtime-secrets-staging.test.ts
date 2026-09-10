import test from "node:test";
import assert from "node:assert/strict";
import { buildRuntimeSecrets, RUNTIME_KEYS } from "./testing/runtime-secrets.ts";
import { unseal } from "./testing/harness.ts";

const resources = await buildRuntimeSecrets("staging");

test("staging provisions all seven runtime secrets with exact names", () => {
  assert.deepEqual(resources.map((resource) => resource.name), RUNTIME_KEYS);
});

for (const name of RUNTIME_KEYS) {
  test(`staging ${name} is worker-scoped and its resource input is secret-marked`, () => {
    const resource = resources.find((resource) => resource.name === name);
    assert.ok(resource);
    assert.equal(resource.type, "cloudflare:index/secretsStoreSecret:SecretsStoreSecret");
    assert.equal(resource.inputs.accountId, "account-fixture");
    assert.equal(resource.inputs.storeId, "store-fixture");
    assert.deepEqual(resource.inputs.scopes, ["workers"]);
    assert.deepEqual(unseal(resource.inputs.value), { isSecret: true, value: `fixture-${resource.name}` });
  });
}
