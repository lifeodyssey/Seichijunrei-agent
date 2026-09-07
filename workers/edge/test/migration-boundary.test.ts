import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");

void test("Atlas files are the only Neon migration authority", () => {
  const files = readdirSync(`${ROOT}migrations/neon`).filter((file) => file.endsWith(".sql"));
  const sum = read("migrations/neon/atlas.sum");
  assert.notEqual(files.length, 0);
  for (const file of files) assert.match(sum, new RegExp(`^${file} h1:`, "m"));
  assert.match(read("docs/ops/migrations.md"), /migrations\/neon\/\*\.sql.*atlas\.sum/s);
});

void test("Drizzle schemas cannot become migration runners", () => {
  // Every worker that maps the data plane, discovered rather than listed: a new
  // service's schema must not slip past this boundary by not being enumerated.
  const workers = readdirSync(`${ROOT}workers`);
  const schemas = workers.map((worker) => `workers/${worker}/src/db/schema.ts`);
  const present = schemas.filter((path) => existsSync(`${ROOT}${path}`));
  assert.ok(present.length >= 3, `expected every worker Drizzle schema, saw ${present.join(", ")}`);
  for (const path of present) {
    const source = read(path);
    assert.doesNotMatch(source, /drizzle-kit|drizzle\s+(?:migrate|generate|push|pull)/i);
    assert.match(source, /typing only|query-only/i);
  }
});

// Both workflow-shape halves of this file are gone, for the same reason: a fact
// about a workflow's shape asserted from the edge package made the edge lane
// fail for a workflow's reasons. The PR lane's — which job validates, in what
// order, and that no job applies — went to
// .github/scripts/test_schema_lane_contract.rb with B5 (#1363); the CD lane's —
// which job needs which — went to .github/scripts/test_cd_shape_contract.rb
// with C1 (#1364). What stays here is the boundary itself: who may migrate, and
// from what source. Both environments reach the database only through the
// migrator Worker on each job's own OIDC identity — C3 (#1365) moved production
// onto that path and deleted the last database credential CI held.
void test("both environments migrate through the migrator Worker on an OIDC identity", () => {
  const cd = read(".github/workflows/cd.yml");
  const handshake = read("scripts/delivery/migrate-through-worker.sh");
  assert.match(cd, /stage-migration:[\s\S]*id-token: write/);
  assert.match(cd, /MIGRATOR_URL: \$\{\{ vars\.MIGRATOR_STAGING_URL \}\}/);
  assert.match(cd, /migrate-through-worker\.sh staging/);
  assert.match(cd, /MIGRATOR_URL: \$\{\{ vars\.MIGRATOR_PRODUCTION_URL \}\}/);
  assert.match(cd, /migrate-through-worker\.sh production/);
  assert.match(handshake, /audience=animichi:github-actions:migrator/);
  assert.doesNotMatch(cd, /NEON_DATABASE_URL/);
});

void test("no job applies the chain itself, and a staging-only baseline still stops production", () => {
  const cd = read(".github/workflows/cd.yml");
  assert.doesNotMatch(cd, /atlas migrate apply/);
  assert.doesNotMatch(cd, /ariga\/setup-atlas/);
  assert.match(cd, /release\/migrations\/STAGING_ONLY_BASELINE/);
});

// #1332: the deploy call returning is not the new bundle serving. The handshake
// waits on the head the Worker itself reports before it POSTs anything, and
// treats the Worker's own `409 stale_bundle` as the same fact from the far side.
void test("the migration waits for the migrator to serve the sealed head", () => {
  const handshake = read("scripts/delivery/migrate-through-worker.sh");
  assert.match(handshake, /healthz/);
  assert.match(handshake, /bundleHead/);
  assert.match(handshake, /stale_bundle/);
});

void test("README points operators to the migration runbook", () => {
  for (const path of ["README.md", "README.zh.md", "README.ja.md"]) {
    assert.match(read(path), /docs\/ops\/migrations\.md/);
  }
});
