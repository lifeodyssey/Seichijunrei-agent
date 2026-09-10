# workers/migrator — AGENTS.md

TypeScript Cloudflare Worker: the **migration executor** (spec
`docs/specs/2026-08-16-migration-executor-spec.md`, issue #1051; Option 2
connectivity spec / #1124). A request authenticated by a GitHub Actions OIDC
token applies the committed Neon Atlas chain over neon-http and the sealed
Prisma graph through the official control client. It returns both owners'
applied markers. Both environments go through it since #1365
(#1055 closed): `[env.staging]` and `[env.production]` are separate Workers with
separate DSN secrets and separate OIDC allowlists. Root guide:
`../../AGENTS.md`.

## Commands (from `workers/migrator/`)

- pnpm. `pnpm run typecheck` (TypeScript 7.0.2) · `pnpm run lint:oxlint`
  (type-aware, strict, warnings denied) · `pnpm run test` / `pnpm run test:worker`
  (vitest + coverage). Never `wrangler deploy` locally (hook `block-local-deploy`).
- `pnpm run test:integration` runs authenticated HTTP and the actual bundled
  workerd entry against disposable PostgreSQL (including the fixed Durable Object),
  using `@animichi/test-postgres`, Docker and Atlas v0.30.0 (`ATLAS_BIN` may select the pinned binary).

## What this worker does

1. **Verify identity**: reads `Authorization: Bearer <github-oidc-token>`,
   verifies it with jose (RS256) against GitHub's JWKS (constructor-injected
   for tests), then enforces the per-environment-anchored claims allowlist
   (MED-2): staging = `ref == refs/heads/main` AND `environment == staging`;
   production = the same pair with `environment == production`, or the
   fully-qualified `sub == repo:lifeodyssey/animichi:environment:production`.
   The two are SEPARATE constants picked by the `MIGRATOR_OIDC_POLICY` var
   (default staging), never one merged array — `refAnchored` is
   `refAllow.some(...)`, so a merged array would let the staging job's token
   open the production door. Both also require
   repository == `lifeodyssey/animichi`, and
   `workflow_ref/job_workflow_ref` in the trusted deploy workflows. The
   audience is the fixed `animichi:github-actions:migrator` — specific to this
   door, so a GitHub OIDC token minted for anything else is rejected rather
   than cross-accepted. The reusable verifier lives in
   `packages/contract/src/oidc-github.ts` (`@animichi/contract/oidc-github`).
2. **Apply the chain over neon-http (#1124)**: after OIDC, a fixed-name
   Durable Object mutex (`migrator-apply-lock`, not `migrator-job-*`)
   serializes apply. The Worker executes committed `migrations/neon` files
   (compile-time Text modules + `atlas.sum` order) via
   `@neondatabase/serverless`, writes `public.atlas_schema_revisions` with
   Atlas v0.30 version/hash semantics (`operator_version =
   animichi-http-apply/0.30.0`), and skips already-applied versions. The
   revision row rides in the file's own transaction (#1338), so no crash can
   leave a file applied and its ledger row missing. `CREATE INDEX
   CONCURRENTLY` files cannot be transactional; on that path alone the window
   is inherent, so a duplicate-object error (`42P07`) is read as
   already-applied — but only for a version the ledger holds no attempt at
   under a different hash — and the re-run finishes the file instead of
   wedging the chain. A `-pooler` DSN is rejected before SQL. SQL is never taken from the
   request body (OIDC + optional `{expectedHead?}` only). The batch
   container classes stay until staging proof; `POST /migrate` no longer
   starts them. Tests may inject `runContainer` (including unknown_exit
   ledger judgment).
3. **Answer for the bundle it carries (#1365, closes #1332)**: `wrangler deploy`
   returning is not the new bundle serving, and the old bundle answering a POST
   would apply a chain the release never packaged. `GET /healthz` therefore
   reports `bundleHead` — the last head of the chain compiled into THIS
   deployment — and `POST /migrate` answers `409 {error:"stale_bundle",
   bundleHead}` to an `expectedHead` the carried chain cannot reach, before it
   resolves a DSN. `scripts/delivery/migrate-through-worker.sh` polls the first
   and retries the second, bounded (over https only — curl refuses any lesser
   transport, redirects included, for calls that carry the OIDC token).
   That same `expectedHead` also BOUNDS the apply (`src/requested-chain.ts`):
   the carried chain is truncated after the file that leaves that head in the
   ledger, so a request for an earlier head applies up to it and leaves the
   rest pending — before this, an `A` request against an `A→B` bundle advanced
   the database to `B` and only then failed the head check. A request the
   ledger already stands past is refused `422 {error}` with nothing applied:
   409 is the retryable `stale_bundle`, and no amount of waiting makes this
   request satisfiable.
4. **Report**: returns success + applied head from
   `public.atlas_schema_revisions` (`src/ledger.ts`) + `pathVerification`.
   CI fails unless applied head == expected head; it does not gate on
   `pathVerification`. The applied head is visible **only** through this
   OIDC-authenticated response: #1339 removed the anonymous `GET /ledger-head`
   route (it resolved the DDL-capable DSN on every anonymous hit of a public
   `workers_dev` host and had no caller), and `test/migrate.worker.http.test.ts`
   pins the 404. The post-staging smoke (#1198,
   `.github/scripts/staging-smoke-check.sh`) probes the edge and the web shell,
   not the head; if it is ever extended to assert the applied head, it must read
   a short-TTL value written at apply time (KV / DO storage), never a live DSN
   read.

Capability boundary: NO destructive path — no schema drop, no arbitrary SQL,
no down-migration. The migrator DSN is Secrets Store only (non-resident);
`workers/edge/test/migrator-role-isolation.test.ts` asserts it is not bound
by any runtime worker.

## Read-only compatibility preflight (#1575)

`POST /preflight` accepts `{expectedHead, atlasSum, stagingOnlyBaseline}` and an
optional `expectedPrismaRef` from
verified release metadata. `expectedHead` omits `.sql`; the complete Atlas checksum
file is bounded with the whole JSON body to 65,536 bytes. Metadata contains no SQL,
URL, DSN or environment override. The selected chain may be newer than this bundle.
The existing jose policy verifies identity before any secret or SQL; this endpoint
also requires `ref == refs/heads/main` independently of a valid production subject.

The native Neon driver reads the full ledger in one read-only repeatable-read
transaction. Only a completely executed type=2 prefix with matching version,
description and canonical Atlas/HTTP hashes returns `200 {compatible:true,
expectedHead, appliedHead, pendingCount}`. Missing/empty ledger, baseline/resolved
rows, malformed or partial history, errors, gaps, duplicates and newer schema refuse.
Every response is `no-store`; failures contain stable codes, never driver details.
`parsePreflightMetadata` and `compareMigrationPrefix` are reusable domain functions.

The Atlas-only transition route never creates a ledger, applies a chain or
acquires the apply lock. It remains available for the first pre-publication
check while the previous migrator bundle is serving. Requests containing
`expectedPrismaRef` use the same fixed DO as apply, verify the bundled Atlas
prefix and native snapshot, and call Prisma's public `executeMigrateShowPlan`.
The native preview reads the live marker without initializing its schema.
Local tests prove neither deployment nor production approval; see the canonical
[deployment runbook](../../docs/ops/deployment.md#read-only-migration-preflight-1575).

## Sealed native migrations (#1539)

`GET /healthz` also returns `prismaTarget`, the packaged contract's
`storage.storageHash`. The release publishes its migrator bundle before native
preflight: an older executor cannot inspect a graph it does not carry.
`node workers/migrator/scripts/prepare-migrations.ts <bundle-directory>` copies
the public package's complete `migrations/` and `contract.json` byte for byte.
The sealed no-bundle Wrangler config loads `contract.json`, `migrations/**/*.json`
and `migrations/**/*.d.ts` as Text modules with preserved file names. Native
filesystem APIs then read the graph at `/bundle/migrations`.

Native requests select only a 64-character hash in a packaged snapshot. They
cannot supply SQL, a graph, a path or a DSN. `/preflight` returns
`prisma: {targetHash, markerHash, migrations, usedLiveMarker}` with the native
migration array and live-marker flag. `/migrate` requires the same complete
metadata, rechecks Atlas compatibility and the native path inside the fixed
lock, applies Atlas, then calls `ControlClient.migrate` with that exact snapshot
and `refHash`. Prisma owns its transactions, advisory lock, operations and marker.
The response preserves its native receipt, including `markerHash`,
`migrationsApplied` and `applied`; a mismatched marker refuses success. Unknown
snapshots return retryable 409; an incompatible live path returns 422.

Atlas continues to own existing SQL tables; Prisma alone owns the seven new
session tables and `prisma_contract` marker schema. The direct migrator role
needs database `CREATE` to initialize that schema plus its existing table/schema
privileges. The disposable PostgreSQL suite proves this with a NOSUPERUSER
role: missing CREATE fails apply, the inherited grant succeeds, and replay
applies zero migrations. CI receives no DSN; the Worker resolves its secret.

## Tests

TDD at the HTTP seam (`test/migrate.worker.auth.test.ts` +
`test/migrate.worker.http.test.ts` + `test/http-apply*.test.ts`): valid
test-signed JWT → apply + success + applied head; wrong repo / wrong audience /
expired → 403; HTTP apply of a fixture chain against a fake `neon()`;
`-pooler` rejected before SQL; fake-lock concurrency; hung-container injection
→ 504. The container binding is faked and the JWKS injected (plain vitest —
`create-app.ts` stays free of `@cloudflare/containers`). The container image
build + staging deploy are CI-verified.

Three files own the #1365 surfaces. `test/policy.test.ts` judges CLAIMS against
both allowlists (the cross-replay matrix, plus the control case: an
`environment:production` sub with no `environment` claim is admitted by
`subAnchored` BY DESIGN) and asserts the two never carry each other's shape.
`test/migrate.worker.policy-selection.test.ts` proves the deployed Worker
actually picks one — without it `policyFor` could be dead code and every claims
test would still pass. `test/migrate.worker.handshake.test.ts` owns `/healthz`'s
`bundleHead` and the 409, including that it precedes the DSN.
`test/migrate.worker.bound.test.ts` owns the apply bound: it drives the real
apply over the fake neon-http client, so it asserts the SQL that reached the
database, not the arguments it was called with.
