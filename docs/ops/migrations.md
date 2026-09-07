# Database migration boundary

This is the operational source of truth for schema changes in the hybrid runtime. It
separates the Neon data plane from the historical Supabase compatibility archive
(issue #1000) so a query schema cannot quietly become a second migration system.

## Authorities

| Surface | Source of truth | Apply mechanism | Boundary |
|---|---|---|---|
| Neon catalog and user data | `migrations/neon/*.sql` plus the generated `migrations/neon/atlas.sum` | Pinned Atlas CLI (`0.30.0`) | The only versioned schema and data migration history for Neon. The chain is schema-only; reference/seed data (e.g. the gazetteer at `workers/catalog/data/gazetteer_seed.sql`) is loaded separately and idempotently (`make seed-gazetteer`) |
| Catalog/users/edge runtime access | `workers/catalog/src/db/schema.ts`, `workers/users/src/db/schema.ts` and `workers/edge/src/db/schema.ts` | Drizzle `neon-http` client with raw `sql` queries | Runtime column/type metadata and query typing only; never a migration source |
| Supabase auth/legacy compatibility (**HISTORICAL**) | `supabase/migrations/` | **Not applied** — archived/historical only (issue #1000); never a live apply or source surface | `migrations/neon/*.sql` is the single authority; never a source for new Neon catalog or user tables |

`migrations/neon/` is append-only once a migration has reached a shared environment. Do not
edit an applied file, hand-edit `atlas.sum`, or copy a Drizzle schema into a second SQL
directory. The legacy `supabase/neon/` migration twin was removed (repo-root cleanup); new Neon changes belong
under `migrations/neon/`. The gazetteer seed (`workers/catalog/data/gazetteer_seed.sql`) is a
generated artifact and must stay out of this directory — it was removed from the chain in #847
and is loaded via `make seed-gazetteer` after the schema exists.

The application never runs migrations at startup. A Worker may construct a Drizzle client
and execute a query, but it must not import `drizzle-kit`, call a Drizzle migration API, or
run `drizzle-kit generate`, `migrate`, `push`, or `pull`.

## Approved pre-production history rewrite (2026-08-12, #992)

The persistence cutover (#992) is an **owner-approved one-time exception** to the append-only
policy: no business migration has reached production, so the business chain was rewritten in
place and rehashed instead of accumulating compatibility migrations. The rewrite, applied by
#993, makes the chain reproducible from an empty PostgreSQL 18 database and moves every
Animichi-owned persistent entity primary key to `uuid DEFAULT uuidv7()` (native PostgreSQL 18
`uuidv7()`):

- **Retired serial identities:** `aliases.id`, `cluster_version.id`, `itinerary_snapshots.id`
  (integer serial), `turn_reservations.id`, `messages.id` (bigint identity) — now `uuid`
  with a `uuidv7()` default; their `*_id_seq` sequences and grants were removed.
- **Default migration:** `feedback.id`, `request_log.id`, `saved_routes.id`, and the dropped
  `api_keys.id` moved from `gen_random_uuid()` to `uuidv7()`.
- **Unchanged external/semantic keys** (documented ownership): `sessions.id` (anonymous
  `anon_*` / Neon Auth subject), `bangumi.id`, `points.id`, `locations.id`,
  `media_assets.point_id` (Anitabi point id), `ingest_jobs.work_id`, `raw_anitabi.work_id`,
  `raw_bangumi.work_id`, memory operation/ledger ids, and composite keys
  (`daily_usage`, `anon_daily_message_count`, `leg_cache`, `location_aliases`,
  `saved_route_anime`, `series_edges`, `agent_memory.path`).

After this cutover, the normal append-only policy resumes for every shared environment.

## Authoring a Neon migration

1. Confirm that the change belongs to the Neon catalog/user data plane and that an existing
   migration cannot be safely extended. Use a new UTC timestamped file in `migrations/neon/`.
2. Write the SQL migration and review its locking, constraints, indexes, and expand/contract
   compatibility with the currently deployed readers and writers. Atlas owns ordering and
   the revision ledger; do not split statements or execute ad-hoc SQL in application code.
3. Recompute the integrity manifest and validate the directory:

   ```bash
   atlas migrate hash --dir file://migrations/neon
   atlas migrate validate --dir file://migrations/neon
   ```

   `atlas.sum` must be part of the same change. A hash-only run is local/static evidence; it
   does not prove that a Neon branch accepted the SQL.
4. Run the affected SQL/static tests and inspect the exact diff. Do not use Drizzle as a
   desired-state generator for this repository. The Drizzle files mirror the schema needed
   by runtime queries and types; the SQL files remain authoritative.

## Applying a Neon migration

The apply mechanism is schema-before-app in both environments. The affected main-SHA cohort
contains one sealed `db` payload. Staging asks the migration executor (migrator Worker + one-shot
Atlas batch container) to apply that payload through GitHub OIDC, so no application deployment
receives a database credential. After the single production approval, production applies the
same sealed directory once with its environment-scoped migrator DSN. Both database phases finish
before catalog/users promotion. The connection URL must never be committed or printed:

```bash
atlas migrate apply \
  --dir "file://migrations/neon" \
  --url "$NEON_DATABASE_URL" \
  --revisions-schema public
```

The deploy lane scopes the connection URL to `search_path=public` when the database also
contains the `neon_auth` schema. It keeps Atlas's clean-database check enabled and does not
use `--allow-dirty`.

For a non-mutating review against a disposable or explicitly approved target, use the same
command with `--dry-run`. CI always runs `atlas migrate validate`; a live dry-run/apply only
runs when the corresponding protected connection secret is present.

The Supabase CLI is not a substitute for this command. The archived `supabase/migrations/`
directory is historical and never applied; if an auth-only Supabase migration were explicitly
approved, it would follow its own owner/runbook and must not add or alter Neon data-plane tables.

## CI and deployment order

- Pull requests that affect the database dependency closure run the static Atlas checksum/SQL
  validation in the single `CI` workflow. The migration-boundary tests assert that BOTH
  environments reach the database only through the OIDC-authenticated migrator and that `cd.yml`
  names no database credential at all (#1365). Neither path may reintroduce `supabase db push` or
  a Drizzle migration command.
- `.github/workflows/cd.yml` selects the affected set for each main SHA, builds one artifact, and
  applies the migration chain in `stage-migration` — before services, edge, and web. Both
  environments run `scripts/delivery/migrate-through-worker.sh <env>` against their own migrator
  Worker, each with its own DSN and its own OIDC allowlist. There is no manual or tag-triggered
  alternate deploy path.
- **Expand/contract is a rule (US25/#1052)**: every schema change must be **compatible with the
  currently deployed consumers one version back**. Schema and component deploys are never
  atomic, so both deploy-order windows must stay safe by rule, not by luck:
  - **New schema, old code (rollout window)**: schema applies before components deploy, and
    components deploy one at a time — during the rollout some replicas still run the previous
    code against the new schema. New columns/indexes must be additive (add-only), and an
    existing column's type/constraint may only change if it remains readable/writable by the
    old consumers.
  - **Old schema, new code (rollback window)**: a Worker rollback never rolls back a database
    migration, so a rollback can put new code on the older schema. Any code merged after a
    migration must also tolerate the pre-migration shape (guard on missing columns, default
    values, optional reads) until the follow-up migration that removes the old shape has
    shipped. The removal itself is a **later** expand/contract step: add the replacement, deploy
    compatible readers/writers, confirm the old path is unused, then drop the old shape. A
    Worker rollback never rolls back a database migration.

## Verification boundary

Local `atlas migrate hash`, `atlas migrate validate`, CI static checks, and mocked tests prove
repository consistency only. They do **not** prove that staging or production Neon accepted the
migrations, that the Atlas revision ledger is current, or that the deployed Worker can query the
expected branch. Those claims remain **UNVERIFIED** in this change because no live Neon/Atlas
apply is authorized here.

After an approved staging apply, an operator should record the branch identity, Atlas status,
expected table/extension probes, and the deploy smoke result before promoting production. Keep
the raw DSN and tokens out of logs and PRs.

## Related entry points

- [`migrations/AGENTS.md`](../../migrations/AGENTS.md) — migration conventions and pinned commands
- [`docs/ops/deployment.md`](./deployment.md) — deployment sequence and rollback limits
- [`docs/ops/neon-backup-rpo.md`](./neon-backup-rpo.md) — RPO/RTO, PITR, failed-migrate + bad-migration recovery
- [`.github/workflows/pr-verification.yml`](../../.github/workflows/pr-verification.yml) — affected PR/static gates
- [`.github/workflows/cd.yml`](../../.github/workflows/cd.yml) — main-only affected release orchestration
- [`scripts/delivery/migrate-through-worker.sh`](../../scripts/delivery/migrate-through-worker.sh) — the OIDC handshake CD applies staging migrations through
- [`workers/edge/test/migration-boundary.test.ts`](../../workers/edge/test/migration-boundary.test.ts) — static boundary guard
