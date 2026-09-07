# Local Gates — three hook stages over the affected packages

CI is the terminal gate; the local gates exist so a red push is the exception. What they gate is
decided by the changed files alone, and what they run for a package is that package's own
`package.json` scripts — the same scripts CI's affected matrix runs. There is no second gate
definition to drift from, so nothing has to prove local and CI agree (#1371).

## Principles

1. **The changed files decide.** pre-commit reads the **staged** diff; pre-push reads
   **merge-base-to-head**. Only what changed is gated.
2. **A package's gates are its own scripts.** `lint`, `typecheck`, `test`, `test:integration` in that
   package's `package.json` (#1358). Coverage floors, drift checks and Docker arms live inside them,
   so the hook never carries a weaker copy.
3. **Fail closed on the unknown.** A changed path that maps to no package, no bucket and no
   whitelist entry fails the push and is named in the output. Silence is never the answer.
4. **No suppressions.** Fix the failing gate or triage it explicitly; `--no-verify` is a policy
   violation (CI still enforces).
5. **No cloud mutation, no local deploy.** No hook runs a mutating `pulumi up/destroy`,
   `wrangler deploy` (only `--dry-run`, inside a package's own script), or `atlas migrate apply`
   outside a disposable local container.

Install all three stages from the repository root:

```bash
pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
```

## pre-commit (universal + staged packages, <10s)

- `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-toml`
- `check-executables-have-shebangs` + `check-shebang-scripts-are-executable` — the two halves of the
  shebang/exec-bit agreement, upstream's implementation of what a local script used to hand-roll
- `gitleaks` (secret scan)
- `shellcheck --severity=warning` over **every** shell file in the repository
- `actionlint` over `.github/workflows/*.{yml,yaml}`
- `ruff --fix` + `ruff-format` over all repository Python
- `semgrep` over the repository's own six ORM-boundary rules (`.semgrep/`)
- `oxlint --type-aware --deny-warnings` for the staged workspace packages, dispatched by
  `scripts/local-gates/oxlint-changed.sh`

## commit-msg (history hygiene, sub-second)

`commitlint` against `commitlint.config.js` — the one validator. CI's `commits` job runs the same
file over the pull request's commits and over its title (GitHub uses the PR title as the squashed
subject on `main`), so a subject that passes locally passes there. It rejects unknown types and
scopes, subjects over 72 characters, generic outcomes (`wip`, `checkpoint`, `update`, …), a subject
that starts with anything but a lowercase verb, an issue reference in the subject, and
Claude/Anthropic/Codex/OpenAI `Co-Authored-By` or `Generated with` trailers. Legitimate human and
Dependabot co-authors survive, and `Merge …` / `Revert "…"` subjects are exempt.

## pre-push (`scripts/local-gates/pre-push-affected.sh`)

One hook, 68 lines — over the ≤40 the card asked for, and the reason is written into the script:
reading the pushed refs (below) and checking every path for an owner both take real code, and
shrinking them back would mean deleting a guard rather than tightening one.

**What is gated is `HEAD`'s diff, and the pushed refs are read to prove that is the right thing to
gate.** git hands a pre-push hook one `<local ref> <local sha> <remote ref> <remote sha>` record per
ref on stdin. The script reads those records, skips deletions (a zero local sha), and refuses any
whose local sha is not `HEAD`:

```text
pre-push: refs must be pushed from their own worktree (HEAD is <sha>, pushing <ref>@<sha>)
```

Gating such a push would be theatre: the changed paths would come from the pushed ref while
`pnpm ls` and every package script ran against the checked-out tree, so a broken change could pass
on another branch's green. Running the pushed ref's own suites would mean checking it out, which a
push hook has no business doing. This repository is one worktree per card, so `git push` from the
worktree that owns the branch — which is the only way anyone works here — never meets the rule.
Push `other` by checking `other` out.

`HEAD`'s diff is taken against its merge base with `origin/main`, or against the remote sha when
that is already an ancestor of `HEAD`, which narrows it to what the remote has not seen.

pre-commit's pre-push wrapper consumes that stdin itself and re-exports the first pushable record
as `PRE_COMMIT_TO_REF` / `PRE_COMMIT_FROM_REF` (`pre_commit/commands/hook_impl.py`,
`_pre_push_ns`), so the script reads stdin when it is given any and falls back to those variables —
which is what keeps the refusal working under the wrapper too. For an ordinary push both name
`HEAD` and nothing is refused.

`pnpm ls -r --depth -1 --json` lists the workspace project directories; a prefix join against the
changed paths gives the package set. The root project and `@animichi/agent` are dropped — the first
would match every file by directory containment, the second is the agent bucket's job. Each selected
package then runs, through `pnpm -r --filter "...<name>" run --if-present`:

```text
lint → typecheck → test → test:integration
```

`...<name>` pulls in that package's dependents, so a `packages/contract` change gates its consumers.
`--no-renames` lists both sides of a rename, so a cross-package move gates the source package too.

### Why the selection is git's and not pnpm's

pnpm has this exact selector — `--filter "...[<ref>]"` — and CI uses it. Locally we cannot: from a
linked git worktree **nested inside the repository** (`.worktrees/<card>/`, where every card is
developed) pnpm 10.33.2 answers `No projects matched the filters` and exits 0. `getChangedProjects`
resolves the repository root with `find.dir('.git')`, which walks up and finds the *parent* repo's
`.git` directory before the worktree's own `.git` file, so the changed paths are joined onto the
wrong repository root and match no project. Upstream issue: <https://github.com/pnpm/pnpm/issues/12626> (open).
Handing selection to pnpm here would be fail-open — a silent no-op gate — which is why the join is
done against `pnpm ls` output instead.

### The four buckets

Paths outside every pnpm project would otherwise be invisible to the join:

| Changed path | Bucket |
|---|---|
| `apps/agent/**` or `packages/contract/**` | `make check` — ruff + ruff-format + vulture, mypy, the unit suite under the canonical 87 floor (`apps/agent/pyproject.toml` `addopts`), and the offline Docker-arm integration suite. This is the one Docker use the hook itself makes. `packages/contract` is here because the agent consumes the contract and CI's `agent` job is routed the same way (#1323). |
| `migrations/neon/**` | `atlas migrate validate --dir file://migrations/neon` — no container. The disposable fresh-schema apply lives in CI's `db` job and in `make check-full`. |
| `docs/**`, `.claude/**`, root-level `*.md` | `check-agents-refs.sh`, `check-docs-paths.sh`, `check-root-allowlist.sh` — the same three the CI `docs` job runs. |
| `pnpm-lock.yaml`, root `package.json`, `pnpm-workspace.yaml`, `.npmrc` | Every workspace package. A root dependency change belongs to no project directory, and pnpm answers it with the root project alone — `...` adds none of its dependents — so "affected" has to mean everything. CI's `plan` job routes it the same way, through its `deps` paths-filter, and like CI's matrix this path drops the `...` closure: with every package already selected, the prefix would only re-run each one's dependents once per selected package. |

### The whitelist, and failing closed

Paths that need no package gate, because another hook or a CI job already owns them:

```text
docs/**  .claude/**  .github/**  .semgrep*  scripts/**
root-level *.md  codecov.yml  .pre-commit-config.yaml  commitlint.config.js  Makefile
```

**Every** changed path has to be owned by something: a selected package's directory, a bucket that
actually fired, or the whitelist. Whatever is left over stops the push and is listed by name. The
check runs on the whole diff rather than only when nothing was selected — otherwise a commit that
touched `workers/catalog/src/` *and* added a stray top-level file would sail through on the strength
of its first half, which is exactly what it did until #1371's review caught it.

A new top-level directory, a new tool config: both stop the push with their own names in the
message rather than passing unexamined. The fix is to give the path a home — a package, a bucket,
or a reviewed whitelist entry — not to widen the pattern reflexively. (`commitlint.config.js` is on
the whitelist because turning this check on found it owned by nothing at all.)

The ownership set is built from what actually happened, so it also backstops the selection itself.
Each bucket adds its own paths only when it fired, and each selected package adds its directory, so
breaking the prefix join or deleting a bucket leaves the paths they used to own unaccounted and the
push goes red naming them. That is also why the loop skips a blank project line: an empty `pnpm ls`
result still yields one, and without the guard it would match every file and fill the package set
with nothing.

## `make check-full` (manual, not a hook)

The everything-run, for a large refactor or when a lockfile change makes "affected" mean everything:

```text
pnpm -r run --if-present lint | typecheck                 parallel
pnpm -r --workspace-concurrency=1 run --if-present test | test:integration
scripts/local-gates/db-fresh-schema.sh        disposable fresh-schema apply (Docker)
pnpm --filter catalog run test:spike          the catalog spike against test-postgres
make check                                    the Python agent's own gate
```

The two suite segments run one package at a time on purpose. pnpm's default is one job per CPU, and
several packages' `test` claims a fixed resource — the browser suite serves `apps/web` on `:8799`,
and the container-backed suites each boot test-postgres. In parallel they starve each other: nine
browser specs failed with `ERR_CONNECTION_REFUSED` while the same suite passed 43/43 on its own
(2026-09-08).

## What stays in CI

- **Playwright browser e2e** (`make e2e`, the `animichi-e2e` package) — CI's `e2e` job owns it.
- **Live-Neon integration** (`TEST_DB=neon`) and BYO mutation databases — real data planes; a manual
  local option only, and not a CI lane either since #1053.
- **Model-backed evals** (`make test-eval`) — paid, non-deterministic.
- **Deploys and cloud commands** — `wrangler deploy`, mutating `pulumi`, codecov upload, `gh pr`.
- **The repository contracts** (`.github/scripts/test_*.rb`) and the gate scripts' own behavioral
  tests — CI's `contracts` job runs them unconditionally, on every pull request, so pre-push does
  not need a copy. `test_ci_workflow_contract.rb` asserts that every committed check under
  `scripts/` and `.github/scripts/` is named by some job, which is what keeps that list honest.

## Prerequisites

`git`, `pnpm`, `node` ≥ 24, `jq`, `uv` (agent bucket), `atlas` v0.30.0 (migrations bucket), `docker`
with the offline `animichi-test-postgres` image (agent bucket and any package whose `test` boots it),
plus the pre-commit tools: `shellcheck`, `actionlint`, `semgrep` 1.172.0, `ruby` for the contracts.

## Failure handling

- pre-commit: fix in the working tree and re-run — the fixer hooks modify files, so re-stage.
- pre-push: fix it. When the failure is environmental (no Docker daemon, no `atlas`), say so in the
  push and repair it; do not reach for `--no-verify`.
- "no gate covers these files": read the list. Each name is a path the repository has no opinion
  about yet.

## Files

- `scripts/local-gates/pre-push-affected.sh` — the pre-push gate
- `scripts/local-gates/oxlint-changed.sh` — pre-commit oxlint dispatch (staged)
- `scripts/local-gates/check-agents-refs.sh` / `check-docs-paths.sh` / `check-root-allowlist.sh` —
  the documentation hygiene checks, shared with CI's `docs` job
- `scripts/local-gates/db-fresh-schema.sh` — disposable fresh-schema apply (CI's `db` job,
  `make check-full`)
- `scripts/local-gates/infra-check.sh` — credential-free Pulumi program load (`infra`'s own `test`)
- `scripts/local-gates/contract-drift.sh` — staged-snapshot OpenAPI drift (`@animichi/contract`'s
  own `test`)
- `scripts/local-gates/eval-fixture-drift.sh` — staged-snapshot eval-fixture drift (`@animichi/eval`'s
  own `test`)
- `scripts/local-gates/*.test.sh` + `stub-env.sh` + `test-stub.sh` — those scripts' behavioral tests
  and the stub harness they share; CI's `contracts` job runs them
- `commitlint.config.js` — the commit-message and PR-title rules
- `.pre-commit-config.yaml` — hook wiring for all three stages
- This document — the contract
