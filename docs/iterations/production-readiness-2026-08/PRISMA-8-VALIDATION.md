# Prisma 8 validation — 2026-09-10

Owner decision: target Prisma 8 directly and simplify the new agent persistence layer.
This is a local feasibility result, not acceptance of #1539, #1541 or a production cutover.
The canonical target is the [Pi harness specification](../../specs/2026-09-09-agent-on-pi-harness-spec.md).

## Verified package surface

- Official skill: `prisma/prisma`, `skills/prisma-8`, commit
  `f889eeb89e81606018fad836bb3aeb5b1b4ac537`.
- CLI `prisma@8.0.0-rc.13`; PostgreSQL facade `@prisma/orm-postgres@8.0.0-rc.9`.
  Their release versions differ; pin each package explicitly.
- Runtime tests used Node 24.18.0. Type checking used TypeScript 7.0.2.
- The emitted contract uses `db.orm.public.User` and `db.sql.public.user`.
  Older skill examples containing `@internal/*` or flat model access are not the
  installed public API. Use emitted types and published exports.
- Node code uses `@prisma/orm-postgres/runtime`. Workers use the official
  `@prisma/orm-postgres/serverless` entry with a request-scoped connection from a
  Hyperdrive binding. The public `withTransaction` helper owns transaction cleanup.

## Local evidence and limits

| Proof | Observed result | Limit |
|---|---|---|
| Strict generated/client/Pi types | TS 7 passed with `skipLibCheck: false`; wrong input type and unknown field failed | Does not certify the unchanged Drizzle candidate |
| Type environment | Standard `ESNext.Temporal` plus ordinary DOM types; Google's declared MCP peer installed | Generated declarations are unchanged; only the two owner-approved declaration-style rules are exempted in the package lint config |
| Node PostgreSQL | Native create/read, nested JSONB including null/list/Unicode, foreign-key failure rolled back the earlier write | Disposable PostgreSQL, starter contract |
| Worker PostgreSQL | Wrangler bundle and local workerd/Hyperdrive completed two requests; JSONB and transaction rollback passed | No deployed latency or connection-reuse measurement |
| Prospective agent contract | Generated seven-table migration applied to fresh PostgreSQL; native Entry JSON round-tripped, entry/usage ID collision failed, later FK failure rolled back the earlier write | Not the complete Storage/SessionRepo writer or conformance suite |
| Generated migration graph | With A/B/C authored and contract C current, explicit B applied A→B only | Additive starter graph |
| Replay and refusal | B replay applied zero migrations and preserved marker/data; B→A without a path failed; explicit C preserved data | Not schema-drift, tamper or concurrent-migrator proof |
| Independent review | Fresh strict declaration closure and the above assertions reviewed without high-confidence findings | Not full story approval or production verification |

An initial custom esbuild bundle failed on a CommonJS Node builtin. The repository's
native Wrangler bundling path passed without a handmade compatibility shim.

## Existing database adoption

Official `contract infer` ran against a disposable database built from the repository's
Atlas chain. Inference completed, but the inferred contract is not ready for adoption:

- Default inference emitted unsupported geography columns for `locations.location`
  and `points.location`, and an unsupported `vector(1024)` for `points.embedding`.
- Installing official `@prisma/orm-extension-postgis` and
  `@prisma/orm-extension-pgvector` RC9 did not make inference translate those fields.
- Re-authoring the vector field as native `pgvector.Vector(length: 1024)` removed its
  emit diagnostic. The two geography diagnostics remained. The published PostGIS
  pack declares a Geometry constructor; this does not justify changing geography
  storage or distance semantics to geometry.
- The inferred Pi models omitted existing generated-column expressions. Audit these
  and non-model objects before any baseline/sign operation; a successful infer is
  not proof of a lossless schema round trip.

No live database was signed, migrated or queried for this probe. No applied Atlas
migration or existing data was changed. Whole-database ownership transfer remains
unproven. New agent work must give each object one DDL owner and test the actual
release/migrator handoff before shipping.

## Implementation boundaries

The SDK requires atomic ordered writes, shared entry/usage ID integrity, valid parent
visibility, native fork/read behavior and session isolation. It does not prescribe five
physical tables, generated JSON columns or duplicate validation triggers.

The candidate simplification combines entry/usage records under ordinary keys and
retains native payloads. Parent semantics must be validated at the SDK commit boundary
for every writer, including fork. Document what direct SQL can bypass; retain useful
foreign keys, access controls and accounting constraints. Admission, quota, recovery
and settlement remain domain obligations, not a second agent execution engine.

The concrete [native contract](../../../packages/pi-session-neon/src/contract.prisma)
and its [writer obligations](../../../packages/pi-session-neon/README.md) now replace the
prospective prototype. Generated snapshots and executable migrations live in the package's
native `migrations/` directory. The schema tests cover JSON root strings, scalars, lists,
null versus absence, reservation constraints and transaction rollback. Full Storage/SessionRepo
conformance and production writer behavior remain the responsibility of their implementation cards.

The pinned RC9 PostgreSQL runtime requires the package's narrowly scoped native pnpm patch:
its per-query parser leaves JSON text decoding to Prisma's existing codecs. The unchanged
JSON matrix fails when that patch is removed and passes when restored; this is a local
dependency correction, not an official fixed release. Strict generated types remain enabled.

The [migration Worker](../../../workers/migrator/AGENTS.md) uses public native preview/control
APIs, rechecks both DDL owners inside its fixed lock and returns the selected native marker.
Local workerd tests cover authenticated concurrent apply and replay with a non-superuser role.
Initializing `prisma_contract` requires database CREATE; local permission tests do not certify
the live role grant. The selected-artifact controller in #1564 owns publication order, receipt
validation and platform acceptance. Its local sealed build preserves the native graph bytes.

Before acceptance: replace the production mappings/writers, pass all upstream storage
and repository conformance suites, test real failure/interleaving behavior, verify the
immutable-artifact migration handoff, and collect deployed Neon latency evidence.

## Parallel delivery

| Story | Work that can proceed | Remaining dependency |
|---|---|---|
| #1539 / #1541 | Native contract and storage simplification | Full writer/conformance and migration handoff |
| #1559 | Native assertions, source-case preservation and retirement rules | Actual task/prefix composition and real eval evidence |
| #1564 | Artifact selection and review/platform evidence | Its own CD platform acceptance; preserve current migration authority until handoff |
| #1370 | Active-secret topology and conditional anonymous identity configuration | Complete preview, CD cutover and platform exercises |

## Official references

- [Prisma 8 release](https://www.prisma.io/changelog/2026-08-28)
- [Existing PostgreSQL adoption](https://www.prisma.io/docs/prisma-orm/add-to-existing-project/postgresql)
- [Migration model](https://www.prisma.io/docs/orm/migrations/how-migrations-work)
- [Official PostGIS extension source](https://github.com/prisma/orm/tree/main/packages/3-extensions/postgis)
- [Cloudflare PostgreSQL transport](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/)
