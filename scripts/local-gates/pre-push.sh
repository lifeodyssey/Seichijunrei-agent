#!/usr/bin/env bash
# Pre-push gate orchestrator (#1003): mirror every deterministic CI check that
# can run locally on every push, fail-fast, routed by the changed package set.
#
# Routing (#1003): `scripts/local-gates/changed-packages.sh` reads the
# merge-base-to-head diff (AC1) and is the ONLY route source. The real hook
# never reads an override variable, so a caller cannot set
# GATE_CHANGED_PACKAGES to shrink the route and skip agent/db/infra gates.
# The deterministic Quality lane always runs (repo-wide, sub-second). Each
# affected package then runs its CI-equivalent gate set (lint + typecheck +
# unit + coverage + build, contract drift for contract, Pulumi program-load
# for infra, fresh-schema apply for db). `all` (unknown/root paths) runs every
# package's full gate set (AC2) — never a typecheck-only shortcut. The
# behavioral tests inject routes only through the dedicated test driver
# (scripts/local-gates/pre-push-test-driver.sh), which sources this file and
# calls run_pre_push; this file's real entry runs the canonical router and
# nothing else.
#
# Orchestration is decomposed to stay inside the repo's 1-10-50 rule: the
# routing state (changed / ALL / route_includes) is bound in init_route, each
# package's CI-equivalent gate set is a small gate_<package> function, and
# run_pre_push is a short dispatcher over them (run_package_gates).
#
# Everything runs exactly as CI runs it; nothing weaker is duplicated here.
# Fail-fast: the first failing gate aborts the push (set -euo pipefail).
# No command here mutates shared cloud infrastructure (test_no_forbidden_cloud_mutation_commands).
#
# Contract: docs/ops/local-gates.md. Behavioral tests: pre-push.test.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# git hands a hook GIT_DIR (and its siblings) when it runs it from a linked
# worktree. Every gate below is meant to act on the checkout at ROOT, which it
# finds from this directory, and several behavioural tests build throwaway
# fixture repos under mktemp. An inherited GIT_DIR overrides both — it beats
# `git -C <fixture>` and a `cwd=<fixture>` subprocess alike — so a fixture's
# `git add .` stages the real index and its `git commit` runs the real hooks
# and fails. Drop them and let every git command resolve from where it runs.
unset "${!GIT_@}"

source "$ROOT/scripts/local-gates/workspace-packages.sh"
load_workspace_packages

# Prerequisite data (tool: install-hint). The presence loop keeps the rest of
# each line (including colons in URLs) as the hint, exactly as CI's install
# docs state.
PREREQ_TOOLS=(
  "uv: https://docs.astral.sh/uv/ — curl -LsSf https://astral.sh/uv/install.sh | sh"
  "pnpm: corepack enable, or npm install -g pnpm@10.33.2"
  "node: Node >= 24 required (nvm or Homebrew)"
  "ruby: system Ruby is sufficient"
  "atlas: must print a version (CI pins v0.30.0 through ariga/setup-atlas) — brew install ariga/tap/atlas"
  "pulumi: brew install pulumi/tap/pulumi"
  "docker: Docker Desktop/colima with the daemon running (fresh-schema + agent integration; the gate fails closed when it is unavailable)"
  "actionlint: brew install actionlint (CI pins v1.7.7)"
  "shellcheck: brew install shellcheck"
  "semgrep: uv tool install semgrep==1.172.0 (CI pins 1.172.0)"
  "git: required for the contract drift checks"
)

prereq_hint() {
  printf '%s\n' "${PREREQ_TOOLS[@]}" | sed -n "s/^$1://p"
}

check_node_version() {
  command -v node >/dev/null 2>&1 || return 0
  local version major
  version="$(node -v 2>/dev/null)"
  case "$version" in v[0-9]*.*|v[0-9]*) ;; *) printf 'prerequisite version mismatch: node %s\n' "$version" >&2; return 1 ;; esac
  major="${version#v}"; major="${major%%.*}"
  [ "${major:-0}" -lt 24 ] || return 0
  printf 'prerequisite version mismatch: node %s — %s\n' "$version" "$(prereq_hint node)" >&2
  return 1
}

check_atlas_version() {
  command -v atlas >/dev/null 2>&1 || return 0
  local version
  version="$(atlas version 2>/dev/null | head -n1)"
  [ -n "$version" ] && return 0
  printf 'prerequisite version mismatch: atlas produced no version — %s\n' "$(prereq_hint atlas)" >&2
  return 1
}
report_missing_prereqs() {
  local tool hint missing=0
  while IFS=: read -r tool hint; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      printf 'missing prerequisite: %s (%s)\n' "$tool" "$hint" >&2
      missing=1
    fi
  done <<< "$(printf '%s\n' "${PREREQ_TOOLS[@]}")"
  [ "$missing" -eq 0 ]
}

fail_prereqs() {
  printf 'install the missing prerequisites, then retry the push.\n' >&2
  exit 1
}

check_prereqs() {
  local missing=0
  report_missing_prereqs || missing=1
  check_node_version || missing=1
  check_atlas_version || missing=1
  [ "$missing" -eq 0 ] || fail_prereqs
}

run() {
  printf '\n==> %s\n' "$*"
  [ -n "${GATE_TEST_LOG:-}" ] && printf '%s :: %s\n' "$PWD" "$*" >> "$GATE_TEST_LOG"
  "$@"
}

gate() {
  local dir="$1"; shift
  printf '\n==> [%s] %s\n' "$dir" "$*"
  (cd "$dir" && "$@")
}
# Routing state: bound by init_route, consumed by route_has / route_includes.
changed=""
ALL=false

# route_has: raw membership of "$1" in the route string — no `all` expansion.
route_has() {
  printf '%s\n' "$changed" | grep -qx "$1"
}

# route_includes: does the route require "$1" (a package)? The `all` route
# short-circuits to yes for every package.
route_includes() {
  [ "$ALL" = true ] || route_has "$1"
}

# init_route: bind the routing state for one run from the route argument.
# The `if` form keeps this function returning 0 for any route (set -e safe).
init_route() {
  changed="$1"
  ALL=false
  if route_includes all; then ALL=true; fi
}

# run_pre_push: the full gate orchestration for one package set. $1 is the
# route (one package per line; `all` = every package). The real entry passes
# the canonical router's output; the test driver injects a fixed route.
run_pre_push() {
  init_route "$1"
  check_prereqs
  setup_gate_env
  run bash scripts/local-gates/quality.sh
  run_package_gates
  run_scripts_self_tests
  finish_gate "$changed"
}

# setup_gate_env: a unique scratch dir for build dry-runs; cleaned on exit.
# The dir is ALWAYS created here (mktemp -d) — an inherited GATE_OUTDIR is
# never used and never deleted, so the gate cannot rm -rf a directory it does
# not own.
setup_gate_env() {
  GATE_OUTDIR="$(mktemp -d)"
  trap 'rm -rf "${GATE_OUTDIR:-}"' EXIT
}
# finish_gate: the pass banner (the behavioral tests assert its exact format).
finish_gate() {
  printf '\npre-push gate: deterministic set for [%s] passed.\n' "${1//$'\n'/,}"
}

# ── agent: pr-verification affected-lane order. env -u strips live/BYO selectors so an
# exported TEST_DB can never route this gate to Neon (Docker arm only).
gate_agent() {
  gate apps/agent uv run ruff check
  gate apps/agent uv run ruff format --check src/animichi/
  gate apps/agent uv run mypy src/animichi/agents/ src/animichi/interfaces/ src/animichi/domain/ src/animichi/infrastructure/ src/animichi/clients/
  gate apps/agent uv run vulture src/animichi/ vulture_whitelist.py
  gate apps/agent uv run pytest src/animichi/tests/unit/ -v --cov --cov-report=xml:coverage-unit.xml
  gate apps/agent env -u TEST_DB -u TEST_DATABASE_URL -u TEST_DB_ALLOW_MUTATION -u NEON_API_KEY -u NEON_PROJECT_ID -u NEON_ENDPOINT_SUFFIX uv run pytest src/animichi/tests/integration/ -v --cov --cov-report=xml:coverage-integration.xml --cov-fail-under=0
  run docker build -f apps/agent/Dockerfile -t animichi-agent:ci .
}

# ── web (AC4): CI lint + coverage-enabled test + build/output-layout
# integration test with the showcase guard CI sets.
gate_web() {
  gate apps/web pnpm --filter web typecheck
  gate apps/web pnpm --filter web run lint:oxlint
  gate apps/web pnpm --filter web test
  gate apps/web env VITE_SHOWCASE_MODE=false pnpm --filter web test:integration
}

# ── catalog (AC4): CI lint, coverage test, bundled-boot smoke, and the
# deploy-path dry-run (the build stage's hermetic proxy).
gate_catalog() {
  gate workers/catalog pnpm exec tsc --noEmit
  gate workers/catalog pnpm run lint:oxlint
  gate workers/catalog pnpm run test:worker
  gate workers/catalog pnpm run test:spike
  gate workers/catalog pnpm run test:smoke
  gate workers/catalog pnpm exec wrangler deploy --dry-run --env= --outdir "$GATE_OUTDIR/catalog-bundle"
}

# ── users (AC4): CI lint, coverage test, deploy-path dry-run.
gate_users() {
  gate workers/users pnpm exec tsc --noEmit
  gate workers/users pnpm run lint:oxlint
  gate workers/users pnpm run test:worker
  gate workers/users pnpm exec wrangler deploy --dry-run --env= --outdir "$GATE_OUTDIR/users-bundle"
}

# ── edge (AC4): CI lint + the package's own `test` chain (node:test, the
# contract's chat-answer-part projection, the bundler smoke gate and the
# rate-limit namespace check — #1358 hung all four on the package script, and
# `.github/scripts/test_package_test_segments.rb` keeps them there) +
# production-config dry-run from the repo root. The agent-tier database arm
# (`pnpm run test:agent-db`, W1-2 #1251) is deliberately NOT in the chain: it
# needs the offline Postgres image, which this gate does not build. Run it
# before pushing edge agent-tier changes; see workers/edge/agent-db-test/README.md.
gate_edge() {
  gate workers/edge pnpm run lint:oxlint
  run pnpm run test:worker
  run pnpm exec wrangler deploy -c workers/edge/wrangler.toml --dry-run -e production --outdir "$GATE_OUTDIR/edge-bundle"
}

# ── migrator: pr-verification affected lane (contract consumer).
source "$ROOT/scripts/local-gates/pre-push-worker-gates.sh"

# ── e2e: deterministic static gates only; Playwright stays in CI.
gate_e2e() {
  gate e2e pnpm typecheck
  gate e2e pnpm run lint:oxlint
}

# ── contract: lint + the package's own `test` (unit suite, the published-
# document compat baseline and the OpenAPI drift check, all chained inside the
# script since #1358) + agent-model drift vs HEAD, which no package script
# covers (a staged correction must not mask committed drift).
gate_contract() {
  gate packages/contract pnpm exec tsc --noEmit
  gate packages/contract pnpm run test
  gate packages/contract pnpm emit:agent-python
  run git diff --exit-code HEAD -- apps/agent/src/animichi/interfaces/boundary/agent_models.py
}

# ── eval (#1299): typecheck + the package's own `test`, which is the Python→TS
# dataset round trip followed by the fixture drift check (#1358 chained them).
# The drift arm re-runs the Python exporter, so this gate needs uv (a declared
# pre-push prerequisite) as well as the TS toolchain.
gate_eval() {
  gate packages/eval pnpm exec tsc --noEmit
  gate packages/eval pnpm run lint:oxlint
  run pnpm run test:eval
}

# ── test-postgres (#1326): typecheck + lint + the Docker-free unit suite. The
# arms it serves (catalog spike, edge agent-db, db-fresh-schema) bring their own
# containers in their own gates; nothing here needs a daemon.
gate_test-postgres() {
  gate packages/test-postgres pnpm exec tsc --noEmit
  gate packages/test-postgres pnpm run lint:oxlint
  gate packages/test-postgres pnpm run test
}

# ── infra: typecheck + the package's own `test`, which runs the topology
# suite and then the credential-free Pulumi program-load (#1358).
gate_infra() {
  gate infra pnpm run typecheck
  gate infra pnpm test
}

# ── db: atlas validate + migration-boundary guard + disposable fresh-schema.
gate_db() {
  run atlas migrate validate --dir file://migrations/neon
  run node --test workers/edge/test/migration-boundary.test.ts
  gate apps/agent uv run sqlfluff lint ../../migrations/neon --dialect postgres --config ../../db/.sqlfluff
  run bash scripts/local-gates/db-fresh-schema.sh
}

# ── docs: the docs/CI consistency subset (full doc suite is with agent unit).
gate_docs() {
  gate apps/agent uv run pytest src/animichi/tests/unit/test_secrets_docs_consistency.py src/animichi/tests/unit/test_documentation_guardrails.py -q --no-cov
}

# Workspace names from pnpm-workspace.yaml; db/docs are path buckets.
BUCKET_GATE_PACKAGES="db docs"

run_package_gates() {
  local pkg
  for pkg in $WORKSPACE_NAMES $BUCKET_GATE_PACKAGES; do
    if route_includes "$pkg"; then "gate_$pkg"; fi
  done
}

# Self-testing orchestration surface (AC5).
SCRIPT_SUITE=(
  pre-push.test.sh
  changed-packages.test.sh
  db-fresh-schema.test.sh
  infra-check.test.sh
  infra-check-unauthorized.test.sh
  commit-message.test.sh
  pre-commit-config.test.sh
  contract-drift.test.sh
  eval-fixture-drift.test.sh
  why-blocked.test.sh
)

run_full_scripts_suite() {
  local f
  for f in "${SCRIPT_SUITE[@]}"; do
    run bash "scripts/local-gates/$f"
  done
}

# Explicit `scripts` → full suite. `all` still runs pre-commit-config.test.sh
# (route_has, never all-expansion — nesting pre-push.test.sh would recurse).
run_scripts_self_tests() {
  if route_has scripts; then
    run_full_scripts_suite
  elif route_has all; then
    run bash scripts/local-gates/pre-commit-config.test.sh
  fi
}

# Real hook entry: the canonical router is the only route source. Sourcing this
# file (the test driver's route-injection seam) skips this guard.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  changed="$(bash scripts/local-gates/changed-packages.sh)"
  run_pre_push "$changed"
fi
