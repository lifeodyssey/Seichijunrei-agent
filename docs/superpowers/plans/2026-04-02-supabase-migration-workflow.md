# Supabase Migration Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status (2026-04-03):** Landed in the codebase. Keep as historical rationale/checklist; use `docs/ops/deployment.md`, `supabase/`, and CI workflows as the source of truth.

**Goal:** Move the repository from hand-managed SQL files to a Supabase CLI-based migration workflow with a live baseline, repo-owned `supabase/migrations/`, CI validation, and a dedicated deploy-time `db push` stage.

**Architecture:** Introduce a root `supabase/` project, baseline the current live `public` schema into a tracked migration, convert current repo-side SQL drift into post-baseline migrations, and wire the CLI into CI and deploy workflows. Keep database mutation out of application startup and make migration history explicit via `supabase_migrations.schema_migrations`.

**Tech Stack:** Supabase CLI, PostgreSQL SQL migrations, GitHub Actions, Cloudflare deploy workflow, Makefile helpers

**Spec:** `docs/superpowers/specs/2026-04-02-supabase-migration-workflow-design.md`

---

## File Map

| File | Change |
|------|--------|
| `supabase/config.toml` | New Supabase CLI project config |
| `supabase/.gitignore` | Ignore local Supabase state/artifacts |
| `supabase/migrations/20260402120000_remote_schema.sql` | New baseline migration pulled from live |
| `supabase/migrations/20260402123000_points_alignment.sql` | Post-baseline app-owned schema delta migrated from current repo SQL |
| `supabase/migrations/20260402124000_operational_tables.sql` | Post-baseline operational tables / RLS migration |
| `Makefile` | Add `db-*` helper targets around Supabase CLI |
| `.github/workflows/ci.yml` | Add migration validation job/checks |
| `.github/workflows/deploy.yml` | Add dedicated `db-push` job before Cloudflare deploy |
| `README.md` | Document the new migration workflow |
| `infrastructure/supabase/migrations/` | Freeze / deprecate old path |
| `scripts/supabase/` | Mark as non-authoritative bootstrap/reference only |

---

## Task 1: Introduce Supabase CLI Project Structure

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/.gitignore`
- Modify: `Makefile`
- Modify: `README.md`

- [ ] **Step 1: Initialize the Supabase project**

Run:

```bash
supabase init
```

Expected:

```text
Finished supabase init.
```

- [ ] **Step 2: Add a minimal `.gitignore` for local Supabase artifacts**

Create `supabase/.gitignore`:

```gitignore
.branches
.temp
docker
```

- [ ] **Step 3: Normalize `supabase/config.toml` for repo use**

Set `supabase/config.toml` to the generated file with a repo-stable `project_id` and no app-specific secrets:

```toml
project_id = "seichijunrei-agent"

[api]
enabled = true
port = 54321
schemas = ["public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
shadow_port = 54320
major_version = 17

[studio]
enabled = true
port = 54323
```

- [ ] **Step 4: Add Makefile helpers for the new workflow**

Append to `Makefile`:

```make
.PHONY: db-link db-diff db-pull db-push db-push-dry db-reset

db-link:
	supabase link --project-ref $$SUPABASE_PROJECT_REF

db-diff:
	supabase db diff -f $$NAME --schema public

db-pull:
	supabase db pull $$NAME --schema public

db-push-dry:
	supabase db push --dry-run

db-push:
	supabase db push

db-reset:
	supabase db reset
```

- [ ] **Step 5: Document the developer commands in `README.md`**

Add a new “Database migrations” section to `README.md`:

```md
## Database migrations

This repo uses Supabase CLI as the canonical migration workflow.

Common commands:

```bash
make db-link SUPABASE_PROJECT_REF=<project-ref>
make db-pull NAME=remote_schema
make db-diff NAME=my_change
make db-push-dry
make db-push
```

Do not run migrations from application startup. Apply schema changes in a dedicated deployment step before deploying the app.
```

- [ ] **Step 6: Verify the scaffold exists**

Run:

```bash
test -f supabase/config.toml
test -f supabase/.gitignore
rg -n "db-push" Makefile README.md
```

Expected:

```text
`rg` prints at least one matching line from `Makefile` and one from `README.md`.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/config.toml supabase/.gitignore Makefile README.md
git commit -m "chore: add supabase cli project scaffold"
```

---

## Task 2: Capture the Live Baseline and Repair Migration History

**Files:**
- Create: `supabase/migrations/20260402120000_remote_schema.sql`

- [ ] **Step 1: Link the repo to the hosted Supabase project**

Run:

```bash
supabase link --project-ref qchdzpnoirwxcskfnspn
```

Expected:

```text
Finished supabase link.
```

- [ ] **Step 2: Pull the current live schema into a baseline migration**

Run:

```bash
supabase db pull 20260402120000_remote_schema --schema public
```

Expected:

```text
Schema written to supabase/migrations/20260402120000_remote_schema.sql
Finished supabase db pull.
```

- [ ] **Step 3: Review the baseline and keep only app-owned scope**

Run:

```bash
rg -n "CREATE (TABLE|INDEX)|ALTER TABLE|CREATE EXTENSION" supabase/migrations/20260402120000_remote_schema.sql
rg -n "public\\.(bangumi|points|sessions|routes|feedback|request_log|api_keys|waitlist)" supabase/migrations/20260402120000_remote_schema.sql
```

Then manually remove any accidental platform-managed schemas or unsupported objects that are outside app-owned scope.

- [ ] **Step 4: Repair remote migration history if prompted or needed**

Run:

```bash
supabase migration list
supabase migration repair --status applied 20260402120000
supabase migration list
```

Expected:

```text
LOCAL      | REMOTE
20260402120000 | 20260402120000
```

- [ ] **Step 5: Verify the baseline can be replayed locally**

Run:

```bash
supabase db reset
```

Expected:

```text
Applying migration 20260402120000_remote_schema.sql
Finished supabase db reset.
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260402120000_remote_schema.sql
git commit -m "chore: baseline live supabase schema"
```

---

## Task 3: Port Repo-Owned Drift Into Post-Baseline Supabase Migrations

**Files:**
- Create: `supabase/migrations/20260402123000_points_alignment.sql`
- Create: `supabase/migrations/20260402124000_operational_tables.sql`
- Modify: `infrastructure/supabase/migrations/005_points_schema_alignment.sql`
- Modify: `infrastructure/supabase/migrations/006_waitlist.sql`
- Modify: `scripts/supabase/006_operational_tables.sql`

- [ ] **Step 1: Create post-baseline migrations from the current repo-side SQL**

Run:

```bash
supabase migration new points_alignment
supabase migration new operational_tables
```

Expected:

```text
Created new migration under supabase/migrations/
```

- [ ] **Step 2: Copy the points contract alignment into the new Supabase migration**

Run:

```bash
cp infrastructure/supabase/migrations/005_points_schema_alignment.sql \
   supabase/migrations/20260402123000_points_alignment.sql
```

Then edit the new file so its first lines are:

```sql
-- Post-baseline alignment for app-owned points schema.
-- Source migrated from infrastructure/supabase/migrations/005_points_schema_alignment.sql
```

- [ ] **Step 3: Copy operational tables/RLS into the new Supabase migration**

Run:

```bash
cp scripts/supabase/006_operational_tables.sql \
   supabase/migrations/20260402124000_operational_tables.sql
```

Then edit the new file so its first lines are:

```sql
-- Post-baseline operational tables and RLS.
-- Source migrated from scripts/supabase/006_operational_tables.sql
```

- [ ] **Step 4: Freeze the legacy migration paths**

At the top of each old operational file, add a deprecation banner such as:

```sql
-- DEPRECATED: source of truth has moved to supabase/migrations/.
-- Keep this file only as historical/reference material during the migration cutover.
```

Apply that banner to:

- `infrastructure/supabase/migrations/005_points_schema_alignment.sql`
- `infrastructure/supabase/migrations/006_waitlist.sql`
- `scripts/supabase/006_operational_tables.sql`

- [ ] **Step 5: Verify the new migration chain**

Run:

```bash
supabase db reset
supabase migration list
```

Expected:

```text
20260402120000_remote_schema
20260402123000_points_alignment
20260402124000_operational_tables
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260402123000_points_alignment.sql \
        supabase/migrations/20260402124000_operational_tables.sql \
        infrastructure/supabase/migrations/005_points_schema_alignment.sql \
        infrastructure/supabase/migrations/006_waitlist.sql \
        scripts/supabase/006_operational_tables.sql
git commit -m "chore: port repo schema changes to supabase migrations"
```

---

## Task 4: Add CI Migration Validation

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add Supabase CLI setup to CI**

Insert a new `db-validate` job in `.github/workflows/ci.yml` after `lint`:

```yaml
  db-validate:
    name: Database Migration Validation
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Verify migration files exist
        run: |
          test -d supabase/migrations
          ls -1 supabase/migrations/*.sql

      - name: Link project
        run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }} --password ${{ secrets.SUPABASE_DB_PASSWORD }}

      - name: Dry-run database push
        run: supabase db push --dry-run
```

- [ ] **Step 2: Make tests/build wait for DB validation**

Update job dependencies so:

```yaml
  test:
    needs: [lint, db-validate]

  build:
    needs: [test, db-validate]
```

- [ ] **Step 3: Verify workflow syntax locally**

Run:

```bash
python - <<'PY'
from pathlib import Path
text = Path('.github/workflows/ci.yml').read_text()
assert 'db-validate:' in text
assert 'supabase db push --dry-run' in text
assert 'needs: [lint, db-validate]' in text or 'needs: [db-validate, lint]' in text
print('ci.yml contains migration validation job')
PY
```

Expected:

```text
ci.yml contains migration validation job
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add supabase migration validation"
```

---

## Task 5: Add a Dedicated Deploy-Time `db push` Stage

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] **Step 1: Add a database job that runs before Cloudflare deploy**

Insert a new job before `deploy`:

```yaml
  db-push:
    name: Apply Supabase Migrations
    runs-on: ubuntu-latest
    needs: [build-frontend]
    steps:
      - uses: actions/checkout@v4

      - uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link project
        run: supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }} --password ${{ secrets.SUPABASE_DB_PASSWORD }}

      - name: Show migration status
        run: supabase migration list

      - name: Dry-run migration push
        run: supabase db push --dry-run

      - name: Apply migrations
        run: supabase db push
```

- [ ] **Step 2: Gate Cloudflare deploy on `db-push`**

Change the deploy job dependency:

```yaml
  deploy:
    needs: [build-frontend, db-push]
```

- [ ] **Step 3: Verify workflow syntax locally**

Run:

```bash
python - <<'PY'
from pathlib import Path
text = Path('.github/workflows/deploy.yml').read_text()
assert 'db-push:' in text
assert 'supabase db push' in text
assert 'needs: [build-frontend, db-push]' in text
print('deploy.yml contains db push stage')
PY
```

Expected:

```text
deploy.yml contains db push stage
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add deploy-time supabase db push stage"
```

---

## Task 6: Final Verification and Legacy Path Cleanup

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-02-supabase-migration-workflow-design.md`

- [ ] **Step 1: Run final migration verification**

Run:

```bash
supabase migration list
supabase db push --dry-run
```

Expected:

```text
Remote database is up to date.
```

- [ ] **Step 2: Run application verification**

Run:

```bash
uv run pytest tests/unit/test_supabase_client.py tests/unit/test_sql_agent.py tests/unit/test_retriever.py tests/unit/test_points_schema_alignment.py -q --no-cov
npm --prefix frontend run build
```

Expected:

```text
pytest exits with status 0 and `npm --prefix frontend run build` finishes successfully.
```

- [ ] **Step 3: Add a legacy path warning to the spec and README**

Append this note to both docs:

```md
Legacy SQL under `infrastructure/supabase/migrations/` and `scripts/supabase/` is reference-only during cutover. New schema work must go to `supabase/migrations/`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-04-02-supabase-migration-workflow-design.md
git commit -m "docs: finalize supabase migration workflow guidance"
```
