# packages/test-postgres — AGENTS.md

The one disposable PostgreSQL + PostGIS + pgvector data plane every database-backed suite boots
(#1326). Plain **Node** package, and **test-only**: it depends on `testcontainers` and `pg`, neither
of which runs on workerd, so it is a devDependency of its consumers and never a dependency.
Root guide: `../../AGENTS.md`.

Before it existed the same recipe — the image tag, the clean database from `template1`, the Atlas
chain apply — was written three times, in three languages, and #1324 fixed the startup race in only
one of them. What each arm keeps is its own database name and its own budget; everything else is
here.

## Commands (from `packages/test-postgres/`)

- `pnpm run test` — `node --test` over `test/*.test.ts` (Node's native TS type stripping; no bundler,
  no Docker, no clock).
- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- `pnpm run lint:oxlint` — type-aware oxlint, warnings denied.
- Pre-push runs all three when a changed file lands in this package
  (`scripts/local-gates/pre-push-affected.sh`), which is also how CI's affected matrix runs them.

There is no Docker suite here. The arms that boot the container prove it in their own gates:
`pnpm --filter catalog run test:spike` and `pnpm --filter edge-worker run test:agent-db`.

## The API

| Export | Is |
|---|---|
| `startTestPostgres({ database, budget })` | the whole recipe: boot → wait → clean database → Atlas chain → `{ dsn, stop }` |
| `SetupBudget` · `SPIKE_SETUP_BUDGET` · `AGENT_DB_SETUP_BUDGET` · `hookTimeoutMs` | the wall-clock allowance one arm may spend, one instance per arm |
| `SetupDeadline` | what is LEFT of that allowance, and what a phase may spend of it (#1318) |
| `OFFLINE_POSTGRES_IMAGE` | the image tag, read from `postgres-image.env` |
| `PostgresStartupWait` · `StartupWaitLimits` · `isStartingUp` · `Pause` | the bounded first-session probe (#1324) |
| `createCleanDatabase` · `applyAtlasChain` | the two steps, for an arm that needs them apart |
| `POSTGRES_USER` · `POSTGRES_PASSWORD` | the container's credentials, for building a second DSN |

`src/setup-budget.ts`, `src/setup-deadline.ts`, `src/postgres-image.ts` and
`src/postgres-startup-wait.ts` are also reachable as subpath exports, so a consumer that only wants
a number does not load `testcontainers` to get it.

## One deadline, two ceilings (`src/setup-budget.ts`, `src/setup-deadline.ts`)

The phases that can hang — the port bind and the two connection waits — share **one wall-clock
deadline**, they do not each get a timeout. Three independent timeouts was the bug #1318 found:
240 s for the bind plus 60 s per wait is 360 s inside a 300 s hook, so a slow boot killed the lane
instead of failing the phase that overran. `SetupDeadline` is what enforces that — the bind is
offered `remainingMs()`, and each wait converts what survives into attempts.

`SetupBudget` is the allowance; the two arms differ in exactly one number, and deliberately:

| | catalog spike | edge agent-db |
|---|---|---|
| containers | one, for the whole suite | one **per file**, run serially |
| `deadlineMs` | 240 s | 240 s |
| `firstSession` | 30 × 1 s | 60 × 1 s (may queue behind another boot) |
| `chainMarginMs` | 60 s | 60 s |
| `hookTimeoutMs(budget)` | 300 s (unused — see below) | 300 s = `SETUP_HOOK_TIMEOUT_MS` |

240 s because the published image is `linux/amd64`: on an arm64 host initdb runs emulated (~62 s
measured) and crosses testcontainers' own 60 s default on a container that is fine.

**The catalog arm has no runner-imposed hook deadline at all.** vitest's `hookTimeout` governs
in-file `beforeAll`/`afterAll`, not `globalSetup`: `_initializeGlobalSetup()` in vitest 4.1.10
simply `await`s the setup with no timeout wrapper (checked in `node_modules/vitest`, not assumed).
So `vitest.spike.config.ts`'s `hookTimeout` is unrelated to the data plane, and `deadlineMs` is the
spike suite's only bound. Do not wire one to the other.

`test/setup-budget.test.ts` pins every number and checks the edge arm still derives
`SETUP_DEADLINE_MS` / `SETUP_HOOK_TIMEOUT_MS` from the budget; `test/setup-deadline.test.ts` is
#1318's own arithmetic, on a fake clock.

## The image tag has one declaration (`postgres-image.env`)

Three consumers resolve it and they do not share a language, so the tag lives in a file both can
read: `src/postgres-image.ts` parses it, `scripts/local-gates/db-fresh-schema.sh` sources it as
bash. `test/image-tag-contract.test.ts` resolves it **both ways** — it runs the shell read rather
than reading the shell — and then checks that no consumer kept a tag of its own to drift with.

Building the image is the one step that needs network, and it is the fourth consumer
(`.github/workflows/pr-verification.yml`). A workflow `run:` sources the declaration like any other
shell, so that step names no tag either:

```bash
. packages/test-postgres/postgres-image.env
docker build -f apps/agent/docker/test-postgres/Dockerfile -t "$TEST_POSTGRES_IMAGE" .
```

`test/image-tag-contract.test.ts` does **not** read the workflow (card B2 / #1360): pipeline text
belongs to `.github/test/pr-verification-affected.test.rb`, which reads `postgres-image.env` itself
and fails any build step that neither sources it nor names the tag it declares.

## Pitfalls

- **Node's type stripping, not a bundler.** `workers/edge`'s lane loads this package through
  `node --test`, which strips types rather than compiling them: no constructor parameter properties,
  no enums, no namespaces, and intra-package imports carry the `.ts` extension.
- **The startup wait never swallows a failure that is not a startup symptom.** It retries `57P03`,
  `ECONNREFUSED` and `ECONNRESET`; anything else — a wrong password, a missing database — rethrows on
  the first attempt. The pre-#1326 edge fixture retried everything for 60 s and then reported a
  generic timeout; that is the behaviour that changed, on purpose.
- **Atlas is never applied to the image's own database.** The postgis image pre-initialises it with
  the tiger/topology schemas, which the chain's clean-check refuses. Every arm gets a database
  created from pristine `template1` — the same rule as `apps/agent`'s `conftest_db.py`.
- **`startTestPostgres` stops the container on any failure after `.start()`**, so a red gate run
  leaves nothing behind. Do not add a code path that returns a plane without that guarantee.
- **Never bundled.** `test/never-bundled.test.ts` scans both consumers' `src/` trees for all four
  module-load shapes. A `bundle-smoke`-style gate would prove nothing — the package is never in a
  bundle to smoke.
