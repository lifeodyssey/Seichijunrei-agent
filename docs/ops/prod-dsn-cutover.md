# Production least-privilege DSN cutover (runbook)

**Ticket:** [#855](https://github.com/lifeodyssey/animichi/issues/855) · **Parent:** [#829](https://github.com/lifeodyssey/animichi/issues/829) · **Campaign:** [#904](https://github.com/lifeodyssey/animichi/issues/904) P5 (#913)
**Precedent:** staging cutover [#832](https://github.com/lifeodyssey/animichi/issues/832) (closed) · **Secrets ADR:** `docs/adr/0003-secrets-architecture.md` · **Env map:** `docs/ops/neon-env-topology.md`
**Agent container DSN:** [#912 follow-up](https://github.com/lifeodyssey/animichi/issues/912) (staging wire landed; this doc is the prod half)

## Current state (investigated for #913)

- **Production is an empty data plane**: the production Neon branch (`main` compute) has
  **no tables in `public`** (confirmed during the #846 spike — `public` is empty; the only
  object is an orphaned `atlas_schema_revisions` schema on some envs. Nothing reads or writes prod
  today, so the cutover has **zero traffic risk** — the first Atlas apply *creates* the schema.
- Prod runtime DSNs today come from **GitHub environment secrets** (`NEON_DATABASE_URL` owner
  DSN + `CATALOG_DATABASE_URL` / `USERS_DATABASE_URL` / `AGENT_DATABASE_URL`), injected by
  the production phase in `cd.yml`. This is exactly the P4 target state
  that staging is being migrated away from (ADR 0003; P4 = #912).
- **Roles are Neon-project-scoped, not branch-scoped**; GRANTs are branch/schema-scoped and
  shipped as Atlas migrations. The role matrix lives in
  `migrations/neon/20260826000001_roles.sql`, with each role's GRANTs beside the tables they
  apply to (`20260826000003_catalog.sql` · `…04_agent.sql` · `…05_users.sql`):
  `catalog_svc` · `agent_svc` · `users_svc` · `jobs_svc` · `readonly` (all `NOLOGIN` in Atlas;
  LOGIN state comes from Pulumi `neon.Role`, which also owns the password).

## Target

- Runtime DSNs for catalog / agent / users / jobs are **role-scoped** (never owner/migrator).
- **Migrator/owner DSN** exists only for Atlas apply (deploy workflow, production approval gate).
- Roles built by **Pulumi** (`neon.Role` ×4, passwords Neon-generated), connection strings
  composed by Pulumi and written **once** to the **Cloudflare Secrets Store** (not readable
  back); Workers bind Secrets Store values (`wrangler.toml` bindings — P4 shape).
- Schema + GRANTs applied by **Atlas** via the deploy path (`search_path=public`).

## Container DSN mechanism (agent — not a Worker)

The Python agent runs in a Cloudflare **container**, which has no Secrets Store binding of
its own. Containers receive env **only** through the edge Worker's code:
`buildContainerEnvVars()` (`workers/edge/src/container/container-env.ts`) copies from the edge
Worker's own env (`vars` + secrets + Secrets Store bindings) an allowlist of keys. So the
agent's Neon DSN travels: **Pulumi store secret → edge Worker `[[env.<env>.secrets_store_secrets]]`
binding → `CONTAINER_ENV_KEYS` forwarding → container env → `Settings.agent_svc_database_url`
(`Settings.database_url`, preferred over the legacy `SUPABASE_DB_URL`)**.

Staging landed this wire (#912 follow-up). Two consequences for prod:

- The prod edge Worker needs the same binding, and CI needs the value in the **GitHub
  `production` environment secret `AGENT_SVC_DATABASE_URL`** (uploaded via
  `wrangler secret put`, mirroring how `SUPABASE_DB_URL` is uploaded today) **or** the prod
  store binding once the prod store story below is settled — until then the prod container
  keeps `SUPABASE_DB_URL`.
- **Naming collision**: the store secret is `AGENT_SVC_DATABASE_URL`, not
  `AGENT_DATABASE_URL` — the latter name is the SAFE-1-pinned production jobs Worker
  secret (`AGENT_DATABASE_URL` worker secret; RETENTION-1 retired the staging store
  secret of that name) and store secret names are unique per store. The iter6 R1
  rename plan (`SUPABASE_DB_URL → AGENT_DATABASE_URL`) is therefore amended to
  `SUPABASE_DB_URL → AGENT_SVC_DATABASE_URL`.

## Database-access prod stack (Pulumi)

`infra/database-access/` carries both stacks: `Pulumi.staging.yaml` and, since #1048,
`Pulumi.prod.yaml`. The prod stack was deliberately **not** created in the staging PR
(#912 follow-up) — owner approval + secrets are HITL, and `neonApiKey` is still set by the
operator rather than committed. Steps:

1. **`infra/database-access/Pulumi.prod.yaml`** — mirror `Pulumi.staging.yaml`:
   - `neonProjectId`: the **same** Neon project (roles are **project-scoped**, not
     branch-scoped — do not re-create roles; `pulumi up` on a second stack against the same
     project would try to create them again and Neon rejects duplicate role creates).
   - `neonBranchId`: the **production** branch (`main` compute).
   - `cloudflareAccountId` / `secretsStoreId` / `neonApiKey`: see the store question below.
   - `pulumi stack init production` (passphrase provider, same R2 backend)
     followed by the **adopt** step: `pulumi import` the four `neon.Role`s by ID so Pulumi owns
     the passwords without recreating them (the provider key is fed at import time — import does
     not execute the stack program). Staging's adopt ran once by hand in 2026-08 from a script
     that #1372 deleted after the fact; its shape is in the history of
     `.github/scripts/database-access-adopt.sh`, and this list is the record that survives it.
2. **Store strategy (HITL, decided before `pulumi up`)** — the account's plan refused a
   second Secrets Store (`maximum_stores_exceeded`, code 1003), which is why staging
   imports the account's built-in `default_secrets_store`. Secrets are global per account,
   so **staging and prod cannot share the same store with the same secret names** (the
   values differ by branch endpoint/role password):
   - Preferred: upgrade the account plan (if the limit is plan-bound) and create a
     **second store for prod**; the stack's `secretsStoreId` config then points there and
     secret names stay identical (`CATALOG_DATABASE_URL`, `USERS_DATABASE_URL`,
     `AGENT_DATABASE_URL`, `AGENT_SVC_DATABASE_URL`).
   - Fallback: keep one store and give prod DSNs distinct names (e.g. `*_PROD` suffix) —
     the binding `secret_name` in `[env.production]` wrangler blocks then differs from
     staging. Either way, the prod store secrets are written **once** by Pulumi; verify
     with the deploy report hash row.
3. **Apply**: the affected `infra` payload in `cd.yml` runs the production
   `infra/database-access` Pulumi stack after the single `production` approval. The phase restores
   the sealed main-SHA payload, snapshots state, then runs `pulumi up`; roles are reused and
   DSNs are composed against the **main-branch endpoint**.
4. **Wire prod consumers** — **landed by W4-1 (#1314)**, taking the *fallback* store
   strategy above: one shared store, prod DSNs `_PROD`-suffixed. The edge Worker's
   `[[env.production.secrets_store_secrets]]` binds `AGENT_SVC_DATABASE_URL` to the store
   secret `AGENT_SVC_DATABASE_URL_PROD`; no CI `worker_secrets` upload is involved, because
   a Secrets Store binding is applied by `wrangler deploy` itself. The binding name matches
   staging's so `CONTAINER_ENV_KEYS` forwards one key in both environments. The jobs Worker
   is out of this cutover's scope: it stays on the `AGENT_DATABASE_URL` worker secret per the
   SAFE-1 production pin (#937). Remove the prod GitHub
   `*_DATABASE_URL`/`SUPABASE_DB_URL` secrets only after the bindings verify (step 5 of the
   cutover below).

## Cutover steps (owner window, HITL — mirror #832)

1. **Prereq: P4 green and stable on staging** (#912: roles exist project-wide once Pulumi ran;
   verify the Pulumi prod stack config points at the same Neon project and reuses the same
   role names — import, do not recreate, if the stack otherwise diverges). Also verify the
   **staging agent container** is on `AGENT_SVC_DATABASE_URL` (the #912 follow-up wire) and
   the old `SUPABASE_DB_URL` staging container value is rotated out of the edge Worker.
2. **Pulumi prod stack up** (`cd.yml` production foundation phase / owner-approved
   apply): confirms prod roles (import, project-scoped), composes prod DSNs (main-branch
   endpoint), writes them to the **Secrets Store** for the prod environment (store strategy
   above). Verify with the deploy report hash row.
3. **First prod Atlas apply** (deploy workflow, `production` environment approval): creates the
   schema in the empty `public` + applies `*_grants.sql` GRANTs. Empty data plane ⇒ this is a
   pure creation, nothing to preserve; soft-baseline decision for the future history squash
   stays per #845/#849.
4. **Flip Workers to Secrets Store bindings for prod** (wrangler.toml bindings land in P4;
   the prod deploy picks them up next deploy). Until then, old GitHub-secret DSNs keep working
   unchanged — the two planes coexist; do not delete old secrets before this step is verified.
5. **Remove GitHub `*_DATABASE_URL` secrets for prod** once no workflow references them
   (post-P4 code state, `needs`/`env` maps cleaned). Zero `*_DATABASE_URL` GitHub secrets is the
   P4 acceptance condition.
6. **Negative permission checks on prod** (record redacted on #855): catalog role cannot write a
   users-owned table; users role cannot write points; jobs cannot DDL; migrator-only DDL via a
   second connection as `jobs_svc` must fail.
7. **Update `docs/ops/neon-env-topology.md` + `docs/ops/secrets.md`** with the prod secret
   matrix (which secret → which role → which consumer).

## Rollback path

- **Order is the reverse of cutover, and roles are never dropped** (additive only):
  1. Re-point Workers at the previous secrets plane: re-set the GitHub environment secrets
     (`NEON_DATABASE_URL` etc. — values unchanged in GitHub until step 5) and redeploy; the
     Secrets Store binding value stays but is superseded by the explicit secret in the env map
     until P4's env-map removal is reverted.
  2. Secrets Store value rotation/repair: Pulumi rotates the `neon.Role` password (Neon
     regenerates; rotation path per ADR 0003) → re-write Secrets Store → redeploy Workers.
  3. **Data**: Neon PITR / backup window (runbook `docs/ops/neon-backup-rpo.md`); with an
     empty pre-cutover data plane there is nothing to restore from the cutover itself — PITR
     only matters for post-cutover prod data.
  4. Migration rollback: `atlas migrate` down is not a routine path (revisions are forward-only
     in this repo); bad-migration recovery is the HITL checklist in `docs/ops/neon-backup-rpo.md`.
- **No wipe**: production is no-wipe by policy (`docs/ops/neon-env-topology.md`), cutover
  included.

## Who does what

| Actor | Action |
|---|---|
| Agent (this PR / #855 prep) | Documents steps, prepares scripts/docs, records redacted evidence |
| Owner | Prod window approval; Secrets Store value write verification (once, not readable back); Pulumi prod apply approval |
| CI deploy | Pulumi prod `up` + Atlas apply via the `production` environment approval gate |
