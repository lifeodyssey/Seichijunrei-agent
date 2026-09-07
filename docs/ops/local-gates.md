# Local Gates Design — changed-package routing (monorepo)

Campaign lesson: code repeatedly reached CI that local gates should have caught (ruff format in `scripts/*.py`, SC2086 ×2, edge lint, TS typecheck, stale `atlas.sum`, Pulumi loader/compiler incompatibility). CI remains the terminal gate; local gates make a red push the exception. `#1003` made pre-push fail closed for every deterministic CI check that can run locally.

## Principles

1. **Changed-package routing** — pre-commit reads the **staged** diff; pre-push reads **merge-base-to-head**. Only the affected packages' gates run. Full-repo runs are reserved for the few sub-second checks.
2. **Three hook stages**: pre-commit (seconds — formatting/lint/syntax/secrets), commit-msg (sub-second history policy), and pre-push (minutes — deterministic Quality lane + each affected package's CI-equivalent gates). One pre-push orchestration surface: `scripts/local-gates/pre-push.sh`.
3. **No suppressions**: a failing gate must be fixed or explicitly triaged; `--no-verify` is documented as a policy violation (CI still enforces).
4. **Sourcery is not a local hook**: PR review via the GitHub App (installed).
5. **No cloud mutation, no local deploy**: no hook runs a mutating `pulumi up/destroy`, `wrangler deploy` (only `--dry-run`), or `atlas migrate apply` outside a disposable local container (`db-fresh-schema.sh` targets `127.0.0.1` only).

## Package map (diff path → gate set)

Workspace members are **derived** from `pnpm-workspace.yaml` (directories matching the globs that contain `package.json`; route name = directory basename). Path buckets (`db`, `ci`, `scripts`, `docs`) stay explicit — they are not workspace packages. A new workspace package without a `gate_<name>` in `pre-push.sh` fails `changed-packages.test.sh` immediately.

| Path prefix | Package | pre-commit lint | pre-push orchestrator gate set |
|---|---|---|---|
| `apps/agent/` | agent | ruff + ruff-format (py) | `ruff check` + `ruff format --check src/animichi/` + mypy + `vulture src/animichi/ vulture_whitelist.py` + unit `pytest --cov` (canonical 87 floor, below) + offline Docker-arm integration `pytest .../integration --no-cov` + `docker build -f apps/agent/Dockerfile -t animichi-agent:ci .` (single CI affected-agent order) |
| `apps/web/` | web | oxlint (type-aware) | `typecheck` + `lint:oxlint` + coverage-enabled `test` + `VITE_SHOWCASE_MODE=false test:integration` |
| `workers/catalog/` | catalog | oxlint | `tsc --noEmit` + `lint:oxlint` + `test:worker` + `test:spike` + `test:smoke` + `wrangler deploy --dry-run` |
| `workers/users/` | users | oxlint | `tsc --noEmit` + `lint:oxlint` + `test:worker` + `wrangler deploy --dry-run` |
| `workers/edge/` | edge | oxlint | `lint:oxlint` + the package's own `test` (node:test suite, the contract projection conformance test, `test:bundle-smoke` — which bundles the pi kernel entrypoint and executes the artifact in workerd, #1246 — and `workers/edge/scripts/check-edge-ratelimit-namespace.sh`; the repo root reaches the same script as `pnpm run test:worker`) + production-config `wrangler deploy --dry-run` |
| `workers/migrator/` | migrator | oxlint | `tsc --noEmit` + `lint:oxlint` + `test` + `wrangler deploy --dry-run` (single CI affected-migrator lane) |
| `packages/contract/` | contract | oxlint | `tsc --noEmit` + `lint:oxlint` + `test` (vitest, the merge-base compat gate `vet:baseline`, and the staged-snapshot OpenAPI drift check `contract-drift.sh`) + agent-model regeneration drift |
| `packages/eval/` | eval | oxlint | `tsc --noEmit` + `lint:oxlint` + `test` (the Python→TS dataset round trip, then `test:fixture-drift` — the Python re-export plus `eval-fixture-drift.sh`) |
| `packages/test-postgres/` | test-postgres | oxlint | `tsc --noEmit` + `lint:oxlint` + `test` (Docker-free: the startup wait, the two setup budgets, the image-tag contract) |
| `infra/` | infra | — | `typecheck` + `test` (topology tests, then the credential-free Pulumi program load `infra-check.sh`) |
| `e2e/` | e2e | oxlint | strict TypeScript typecheck + type-aware oxlint (Playwright stays in CI; an e2e-only change is not `all`) |
| `migrations/` | db | — | `atlas migrate validate` + migration-boundary guard + sqlfluff + disposable fresh-schema apply (`db-fresh-schema.sh`) |
| `.github/` | ci | actionlint (workflows) | Static-quality lane (pinned actions + workflow/component-manifest invariants + docs/root-allowlist/e2e-promotion guards + coverage-patch policy + actionlint) |
| `scripts/`, `.github/scripts/` | scripts | shellcheck (shell) + ruff (py) | the gates' own behavioral tests (self-testing orchestration surface) |
| `docs/` | docs | — | doc-consistency subset (`test_secrets_docs_consistency.py` + `test_documentation_guardrails.py`) |
| anything else / unknown | — | — | `all`: every package's full gate set (conservative fallback) |

`packages/contract` is treated as changed whenever any of its consumers changed (contract is the cross-service source of truth) — the router unions: changed packages ∪ {contract if any agent/web/catalog/users/edge/migrator changed}.

Install all three tracked stages from the repository root:

```bash
pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
```

## Changed-package detection

```text
scripts/local-gates/changed-packages.sh
  --staged (pre-commit):  git diff --cached --name-only --no-renames
                          + git ls-files --others (intentional untracked inputs)
  default  (pre-push):    git diff --name-only --no-renames $base...HEAD
                          base = origin/main (or HEAD^ when origin is absent);
                          untracked files are NOT folded in — pre-push validates
                          what would actually be pushed
```

`--no-renames` lists both the old and the new path of a rename so both sides' packages gate (a cross-package move must not hide the source package's deletion). Output: one package per line; `all` when any path maps to no package; empty set → only universal checks. The pre-push hook **never** accepts a route override: `pre-push.sh` routes exclusively via this router, so `GATE_CHANGED_PACKAGES=web git push` cannot shrink the route and skip agent/db/infra gates. The behavioral tests inject routes only through the dedicated test driver `scripts/local-gates/pre-push-test-driver.sh` — the sole route seam (it sources `pre-push.sh`, which guards its real entry, and calls `run_pre_push` with a fixed route). `pre-push.test.sh` drives every routing case through the driver and asserts the real entry ignores the old override variable.

## pre-commit (universal + changed packages, <10s)

Universal (always, sub-second):
- trailing-whitespace, end-of-file-fixer, check-yaml, check-toml
- gitleaks (secret scan)
- shellcheck (on `scripts/` + `.github/scripts/` shell files, `--severity=warning`)
- actionlint (on `.github/workflows/*.{yml,yaml}`)
- ruff `--fix` + `ruff format` (all repo Python — ruff is fast enough to run repo-wide)

Changed packages (routed via `changed-packages.sh --staged`):
- web/catalog/users/edge/migrator/contract/eval/test-postgres → `oxlint --type-aware --deny-warnings` scoped to the package

## commit-msg (history hygiene, sub-second)

`scripts/local-gates/commit-message.py` rejects malformed or generic subjects, subjects over 72
characters, and Claude/Anthropic/Codex/OpenAI attribution trailers or Claude Code generated footers.
It preserves legitimate human and Dependabot co-authors and ordinary prose that merely names a tool.
The validator's rules double as the PR squash-title rules, because GitHub uses that title as the
final main subject when the PR is squash-merged. GitHub already observes PR edits, so title changes
do not retrigger product CI or add a separate workflow or required check.

## pre-push (one orchestrator, `scripts/local-gates/pre-push.sh`)

`.pre-commit-config.yaml` wires a single pre-push hook that runs the orchestrator. It re-reads the router in merge-base-to-head mode, fails fast on the first failing gate (`set -euo pipefail`), and runs, in order:

1. **Deterministic quality lane (always)** — `scripts/local-gates/quality.sh`: the workflow meta-invariants and action-pinning check (`.github/scripts/test_workflow_invariants.rb`), the CI file's shape contract (`.github/scripts/test_ci_workflow_contract.rb`) and the three lane contracts beside it (`test_agent_lane_contract.rb`, `test_browser_lane_contract.rb`, `test_schema_lane_contract.rb` — each owns a job the affected matrix cannot see), the package lane-segment manifest (`.github/scripts/test_package_test_segments.rb`), the three CD contracts (`test_cd_shape_contract.rb`, `test_cd_publish_contract.rb`, `test_cd_credential_boundary_contract.rb`), the edge-naming contract (`test_edge_naming_contract.rb` — the gateway Worker's retired name may only appear in `.github`/`docs`/`infra`/`AGENTS.md` in a sense that is not the Worker, #1315), the gitleaks config contract, the documentation hygiene checks (`scripts/local-gates/check-agents-refs.sh`, `check-docs-paths.sh`, `check-root-allowlist.sh` — the same three the CI `docs` job runs), shellcheck and actionlint. The CI routing, aggregation and parity pins went with the pnpm-affected rewrite of `pr-verification.yml` (#1359): CI and pre-push now run the same package scripts, so nothing has to prove they agree.
2. **Per affected package** (see the table): agent runs ruff lint/format check, mypy, vulture, the coverage-enabled unit suite, the offline Docker-arm integration suite, and the container build (`docker build -f apps/agent/Dockerfile -t animichi-agent:ci .`); web runs its coverage test plus the showcase-mode-guarded integration test; workers run `tsc`/oxlint/test plus a `wrangler deploy --dry-run` production bundle; contract runs its `test` script, which carries the published-document compat baseline and the staged-snapshot OpenAPI drift check (`contract-drift.sh` mirrors CI's `git diff --cached` against a throwaway index, so user-staged work is preserved), plus the agent-model regeneration check; infra runs its `test` script, which ends in the credential-free Pulumi program-load check; db runs atlas validate plus a fresh-schema apply on a disposable container.
3. **scripts changed** → the gates' own behavioral tests (self-testing orchestration surface): an explicit `scripts` change runs the full suite (`pre-push.test.sh`, `changed-packages.test.sh`, `db-fresh-schema.test.sh`, `infra-check.test.sh`, `infra-check-unauthorized.test.sh`, `commit-message.test.sh`, `contract-drift.test.sh`, `pre-commit-config.test.sh`). The `all` fallback (root config, unknown paths) still runs the config contract self-test (`pre-commit-config.test.sh`), so a root-only `.pre-commit-config.yaml` change cannot skip it; the recursive `pre-push.test.sh` stays scoped to an explicit `scripts` change.

### Canonical coverage floor (agent 87)

The local gate never overrides a coverage floor. Agent runs `uv run pytest src/animichi/tests/unit/ -v --cov --cov-report=xml` and the canonical `--cov-fail-under=87` comes from `apps/agent/pyproject.toml` `addopts` (CI and the local gate share it). The old local `--cov-fail-under=82` override is gone — there is no local/CI coverage split anymore. TS suites run the coverage-enabled scripts CI enforces (`test`/`test:worker` carry `--coverage`).

### Fail-closed Docker gates

- **db fresh-schema** (`db-fresh-schema.sh`) is REQUIRED: it fails with an actionable message when Docker is not installed, when the daemon is not running, or when the offline `animichi-test-postgres:18-3.6-pgvector-0.8.5` image is missing (it prints the one-time `docker build` command). It never silently skips. The postgis image pre-initialises `POSTGRES_DB` (the `postgres` admin database) with the tiger/topology objects, so Atlas is never applied to that database: the gate waits for the admin database, creates the pristine target `gate` database from `template1` (the same clean-schema semantics as `conftest_db.py`), and applies Atlas only to that disposable `127.0.0.1` container.
- **agent integration** is invoked through `env -u TEST_DB -u TEST_DATABASE_URL -u TEST_DB_ALLOW_MUTATION -u NEON_API_KEY -u NEON_PROJECT_ID` (plus `NEON_ENDPOINT_SUFFIX`), so an exported live/BYO selector can never route the local gate to Neon or a mutable external database — the Docker arm is deterministic. It needs Docker + the cached `animichi-test-postgres:18-3.6-pgvector-0.8.5` image, and `conftest_db.py` fails closed with actionable guidance (install Docker Desktop or start colima; run the one-time build command) when either is missing. `TEST_DB=neon` (live Neon, personal `NEON_API_KEY`) is deliberately NOT a local-gate concern: it
is a manual local/dev option only, and since the test-infra retirement (#1053) it is no longer a
CI lane — CI's DB-backed integration lane runs hermetically (`TEST_DB=docker`).

### Credential-free Pulumi load

`infra-check.sh` loads the infra program through the real Pulumi language host against a throwaway `file://` backend — the same loader whose compiler-incompatibility failure (TS5096) reached CI while ordinary `tsc --noEmit` stayed green. The throwaway `preflight` stack sets exactly one config value: the documented non-secret placeholder `seichijunrei-infra:cloudflareAccountId = 00000000000000000000000000000000` (a clearly-fake stand-in for the id `config.require()` asks for — preview derives resource names locally and never contacts Cloudflare). No cloud state, no credentials, no `pulumi up`; the `Pulumi.preflight.yaml` the stack init writes is removed by the gate on exit.

Exit handling is fail-closed. A **zero preview exit is green**. A **nonzero preview exit is green only when the captured output proves the program loaded** (a rendered plan) **and every diagnostic is on the allowlist**. Diagnostic classification is strict, anchored, and case-insensitive: prefixes (`error:`, `Error:`, `TypeError:`, `warning:`, `info:`, …) are recognized case-insensitively, every diagnostic line must be allowlisted cloudflare credential/provider/config noise (`Missing API token for cloudflare`, current-user/auth lookup failures, `Unauthorized`) or config noise (`Missing required configuration variable`), and the preview must carry **at least one** allowlisted diagnostic — a rendered plan alone is not proof of health. Unknown plain-text lines (no recognized prefix), unknown diagnostics, and a rendered plan with no allowlisted diagnostic at all all fail closed with the captured output dumped. TypeScript/runtime/compiler/load errors (`TSError`, `TypeError`, `Unable to compile`, `SyntaxError`), `failed with an unhandled exception`, `Could not find entry point`, `Cannot find module` / `MODULE_NOT_FOUND`, unknown failures, and output without a rendered plan are always red. The preview exit code is captured explicitly; the gate never uses `|| true` to swallow a failure, so an arbitrary preview failure cannot turn the check green.

## Why browser e2e / live Neon / evals / deploys stay out of the local gates

The local gates cover every deterministic check that can run without mutating shared cloud infrastructure. These intentionally do **not** run locally:

- **Playwright browser e2e** (`make e2e`) — cross-stack browser automation.
- **Live-Neon integration** (`TEST_DB=neon`, needs a personal `NEON_API_KEY` + `NEON_PROJECT_ID`) and BYO mutation DBs (`TEST_DB_ALLOW_MUTATION=1`) — touching real data planes. Live Neon is a manual local option (not a CI lane since #1053); BYO mutation remains a local opt-in with the protected-lineage check.
- **Model-backed evals** (`make test-eval`) — paid, non-deterministic model calls.
- **Deploys / cloud commands** — `codecov` upload, `lighthouse`/`lhci`, `gh pr`, `wrangler secret`, mutating `pulumi`; the gate scripts are scanned to forbid them (see `test_no_forbidden_cloud_mutation_commands` in `pre-push.test.sh`).

## Prerequisites and durations

Prerequisites (checked up front by `pre-push.sh`; missing ones fail with an install hint): `uv`, `pnpm`, `node` ≥ 24, `ruby` (system), `atlas` (pinned v0.30.0), `pulumi`, `docker` (daemon running for fresh-schema + agent integration), `actionlint`, `shellcheck`, `semgrep` (CI pins 1.172.0; `uv tool install semgrep==1.172.0`), `git`.

Durations: pre-commit `<10s`; pre-push depends on the affected set — a single-package push is roughly 1–3 min, a full `all` push is many minutes (agent ruff/mypy/vulture + unit + coverage + offline Docker integration + container build, web coverage + integration, all worker suites, contract drift, fresh-schema apply). The first push that touches `db` or runs agent integration also needs the offline image built once (network required).

Environmental note: the full Quality lane SIGBUSes on the stock macOS `/bin/bash` 3.2 — `check-docs-paths.sh` corrupts the bash 3.2 heap on nested while-read loops fed by process substitutions (a known host baseline; CI runs a modern bash and is unaffected). Reported, not hidden; a newer bash (Homebrew) is the local remedy.

## Failure handling

- pre-commit failures: fix in working tree, re-run (auto-fix hooks modify files).
- pre-push failures: fix, or when the failure is environmental (e.g. Docker/atlas unavailable), document the exemption in the commit/push — policy: no silent `--no-verify`; CI still gates.
- Router bugs: unknown paths fall back to `all` (every package's full gate set — the conservative fallback).

## Files

- `scripts/local-gates/changed-packages.sh` — the router (`--staged` / merge-base modes)
- `scripts/local-gates/workspace-packages.sh` — workspace package derivation from `pnpm-workspace.yaml`
- `scripts/local-gates/oxlint-changed.sh` — pre-commit oxlint dispatch (derived; `--staged`)
- `scripts/local-gates/pre-push.sh` — the pre-push orchestrator (single surface; routes only via the router)
- `scripts/local-gates/pre-push-test-driver.sh` — the test-only route-injection seam (never wired into hooks)
- `scripts/local-gates/quality.sh` — the deterministic Quality lane
- `.github/scripts/test_workflow_invariants.rb` — workflow meta-invariants + action pinning (#1359)
- `.github/scripts/test_ci_workflow_contract.rb` — the CI file's affected-matrix shape, aggregates and file-wide invariants (#1359)
- `.github/scripts/test_agent_lane_contract.rb` / `test_browser_lane_contract.rb` / `test_schema_lane_contract.rb` — one per job outside the affected matrix (#1360 / #1362 / #1363, split out in #1364)
- `.github/scripts/test_cd_shape_contract.rb` / `test_cd_publish_contract.rb` / `test_cd_credential_boundary_contract.rb` — `cd.yml`'s job graph, how it publishes, and what it may hold (#1364)
- `.github/scripts/test_package_test_segments.rb` — the lane-segment manifest: which segments each package's `test` must chain (#1359)
- `scripts/local-gates/check-agents-refs.sh` / `check-docs-paths.sh` / `check-root-allowlist.sh` — the documentation hygiene checks the CI `docs` job runs
- `scripts/delivery/migrate-through-worker.sh` — the staging migration handshake `cd.yml` runs; shellchecked by the Quality lane (#1364)
- `scripts/local-gates/db-fresh-schema.sh` — disposable fresh-schema apply (fail-closed Docker; template1 pristine target)
- `scripts/local-gates/infra-check.sh` — credential-free Pulumi program-load
- `scripts/local-gates/contract-drift.sh` — staged-snapshot OpenAPI drift check (mirrors CI's `git diff --cached`)
- `scripts/local-gates/eval-fixture-drift.sh` — staged-snapshot eval-fixture drift check (re-runs `packages/eval/scripts/export-fixtures.sh`)
- `scripts/local-gates/commit-message.py` — shared commit-message and PR-title validator
- `.pre-commit-config.yaml` — hook wiring (pre-commit + commit-msg + one pre-push orchestrator hook)
- `scripts/local-gates/*.test.sh` + `stub-env.sh` + `test-stub.sh` — behavioral tests
- This document — the contract
