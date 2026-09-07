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

// The PR lane's own shape — which job validates, in what order, and that it
// never applies — moved to .github/scripts/test_ci_workflow_contract.rb with
// B5 (#1363): it is a fact about pr-verification.yml, and asserting it from
// the edge package made the edge lane fail for a workflow's reasons. What
// stays here is the boundary itself: who may migrate, and from what source.

void test("main CD orders migration between foundation and services", () => {
  const cd = read(".github/workflows/cd.yml");
  // #1218/audit §2.2: every stage's `needs` lists every earlier stage directly (not just
  // its immediate predecessor) so a failure two or more stages back can't evaporate into
  // a `skipped` result on the way to a later stage — see
  // .github/scripts/test_cd_skip_propagation_contract.rb. The ordering assertion here
  // checks that stage-foundation still precedes stage-migration, and stage-migration still
  // precedes stage-services, within each stage's (now longer) needs list.
  assert.match(cd, /stage-migration:[\s\S]*needs: \[route, build-release-artifacts, stage-foundation\]/);
  assert.match(cd, /stage-services:[\s\S]*needs: \[route, build-release-artifacts, stage-foundation, stage-migration\]/);
  assert.match(cd, /uses: \.\/\.github\/actions\/promote-release-phase/);
});

void test("staging migration uses OIDC while production applies the sealed Atlas chain", () => {
  const cd = read(".github/workflows/cd.yml");
  const action = read(".github/actions/promote-release-phase/action.yml");
  const promotion = read(".github/scripts/promote-release-unit.sh");
  assert.match(cd, /stage-migration:[\s\S]*id-token: write/);
  assert.match(cd, /migrator_url: \$\{\{ vars\.MIGRATOR_STAGING_URL \}\}/);
  assert.match(action, /MIGRATOR_URL: \$\{\{ inputs\.migrator_url \}\}/);
  assert.match(promotion, /audience=animichi:github-actions:migrator/);
  assert.match(promotion, /atlas migrate validate --dir "file:\/\/\$PAYLOAD_DIR\/migrations"/);
  assert.match(promotion, /atlas migrate apply[\s\S]*--revisions-schema public/);
});

void test("README points operators to the migration runbook", () => {
  for (const path of ["README.md", "README.zh.md", "README.ja.md"]) {
    assert.match(read(path), /docs\/ops\/migrations\.md/);
  }
});
