# Supabase Migration Workflow Design

## Goal

Adopt Supabase CLI as the single supported migration workflow for this repository so database schema changes are versioned, reviewable, and applied in a dedicated deployment step instead of through ad hoc SQL execution or application startup.

## Current State

The repository currently has two database SQL locations:

- `infrastructure/supabase/migrations/` contains incrementally applied SQL files.
- `scripts/supabase/` contains bootstrap-style schema scripts and index definitions.

This layout has worked for direct SQL execution, but it has three recurring problems:

1. Migration history is not tracked by a standard tool in the repository.
2. Live Supabase can drift from repo SQL because Dashboard changes or one-off SQL edits are not automatically captured.
3. Database changes are operationally coupled to whoever remembers to run SQL, rather than to a repeatable deployment stage.

The project also does not currently use the standard `supabase/` directory or Supabase CLI commands such as `migration new`, `db diff`, `db push`, `migration list`, or `migration repair`.

## Decision

Use Supabase CLI and `supabase/migrations/` as the canonical migration system.

This is the recommended approach over:

- Keeping the current manual SQL workflow, which preserves drift risk and does not give us first-class migration history management.
- Running migrations during service startup, which is unsafe for multi-instance deploys and makes application availability depend on schema mutation success.

## Design Principles

### 1. Explicit migration stage

Database migration is a deployment stage, not an application boot behavior.

Required rule:

- Application containers, Workers, and runtime startup paths must never auto-run schema migrations.

Required deployment order:

1. Validate migrations
2. Apply migrations with Supabase CLI
3. Run smoke checks
4. Deploy application code

### 2. One source of truth

The authoritative migration history lives in:

- repo: `supabase/migrations/`
- remote: `supabase_migrations.schema_migrations`

The old directories become transitional only:

- `infrastructure/supabase/migrations/` will be frozen and then removed once the CLI-based workflow is established.
- `scripts/supabase/` will be retained only if we still need bootstrap/reference snapshots; it must not be treated as the primary migration path.

### 3. Forward-only operational workflow

Normal production changes are forward-only SQL migrations. We do not depend on down migrations for rollback. Rollback strategy is:

- restore from backup if needed for catastrophic failures
- or ship a corrective forward migration

### 4. App-owned scope only

This workflow owns only application-managed database objects, primarily:

- `public` schema tables used by the app
- app-required extensions such as `postgis`, `pgcrypto`, and `vector`

It does not attempt to re-own Supabase-managed platform objects such as:

- `auth`
- `storage`
- Supabase internal schemas
- PostGIS system catalogs/views like `spatial_ref_sys`, `geometry_columns`, `geography_columns`

## Recommended Repository Layout

Add a standard root-level Supabase directory:

```text
supabase/
  config.toml
  migrations/
  seed.sql                # optional
```

Target steady state:

- All new schema changes are created under `supabase/migrations/`.
- CI/CD and developers use Supabase CLI commands against that directory only.
- Legacy SQL under `infrastructure/supabase/migrations/` and `scripts/supabase/` is either archived or converted into the new structure.

## One-Time Adoption Plan

### Phase 1: Initialize the CLI structure

1. Install Supabase CLI in developer and CI environments.
2. Run `supabase init` at repo root.
3. Commit the generated `supabase/config.toml`.

### Phase 2: Baseline the live database

Because production already contains schema changes applied outside the Supabase CLI workflow, we should not blindly replay the existing SQL files as if the remote history were empty.

Recommended baseline approach:

1. Link the repo to the live Supabase project with `supabase link`, or use `--db-url` in controlled environments.
2. Run `supabase db pull <baseline_name>` against the live database to create a baseline migration that matches the real remote state.
3. Review the generated SQL carefully and remove anything outside app-owned scope if necessary.
4. Use `supabase migration repair --status applied` where needed so remote migration history reflects the chosen baseline version.

Why baseline from live:

- The live database is already the operational truth.
- We have already observed repo-vs-live drift in `points`, `waitlist`, `api_keys`, and RLS/policy state.
- A pulled baseline reduces the risk of replaying old SQL into a database that has already evolved.

### Phase 3: Port post-baseline changes

After the baseline migration is established:

1. Convert any unapplied repo-side SQL changes into new timestamped files under `supabase/migrations/`.
2. Ensure those files represent only changes that should happen after the baseline.
3. Stop adding new files to `infrastructure/supabase/migrations/`.

### Phase 4: Retire legacy paths

Once the new workflow is proven:

- Remove `infrastructure/supabase/migrations/` from operational use.
- Either remove `scripts/supabase/` or relabel it clearly as non-authoritative reference/bootstrap material.

## Daily Developer Workflow

### SQL-first changes

When the change is known in SQL form:

1. Run `supabase migration new <name>`
2. Write the SQL into the generated file
3. Test locally with `supabase db reset`
4. Commit the migration

### Dashboard-first changes

When a developer prototypes in the Dashboard or local Studio:

1. Make the change in the target database
2. Capture it with `supabase db diff -f <name>`
3. Review and clean up the generated SQL
4. Reset locally and re-test
5. Commit the migration

Required rule:

- No schema change is considered complete until it exists as a committed migration file.

## Migration Authoring Rules

Every migration should follow these rules:

1. Single responsibility
   - One logical change per migration where practical.

2. Production-safe SQL
   - Avoid long-locking operations unless explicitly planned.
   - Prefer idempotent guards for indexes, policies, and optional backfills where appropriate.

3. Explicit data backfills
   - If schema changes require backfilling existing rows, keep the backfill in the same migration or in an immediately adjacent, clearly named migration.

4. Contract alignment
   - If a migration changes a runtime field contract, the matching application code and tests must ship in the same PR.

5. Reviewability
   - Generated `db diff` SQL must be hand-reviewed before merge.

## CI/CD Design

### Pull request checks

PR validation should include:

- Python and frontend test suites relevant to the changed code
- migration file presence check when schema-sensitive code changed
- optional `supabase db lint`
- optional `supabase db push --dry-run` in a safe environment

### Deployment pipeline

Production deployment should include a dedicated database step before application deploy:

1. Authenticate Supabase CLI
2. Link to the target project or provide `--db-url`
3. Run `supabase migration list`
4. Run `supabase db push --dry-run`
5. Run `supabase db push`
6. Run smoke verification queries
7. Deploy the app

This step must be serialized so only one deployment mutates schema at a time.

## Secrets and Environment

Preferred operational secret model:

- CI uses a dedicated Supabase access token or controlled database URL
- local developers use `supabase link` for normal workflows

Application runtime secrets are separate from migration secrets. The app may need `SUPABASE_DB_URL`, but migration automation should not depend on the app boot path or application process environment.

## Verification Requirements

Every schema-changing PR should be verified at three levels:

### 1. Migration validation

- `supabase migration list`
- `supabase db push --dry-run`

### 2. Application validation

- targeted unit/integration tests for changed schema contracts
- frontend type/build checks when API shapes change

### 3. Live smoke validation

- inspect the changed table/column/index/policy in the target database
- verify at least one real code path that depends on the change

## Risks

### Risk: importing a bad baseline

If the first `db pull` baseline includes unwanted remote drift, that drift becomes codified.

Mitigation:

- manually review the baseline SQL before adopting it
- scope the baseline to app-owned schemas where possible

### Risk: old and new migration paths both remain active

If engineers continue writing to `infrastructure/supabase/migrations/`, drift will continue under a different folder name.

Mitigation:

- document the old path as deprecated
- remove it once the new workflow lands

### Risk: Dashboard edits bypass version control

Mitigation:

- allow Dashboard edits only as a temporary authoring surface
- require `db diff` or `db pull` capture before merge

## Non-Goals

This design does not attempt to:

- auto-run migrations during service startup
- manage Supabase platform schemas as if they were app-owned
- rely on down migrations as the primary rollback mechanism
- fully redesign the app’s database schema in the same effort

## Recommended Rollout

Recommended rollout order:

1. Add `supabase/` and CLI support to the repo
2. Capture and review a live baseline
3. Reconcile migration history with `migration repair`
4. Move all new work to `supabase/migrations/`
5. Add CI `db push --dry-run`
6. Add deploy-stage `db push`
7. Remove legacy migration paths from active use

## References

- Supabase Database Migrations:
  https://supabase.com/docs/guides/deployment/database-migrations
- Supabase CLI `db push` / `db pull` / `db diff` / `migration list`:
  https://supabase.com/docs/reference/cli/supabase-db-pull
- Supabase CLI `migration repair`:
  https://supabase.com/docs/reference/cli/supabase-migration-up
- Supabase local development overview:
  https://supabase.com/docs/guides/local-development/overview
