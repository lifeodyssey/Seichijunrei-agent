/** The production `database-access` stack's declarations.
 *
 * A separate file from the `topology-*.test.ts` files that build a stack,
 * following `topology-neon-auth.test.ts`: nothing here imports a Pulumi
 * program. `infra/database-access` is a SECOND Pulumi program and it cannot be
 * built through the harness at all — its Neon provider is a bridged SDK
 * generated at release time (`pulumi install`) from Pulumi.yaml's pins and
 * deliberately kept out of the repo
 * (`infra/database-access/.gitignore`), so there is no `@pulumi/neon` for a
 * test process to import. What CAN be pinned without it is the pair of
 * derivations that decide what the prod stack emits — the role list and the
 * stack-name suffix — read from the program's source and composed here exactly
 * as the program composes them.
 *
 * This matters because staging and production share ONE Cloudflare Secrets
 * Store: a suffix that stopped applying would not fail, it would silently make
 * the production apply overwrite staging's DSN with production's.
 *
 * Runs under `node --test topology-*.test.ts` (the infra package test lane)
 * with zero network and zero credentials. #1314's AC names `topology-prod.test.ts`
 * for these assertions; they live beside it rather than inside it because that
 * file plus this section is 235 lines, over the repo's ≤200-line test-file cap.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";

const repoFile = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const databaseAccess = repoFile("./database-access/index.ts");

/** The store-secret name the program writes for `role` on `stack`. */
function storeSecretName(role: string, stack: string): string {
  const base = new RegExp(`\\{\\s*name: "${role}",\\s*secretName: "([^"]+)",`).exec(databaseAccess);
  assert.ok(base, `database-access must declare the ${role} role with a store secret`);
  const suffix = /const secretNameSuffix = pulumi\.getStack\(\) === "(\w+)" \? "([^"]*)" : "([^"]*)";/
    .exec(databaseAccess);
  assert.ok(suffix, "database-access must derive its store-secret suffix from the stack name");
  return `${base[1]}${stack === suffix[1] ? suffix[2] : suffix[3]}`;
}

function stackConfig(stack: string, key: string): string {
  const source = repoFile(`./database-access/Pulumi.${stack}.yaml`);
  const match = new RegExp(`^\\s+animichi-neon-secrets:${key}:\\s*(\\S+)$`, "m").exec(source);
  assert.ok(match, `Pulumi.${stack}.yaml must set ${key}`);
  return match[1] ?? "";
}

test("the prod stack composes an agent_svc DSN secret that cannot collide with staging's", () => {
  assert.equal(storeSecretName("agent_svc", "prod"), "AGENT_SVC_DATABASE_URL_PROD");
  assert.equal(storeSecretName("agent_svc", "staging"), "AGENT_SVC_DATABASE_URL");
});

test("the agent_svc role is declared for every stack, not gated to staging", () => {
  // The role list is one unconditional array — the only thing the stack name
  // changes is the secret NAME above. A `getStack()` guard around the role
  // itself is what would leave production without a data-plane identity.
  const roleList = databaseAccess.slice(
    databaseAccess.indexOf("const roleDefs"),
    databaseAccess.indexOf("const roles ="),
  );
  assert.match(roleList, /name: "agent_svc"/);
  assert.doesNotMatch(roleList, /getStack\(\)/, "the role list must not branch on the stack");
});

test("the prod stack targets the production branch of the same Neon project", () => {
  // Roles are project-scoped and the store is account-scoped, so the branch id
  // is the ONLY thing separating the two stacks' composed DSNs. Equal branch
  // ids would publish the staging endpoint under the production secret name.
  assert.notEqual(stackConfig("prod", "neonBranchId"), stackConfig("staging", "neonBranchId"));
  assert.equal(stackConfig("prod", "neonProjectId"), stackConfig("staging", "neonProjectId"));
  assert.equal(stackConfig("prod", "secretsStoreId"), stackConfig("staging", "secretsStoreId"));
});

test("the production edge Worker binds the exact secret name the prod stack writes", () => {
  // The two halves of the #1314 cutover live in different packages and are
  // joined only by this string; nothing else compares them before a deploy.
  const edge = repoFile("../workers/edge/wrangler.toml");
  const binding = /\[\[env\.production\.secrets_store_secrets\]\]\nbinding = "AGENT_SVC_DATABASE_URL"\nstore_id = "([^"]+)"\nsecret_name = "([^"]+)"/
    .exec(edge);
  assert.ok(binding, "the production edge Worker must bind AGENT_SVC_DATABASE_URL");
  assert.equal(binding[2], storeSecretName("agent_svc", "prod"));
  assert.equal(binding[1], stackConfig("prod", "secretsStoreId"));
});
