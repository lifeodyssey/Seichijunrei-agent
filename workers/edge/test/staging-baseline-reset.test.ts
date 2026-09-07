import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { URL, fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (path: string): string => readFileSync(`${ROOT}${path}`, "utf8");
const BASELINE_FILES = [
  "20260826000000_extensions.sql",
  "20260826000001_roles.sql",
  "20260826000002_functions.sql",
  "20260826000003_catalog.sql",
  "20260826000004_agent.sql",
  "20260826000005_users.sql",
  "20260829000000_fix_coordinate_sync_precedence.sql",
  "20260902000000_agent_runs.sql",
  "20260904000000_platform_usage_scope.sql",
];
const baselineSql = (): string => BASELINE_FILES.map((name) => read(`migrations/neon/${name}`)).join("\n");

void test("Neon history is the baseline chain plus append-only amendments, applied in dependency order", () => {
  const files = readdirSync(`${ROOT}migrations/neon`).filter((name) => name.endsWith(".sql"));
  assert.deepEqual(files.sort(), [...BASELINE_FILES].sort());
  const sum = read("migrations/neon/atlas.sum");
  for (const name of BASELINE_FILES) {
    assert.match(sum, new RegExp(`^${name} h1:`, "m"));
  }
});

void test("baseline contains only the final schema", () => {
  const sql = baselineSql();
  assert.doesNotMatch(sql, /public\.api_keys/i);
  assert.match(sql, /CREATE TABLE public\.turn_reservations/);
  assert.match(sql, /request_digest text NULL/);
  assert.match(sql, /outcome_payload jsonb NULL/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.turn_reservations/i);
});

void test("baseline closes the catalog runtime grant gap", () => {
  const sql = read("migrations/neon/20260826000003_catalog.sql");
  assert.match(sql, /GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public\.catalog_runs TO catalog_svc/);
  assert.match(sql, /GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public\.raw_payload_history TO catalog_svc/);
  assert.match(sql, /GRANT SELECT, USAGE ON SEQUENCE public\.raw_payload_history_seq_seq TO catalog_svc/);
});

// system-health-audit 2026-08-26 §3: catalog_svc's write grants were `GRANT ALL`
// (TRUNCATE/REFERENCES/TRIGGER included) on 14/16 catalog tables; locations and
// location_aliases already used the narrower form. All 16 are now consistent.
void test("catalog_svc write grants are narrowed to CRUD, never GRANT ALL", () => {
  const sql = read("migrations/neon/20260826000003_catalog.sql");
  assert.doesNotMatch(sql, /GRANT ALL ON TABLE/);
});

void test("staging reset is branch-backed and production-safe", () => {
  const sh = read("infra/database-access/reset-staging-baseline.sh");
  assert.match(sh, /Pulumi\.staging\.yaml/);
  assert.match(sh, /Pulumi\.prod\.yaml/);
  assert.match(sh, /staging-before-\$\{BASELINE_VERSION\}-baseline/);
  assert.match(sh, /branches create[\s\S]*--parent "\$BRANCH_ID"[\s\S]*--no-compute/);
  assert.match(sh, /--role-name "\$role"/);
  assert.match(sh, /staging_psql neondb_owner/);
  assert.match(sh, /neonctl@3\.6\.0/);
  assert.doesNotMatch(sh, /neonctl@latest/);
});

// audit §2.6: the reset SQL's three statements ran without a transaction wrapper — a
// mid-script failure could leave the schema dropped but not yet recreated/granted.
void test("the reset SQL runs as a single transaction", () => {
  const sh = read("infra/database-access/reset-staging-baseline.sh");
  assert.match(sh, /staging_psql neondb_owner -1 -v ON_ERROR_STOP=1 -f "\$RESET_SQL"/);
});

// audit §2.6: the shared reset script fired on every foundation promotion regardless of
// whether the push touched the schema. #1364 moved that narrowing out of the retired
// promotion script and into the step's own `if:` — the reset runs only when this push
// carries a migrations/neon change, and only against staging.
void test("the reset trigger is narrowed to pushes that change the schema", () => {
  const cd = read(".github/workflows/cd.yml");
  assert.match(
    cd,
    /Reset the staging schema baseline\n\s*if: \$\{\{ needs\.plan\.outputs\.migrations == 'true' \}\}/,
  );
  assert.doesNotMatch(cd, /promote-production:[\s\S]*reset-staging-baseline\.sh/);
});

void test("reset SQL has one exact destructive target", () => {
  const sql = read("infra/database-access/reset-staging-baseline.sql");
  assert.match(sql, /DROP SCHEMA IF EXISTS public CASCADE/);
  assert.match(sql, /CREATE SCHEMA public/);
  assert.match(sql, /GRANT USAGE, CREATE ON SCHEMA public TO migrator/);
  assert.doesNotMatch(sql, /DROP DATABASE|DROP ROLE|production/i);
});

void test("CD resets only staging and blocks production baseline SQL", () => {
  const cd = read(".github/workflows/cd.yml");
  const production = cd.slice(cd.indexOf("promote-production:"));
  assert.match(cd, /reset-staging-baseline\.sh/);
  assert.doesNotMatch(production, /reset-staging-baseline\.sh/);
  assert.match(production, /STAGING_ONLY_BASELINE/);
  assert.match(production, /staging-only baseline requires a separately approved production cutover/);
});

// The assertions above only prove the message is present in the file. A stray
// `+` shipped on this branch left them all green while turning the guard into
// `+: command not found`, so these run the shipped lines against a real payload.
const productionGuard = (): string => {
  const lines = read(".github/workflows/cd.yml").split("\n");
  const at = lines.findIndex((line) => line.includes("release/migrations/STAGING_ONLY_BASELINE"));
  assert.notEqual(at, -1, "CD must guard production on the staging-only marker");
  const end = lines.findIndex((line, index) => index > at && line.trim() === "fi");
  assert.notEqual(end, -1, "the marker guard must be a closed if-block");
  return lines.slice(at, end + 1).map((line) => line.trimStart()).join("\n");
};

const runProductionGuard = (marked: boolean): { status: number | null; stdout: string } => {
  const payload = mkdtempSync(join(tmpdir(), "promote-guard-"));
  mkdirSync(join(payload, "release", "migrations"), { recursive: true });
  if (marked) writeFileSync(join(payload, "release", "migrations", "STAGING_ONLY_BASELINE"), "");
  const source = `set -euo pipefail\n${productionGuard()}\necho PROCEEDED`;
  const result = spawnSync("bash", ["-c", source], { cwd: payload, encoding: "utf8" });
  rmSync(payload, { force: true, recursive: true });
  return { status: result.status, stdout: `${result.stdout}${result.stderr}` };
};

void test("the shipped guard blocks production when the staging-only marker is present", () => {
  const blocked = runProductionGuard(true);
  assert.equal(blocked.status, 1, "guard must exit 1, not fall through a shell error");
  assert.match(blocked.stdout, /staging-only baseline requires a separately approved production cutover/);
  assert.doesNotMatch(blocked.stdout, /PROCEEDED/);
});

void test("the shipped guard lets a payload without the marker through", () => {
  const allowed = runProductionGuard(false);
  assert.equal(allowed.status, 0);
  assert.match(allowed.stdout, /PROCEEDED/);
});

// Owner decision 2026-08-27 (reverses #539 for STAGING ONLY): the CD smoke
// probes workers.dev because the zone front door bot-challenges GitHub-runner
// IPs. Production must never re-open it.
void test("workers_dev is open for staging only, never production", () => {
  const toml = read("workers/edge/wrangler.toml");
  const staging = toml.slice(toml.indexOf("[env.staging]"));
  assert.match(staging, /^workers_dev = true$/m);
  // Production carries no explicit workers_dev: wrangler defaults it to false,
  // and the guard is that nobody ever writes `true` there.
  const production = toml.slice(toml.indexOf("[env.production]"), toml.indexOf("[env.staging]"));
  assert.doesNotMatch(production, /^workers_dev = true$/m);
});

void test("atlas.sum SHA-256 pins the hard-cut payload", () => {
  const sum = readFileSync(`${ROOT}migrations/neon/atlas.sum`);
  assert.equal(createHash("sha256").update(sum).digest("hex"), "087c178c1ccbfc940197b7d7e8b818701d17813a256fbdcfd74d1a888f65ad54");
});

// #1216 — the migrator's own error lived only in the discarded response body, so
// a reset staging database failed as a bare "HTTP 500". This repository is
// public: the body is logged, and any DSN in it must lose its password first.
const shellFunction = (name: string): string => {
  const lines = read("scripts/delivery/migrate-through-worker.sh").split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${name}() {`));
  assert.notEqual(at, -1, `${name} must exist in the migration handshake`);
  const end = lines.findIndex((line, index) => index > at && line === "}");
  return lines.slice(at, end + 1).join("\n");
};

const SECRET = "not-a-real-password";
const DSN_FORMS: readonly (readonly [string, string])[] = [
  ["URI user-info", `postgresql://migrator:${SECRET}@ep-x.neon.tech/neondb`],
  ["a URI parameter", `postgresql://ep-x.neon.tech/neondb?sslmode=require&password=${SECRET}`],
  ["a keyword/value DSN", `host=ep-x.neon.tech user=migrator password=${SECRET} dbname=neondb`],
];

const reportFailure = (body: string): { status: number | null; stdout: string } => {
  const dir = mkdtempSync(join(tmpdir(), "migrate-body-"));
  const response = join(dir, "migrate.json");
  writeFileSync(response, body);
  const shipped = [shellFunction("report_failure"), shellFunction("redact_dsn_passwords")].join("\n");
  const source = `set -euo pipefail\nRESPONSE="${response}"\nfail() { echo "FAILED:$*"; exit 1; }\n${shipped}\nreport_failure "migrator returned HTTP 500"`;
  const result = spawnSync("bash", ["-c", source], { encoding: "utf8" });
  rmSync(dir, { force: true, recursive: true });
  return { status: result.status, stdout: result.stdout };
};

void test("a migrator failure logs its response body instead of only the status", () => {
  const reported = reportFailure(JSON.stringify({ detail: 'relation "public.atlas_schema_revisions" does not exist' }));
  assert.equal(reported.status, 1);
  assert.match(reported.stdout, /atlas_schema_revisions/);
  assert.match(reported.stdout, /FAILED:migrator returned HTTP 500/);
});

// PostgreSQL accepts the password three ways and the first version of this
// redaction covered only the first, so each form is asserted separately.
for (const [form, dsn] of DSN_FORMS) {
  void test(`the logged body keeps the host but drops a password given as ${form}`, () => {
    const reported = reportFailure(JSON.stringify({ error: `connect failed for ${dsn}` }));
    assert.doesNotMatch(reported.stdout, new RegExp(SECRET));
    assert.match(reported.stdout, /ep-x\.neon\.tech/);
  });
}

// Past the 64 KiB pipe buffer `| head -c` exits first, the redactor dies on
// SIGPIPE, and `set -e` takes the function down before `fail` reports anything.
void test("the failure message survives a body larger than the pipe buffer", () => {
  const reported = reportFailure(JSON.stringify({ error: `boom ${"x".repeat(200_000)}` }));
  assert.equal(reported.status, 1, "a large body must not turn the failure into SIGPIPE");
  assert.match(reported.stdout, /FAILED:migrator returned HTTP 500/);
  assert.ok(reported.stdout.length < 8_000, "the logged body must still be truncated");
});

// audit §2.6: a failed `staging_psql` call (connection/permission failure) produced the
// same empty stdout as a successful query answering "false" — both fell through
// `grep -qx t` to "not applied" and triggered `DROP SCHEMA CASCADE`. These run the shipped
// `query_bool`/`ledger_exists`/`baseline_applied` functions with a stub `staging_psql`
// standing in for the real connection, so "cannot confirm" and "confirmed unapplied" are
// proven to take different paths rather than just asserting the source text says so.
const resetShellFunction = (name: string): string => {
  const lines = read("infra/database-access/reset-staging-baseline.sh").split("\n");
  const at = lines.findIndex((line) => line.startsWith(`${name}() {`));
  assert.notEqual(at, -1, `${name} must exist in the reset script`);
  const end = lines.findIndex((line, index) => index > at && line === "}");
  return lines.slice(at, end + 1).join("\n");
};

const shippedBaselineCheck = [
  resetShellFunction("query_bool"),
  resetShellFunction("ledger_exists"),
  resetShellFunction("baseline_applied"),
].join("\n");

const runBaselineApplied = (stagingPsqlBody: string): { status: number | null; stdout: string } => {
  const source = `set -euo pipefail
BASELINE_VERSION="20260826000005"
fail() { echo "FAILED:$*"; exit 1; }
staging_psql() {
${stagingPsqlBody}
}
${shippedBaselineCheck}
if baseline_applied; then echo "ALREADY_APPLIED"; else echo "NOT_APPLIED"; fi`;
  const result = spawnSync("bash", ["-c", source], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout };
};

void test("a psql connection failure refuses the reset instead of treating it as unapplied", () => {
  const result = runBaselineApplied('echo "connection to server failed" >&2\n  return 2');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAILED:cannot confirm staging state/);
  assert.doesNotMatch(result.stdout, /NOT_APPLIED|ALREADY_APPLIED/);
});

// `baseline_applied` calls `staging_psql` twice — once through `ledger_exists` (does the
// ledger table exist), once for the version check (has this baseline been applied). A
// call-counter file lets the stub answer each call differently.
const runBaselineAppliedTwoCalls = (
  firstAnswer: string,
  secondAnswer: string,
): { status: number | null; stdout: string } => {
  const dir = mkdtempSync(join(tmpdir(), "baseline-check-"));
  const counter = join(dir, "calls");
  const stub = `count=0
[ -f "${counter}" ] && count="$(cat "${counter}")"
count=$((count + 1))
echo "$count" > "${counter}"
if [ "$count" = 1 ]; then echo "${firstAnswer}"; else echo "${secondAnswer}"; fi`;
  const result = runBaselineApplied(stub);
  rmSync(dir, { force: true, recursive: true });
  return result;
};

void test("a confirmed-unapplied baseline (ledger exists, version query answers f) allows the reset to proceed", () => {
  const result = runBaselineAppliedTwoCalls("t", "f");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /NOT_APPLIED/);
});

void test("a confirmed-applied baseline (ledger exists, version query answers t) skips the reset", () => {
  const result = runBaselineAppliedTwoCalls("t", "t");
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ALREADY_APPLIED/);
});
