# Secrets inventory (Pulumi ESC + the Worker)

What every credential the delivery lane and the runtime depend on is for, who consumes it, and
what breaks if it is rotated. Started 2026-07-29 after setting `ANON_ID_SECRET` blind — the value
went in with no record anywhere of what it does.

Since #1367 no workflow reads a GitHub secret. The three GitHub secret stores — repository,
`staging`, `production` — still hold their values: emptying them is the owner's last step in that
card, taken only after one green staging deploy and one green nightly have run on the ESC path, so
that a wrong ESC value is recoverable. Until then this file describes two homes at once: the one
every consumer reads from (below), and a GitHub copy nothing reads.

Companion to [`deployment.md`](./deployment.md), which covers non-secret runtime config
(`LOG_LEVEL`, `CACHE_TTL_SECONDS`, and the rest of `CONTAINER_ENV_KEYS` that never touch a
GitHub secret). **Values never appear here, in commit messages, in PR bodies, or in chat** —
see the "Handling" section at the bottom.

## This file rots by default — the test that keeps it honest

A one-time inventory snapshot goes stale the moment a secret is added, renamed, or
re-scoped, and nothing else notices. `gh secret list` cannot be the enforcement mechanism:
it needs a repo-admin PAT to run in CI (the default `GITHUB_TOKEN` cannot list repo
secrets), and minting a standing admin token just to keep a doc honest is a net-negative
trade. Instead,
[`apps/agent/src/animichi/tests/unit/test_secrets_docs_consistency.py`](../../apps/agent/src/animichi/tests/unit/test_secrets_docs_consistency.py)
does it with zero credentials, by grepping source instead of asking GitHub:

- **A** = every credential-shaped name in `workers/edge/src/container/container-env.ts`'s
  `CONTAINER_ENV_KEYS` (`_API_KEY` / `_TOKEN` / `_SECRET` suffix), plus every name used as
  `${{ secrets.X }}` anywhere under `.github/workflows/**` — a set that has been empty since #1367
  and that `test_workflow_invariants.rb` keeps empty. The rest of `CONTAINER_ENV_KEYS` is plain
  runtime config with no credential behind it and stays out of scope here (see `deployment.md`).
- **B** = every name in this file's two tables (Live + Referenced by nothing).
- `test_every_workflow_secret_and_credential_container_key_is_documented`: **A ⊆ B**. Code
  reaches for a secret this file has never heard of → red.
- `test_live_table_entries_are_still_actually_referenced`: every name in the **Live** table is
  still in A. A secret's last reference gets deleted and the row doesn't move to
  "Referenced by nothing" → red, not a silent stale claim.

Follows the shape of `apps/agent/src/animichi/tests/unit/test_anonymous_docs_consistency.py`, which
does the same job for `ARCHITECTURE.md` against `workers/edge/src/identity/auth.ts`.

## Nothing in GitHub is read any more (#1367)

`grep -c 'secrets\.' .github/workflows/*.yml` is 0, and `test_workflow_invariants.rb` keeps it
there. The same-name override rule this section used to explain — an environment secret shadowing a
same-named repository secret — still describes how GitHub would resolve a name, but nothing asks it
to resolve one. The stores themselves are emptied at the end of #1367, after the two green runs.

Where the two kinds of credential live now:

| Kind | Home | Reached by |
|---|---|---|
| CI-plane (`CLOUDFLARE_API_TOKEN`, `NEON_API_KEY`, `ZEN_GO_API_KEY`) | Pulumi ESC, under `environmentVariables` in `lifeodyssey/animichi/staging` and `…/prod` | the job's own GitHub OIDC identity → `pulumi/auth-actions` → `pulumi/esc-action`. The job's `environment:` is what makes its OIDC subject one the Pulumi Cloud issuer policy accepts (`deployment.md`, "Pulumi state, encryption, and CI identity") |
| Edge runtime (the eight names in chain 1 below) | Pulumi ESC, under `pulumiConfig` as `fn::secret`, and on the Worker itself | Pulumi, never CI. `pulumi/esc-action` exports `environmentVariables` and `files` only, so a value under `pulumiConfig` cannot reach a publishing job at all |

`CLOUDFLARE_ACCOUNT_ID` left this file entirely: it is an account identifier, not a credential. The
repository variable `vars.CLOUDFLARE_ACCOUNT_ID` was created 2026-09-08 and is what the workflows
read; the GitHub *secret* of the same name is one of the copies awaiting deletion.

`ZEN_GO_API_KEY` is deliberately in both ESC sections — the nightly eval reads it as a job
environment variable, and the edge runtime reads it through the Secrets Store. They are the same
value with two consumers, not a duplicate to deduplicate.

## Three consumption chains

A secret reaching a shared environment takes one of three shapes:

1. **Edge-to-container core chain** — **CI no longer participates in this chain.** #1364 deleted
   the last upload step (`sync-edge-runtime-secrets.sh` piping a JSON object into `wrangler secret
   bulk`, and the `edge-runtime-secrets.py` allowlist it fed): no workflow uploads a runtime secret
   any more, and `cloudflare/wrangler-action`'s `secrets:` input is deliberately unused.
   The eight names — `DEEPSEEK_API_KEY`, `MIMO_API_KEY`, `ZEN_GO_API_KEY`, `SUPABASE_DB_URL`,
   `GOOGLE_MAPS_API_KEY`, `LOGFIRE_TOKEN`, `TURNSTILE_SECRET`, `ANON_ID_SECRET` — remain on the
   Worker as the wrangler secrets they already were: `wrangler deploy` does not touch a secret the
   config does not declare, so an existing version survives every deploy. Rotation is the owner's
   `wrangler secret put` until #1370 moves all eight into the Cloudflare Secrets Store, provisioned
   by Pulumi from Pulumi ESC, after which the name list exists in exactly one place.
   `CONTAINER_ENV_KEYS` in `workers/edge/src/container/container-env.ts` still forwards the
   container-bound subset into the agent.
2. **Worker-only anonymous chain** — `TURNSTILE_SECRET` and `ANON_ID_SECRET` are read by the edge
   Worker itself rather than forwarded to the container, and they matter only where
   `ANON_ACCESS_ENABLED = "true"` (staging true, production false). They followed the same route as
   chain 1 and now sit under the same rule: already-set wrangler secrets, no CI upload, #1370 moves
   them to the Secrets Store.
3. **Plain var chain** — never a GitHub secret at all; a literal value checked into
   `wrangler.toml`'s `[vars]` (or `[env.<name>.vars]`), forwarded to the container the same way
   as (1) via `CONTAINER_ENV_KEYS`. Reference implementation: `ANON_DAILY_COST_BUDGET_USD`.
   1. `wrangler.toml` — add the literal value under the relevant `[vars]` section(s).
   2. `workers/edge/src/container/container-env.ts` — add the name to `CONTAINER_ENV_KEYS`.
   3. `deployment.md`'s environment tables (not this file — nothing secret-shaped happened).

`CORS_ALLOWED_ORIGIN` has completed the chain-1 → chain-3 migration for both environments
(#1047): the value is a checked-in `[env.*.vars]` wrangler var (staging and production alike),
so it no longer has a Live row here — see its "Referenced by nothing" row below.

## Live secrets

| Secret | Scope | What it is | Value lives in / read by | Rotation |
|---|---|---|---|---|
| `ZEN_GO_API_KEY` | ESC `environmentVariables` (nightly eval) + ESC `pulumiConfig` (edge runtime) | **Production LLM gateway.** MiMo `mimo-v2.5` is routed through the zen/go gateway (`https://opencode.ai/zen/go/v1`) | Exact edge core payload → Worker binding → agent container; and `agent-eval-nightly.yml`, which opens it from ESC | Missing or blank blocks edge staging, production, and rollback at preflight. The nightly eval 401/403s the provider and the user sees the agent's generic failure response, never the raw provider error (SD-19) |
| `MIMO_API_KEY` | ESC `pulumiConfig` | Retired direct-gateway credential retained as an explicit rollback-capable runtime binding | Exact edge core payload → Worker binding → agent container | It is required even while zen/go is the default; missing or blank blocks edge staging, production, and rollback at preflight |
| `DEEPSEEK_API_KEY` | ESC `pulumiConfig` | Fallback model — **wired but disabled** (no balance) | Exact edge core payload → Worker binding → agent container | It remains an exact required binding; missing or blank blocks edge staging, production, and rollback at preflight |
| `GOOGLE_MAPS_API_KEY` | ESC `pulumiConfig` | Geocoding (`apps/agent/src/animichi/infrastructure/gateways/geocoding.py`) | Exact edge core payload → Worker binding → agent container | Missing or blank blocks edge staging, production, and rollback at preflight; an invalid value surfaces later as place-resolution failure |
| `LOGFIRE_TOKEN` | ESC `pulumiConfig`, one project per environment (`animichi-staging` / `animichi-prod`) as of 2026-07-29, replacing one shared `LOGFIRE_TOKEN_PROD`/`LOGFIRE_TOKEN_STAGING` pair that lived less than eight hours (wiring was #498) | Write token for the environment's Logfire project | Exact edge core payload → Worker binding → agent container | Missing or blank blocks edge staging, production, and rollback at preflight. A wrong-but-present value only stops traces for that environment |

## Referenced by nothing

Found by grepping every secret name across `.github/workflows/` and `CONTAINER_ENV_KEYS` against
every source tree in the repo, against a read-only `gh secret list` name snapshot taken 2026-08-01.
#1367's final owner step deletes every GitHub secret at once, these rows included, so the action
column is now the record of *why* each is safe to delete rather than a per-row backlog.
**They were never one kind of finding** — read it before treating them as one:

| Secret | Finding | Owner action |
|---|---|---|
| `STAGING_GATE_TOKEN` | The staging WAF gate remains, but no current workflow can read this GitHub environment secret after automatic smoke was deferred | Owner smoke must use an independently held break-glass value; either add a future approved smoke workflow that explicitly consumes this secret or delete the unreachable GitHub copy after confirming the gate's source of truth |
| `AGENT_DATABASE_URL` | The production maintenance Worker may still read this DSN, but no current workflow forwards it | Confirm whether the maintenance Worker remains deployed; wire it into CD if retained, otherwise retire the Worker and then delete the secret |
| `GCP_SA_KEY` | A GCP service-account private key, added 2025-12, referenced nowhere in code or workflows — the only row here with a real blast radius if it leaked (a live cloud credential, not an inert config name) | Check GCP IAM for any usage of this SA outside this repo; if none, revoke it in GCP first, then `gh secret delete GCP_SA_KEY`. Open an issue to track — do not batch with the rows below |
| `GCP_PROJECT_ID` | Companion to `GCP_SA_KEY`, same 2025-12 origin, referenced nowhere | Delete once `GCP_SA_KEY` is confirmed dead and revoked |
| `CLAUDE_CODE_OAUTH_TOKEN` | Added 2026-05, referenced nowhere | `gh secret delete CLAUDE_CODE_OAUTH_TOKEN` — no dependency to check first |
| `ZETA_API_KEY` | Model-provider key for Z.AI — was listed in `CONTAINER_ENV_KEYS` (`workers/edge/src/container/container-env.ts`) but **no workflow ever passed it** and no source reads it, a broken chain. Retired under the MiMo-only key convergence (#684): removed from the forwarding allowlist, with the policy decision (Zeta is not a wanted provider) recorded in the `workers/edge/wrangler.toml` comment block | `gh secret delete ZETA_API_KEY` — no dependency to check first |
| `OPENAI_COMPAT_API_KEY` | Read by `apps/agent/src/animichi/config/settings.py` and `apps/agent/src/animichi/config/model_aliases.py`, listed in `CONTAINER_ENV_KEYS`, but again **no workflow passes it** — broken chain: the allowlist expects a value no workflow ever forwards | Keep-or-retire decision, not a delete: code still reads this credential, so retiring it means first removing its references from `settings.py` / `model_aliases.py`, then the `CONTAINER_ENV_KEYS` entry and this row |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_BASE_URL` | Repository secrets present in the 2026-08-01 snapshot, but no workflow or source file references either name; the old Dependabot/Claude path was retired | Confirm no external automation still uses them, then delete both repository secrets |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Repository secret present in the 2026-08-01 name snapshot, but no workflow, `apps/web` source, or `CONTAINER_ENV_KEYS` entry references it. The current map stack is MapLibre GL + Protomaps PMTiles and the Mapbox ADR is explicitly retired/banned. If a future Mapbox integration is approved, this `NEXT_PUBLIC_` token would be a **public browser client token**, not a container secret; it would need URL restrictions and a public build variable instead of secret forwarding. | Confirm no external deployment still consumes it, revoke the token in the Mapbox console, then `gh secret delete NEXT_PUBLIC_MAPBOX_TOKEN`. Do not move it to Live or add it to `CONTAINER_ENV_KEYS` |
| `GEMINI_API_KEY` | Was Live (this table, above) until #656 (2026-08-04): photo-search recognition now rides the main agent's multimodal input (`apps/agent/src/animichi/agents/photo_vision.py`) instead of the standalone `GeminiVisionProvider`, so nothing in `CONTAINER_ENV_KEYS`, `wrangler.toml`, or any workflow reads this name anymore | `gh secret delete GEMINI_API_KEY` once the deploy carrying #656 is confirmed live in production — no dependency to check first, the code path it fed no longer exists |
| `CORS_ALLOWED_ORIGIN` | Was Live (this table, above) until #1047 (2026-08-15): demoted to a checked-in **wrangler var** — `[env.*.vars].CORS_ALLOWED_ORIGIN` in `workers/edge/wrangler.toml` (asserted by `workers/edge/test/auth-config.test.ts`); no workflow forwards `${{ secrets.CORS_ALLOWED_ORIGIN }}` anymore, so any residual GitHub secret (repo-level or `production` environment) is a dead binding | `gh secret delete CORS_ALLOWED_ORIGIN` (repo) and `--env production` if present — the value now lives in the checked-in wrangler vars |
| `NEON_AUTH_JWKS_URL` | Was Live (this table, above) until #1047: the edge's only identity source is now provisioned as a Cloudflare Secrets Store entry (name constant `NEON_AUTH_JWKS_VAR` in `infra/src/neon-auth.ts`, value written by the infra/database-access stack `index.ts`) with the checked-in wrangler var as the dev/placeholder path — no workflow references `${{ secrets.NEON_AUTH_JWKS_URL }}` anymore | `gh secret delete NEON_AUTH_JWKS_URL --env staging` and `--env production` if present — the value now lives in the Cloudflare Secrets Store / wrangler vars |
| `CLOUDFLARE_PULUMI_API_TOKEN` | Was Live (this table, above) until #1078: the Pulumi-plane Cloudflare token now reaches `pulumi up` from the `animichi/staging` / `animichi/prod` Pulumi ESC environments, injected by `pulumi/esc-action` under the ESC key `CLOUDFLARE_API_TOKEN` after the OIDC login. No workflow, action, or script reads `${{ secrets.CLOUDFLARE_PULUMI_API_TOKEN }}` any more | Do **not** delete yet — the GitHub environment copies stay until the first CD run proves the ESC path (#1078 AC3), and deleting them is #1081 |
| `NEON_API_KEY` | Was Live (this table, above) until #1078: the Neon provisioning key for `animichi-neon-secrets` now comes from the same two ESC environments under the same-named ESC key. Its workflow references are the two `cd.yml` jobs that hold a reader for it — `stage-migration`, where `neonctl` spends it on the staging baseline reset (`infra/database-access/reset-staging-baseline.sh`), and `promote-production` — in both of which `pulumi/esc-action` injects it. Not `stage-foundation`: #1469 moved the reset out of it, and a `pulumi up` never reads the name, because both programs construct the Neon provider from the `neonApiKey` stack config (`infra/database-access/index.ts`). `test_cd_credential_boundary_contract.rb` keeps every ESC export list inside `CLOUDFLARE_API_TOKEN` + `NEON_API_KEY` and refuses this name to any job with no reader for it | Do **not** delete yet — same reason as the row above: it is #1081, after the ESC path has run green once |
| `PULUMI_BACKEND_URL` · `PULUMI_CONFIG_PASSPHRASE` · `R2_ACCESS_KEY_ID` · `R2_SECRET_ACCESS_KEY` | Were Live (this table, above) until #1077: Pulumi state and `secure:` encryption moved to Pulumi Cloud, CI logs in with `pulumi/auth-actions` (GitHub OIDC), and the pre-apply R2 state export retired with the backend. No workflow, action, or script reads any of the four | Do **not** delete yet — the owner still needs the passphrase and the R2 keys to run the one-time export/import in `docs/ops/deployment.md` ("One-time migration"), and they are the documented fallback until every stack is imported. Deletion of the GitHub copies is #1081, after that cutover |
| `CATALOG_DATABASE_URL` | Migrated to the Cloudflare Secrets Store (#912 PR2): the catalog Worker's staging DSN now arrives via the `[[env.staging.secrets_store_secrets]]` binding in `workers/catalog/wrangler.toml`, so no workflow or GH secret reference remains. The staging GH secret still exists only until the binding swap is verified live | After the first post-PR2 staging deploy passes its post-deploy suite, `gh secret delete CATALOG_DATABASE_URL --env staging` |
| `USERS_DATABASE_URL` | Migrated to the Cloudflare Secrets Store (#912 PR2): the users Worker's staging DSN now arrives via the `[[env.staging.secrets_store_secrets]]` binding in `workers/users/wrangler.toml`, so no workflow or GH secret reference remains. The staging GH secret still exists only until the binding swap is verified live | After the first post-PR2 staging deploy passes its post-deploy suite, `gh secret delete USERS_DATABASE_URL --env staging` |
| `SUPABASE_DB_URL` · `TURNSTILE_SECRET` · `ANON_ID_SECRET` | Were Live (this table, above) until #1364: CD's runtime-secret upload step is gone, so no workflow references any of the three. They are **not** dead — all three are already-set wrangler secrets on the edge Worker, and `wrangler deploy` leaves a secret the config does not declare alone, so the running Worker keeps reading them. (`SUPABASE_DB_URL` is also the transitional container DSN name pending the #855 cutover; the two anonymous-access secrets are staging-only.) | Do **not** delete. #1370 provisions all eight edge runtime secrets as Cloudflare Secrets Store entries from Pulumi ESC and then deletes the old wrangler secrets; the GitHub copies go with the rest in #1367, by which time nothing reads them |
| `NEON_DATABASE_URL` | Was Live (this table, above) until #1365 (C3): production migrations now go through the migrator Worker on GitHub OIDC exactly like staging, so the Atlas transitional step and its `${{ secrets.NEON_DATABASE_URL }}` are gone from `.github/workflows/cd.yml` — no workflow references the name any more (`workers/edge/test/migration-boundary.test.ts` asserts zero occurrences). The catalog/users runtime DSNs already came from Cloudflare Secrets Store bindings, and the migrator reads its own `MIGRATOR_DATABASE_URL` store secret provisioned by `infra/database-access/index.ts` | Do **not** delete piecemeal — the repo, `staging`, and `production` copies go with every other GitHub secret in D1 (#1367), by which time nothing reads them (#1057 endgame) |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` | Retired Supabase auth-plane credentials. No source, workflow, release manifest, or runtime reads either name after the Neon Auth hard cut | `gh secret delete SUPABASE_URL` then `gh secret delete SUPABASE_ANON_KEY`. (`SUPABASE_DB_URL` is a separate transitional container-DSN name.) |
| `SUPABASE_SERVICE_ROLE_KEY` | Retired Supabase service-role credential. No source, workflow, release manifest, or runtime reads it | `gh secret delete SUPABASE_SERVICE_ROLE_KEY` |

Deleting is a per-row decision, not a batch one: `GCP_SA_KEY` needs an external check before
deletion, the one remaining broken chain (`OPENAI_COMPAT_API_KEY`) needs a keep-or-retire
decision (not a delete) — `ZETA_API_KEY`'s retirement was already decided in #684 (MiMo-only) —
Mapbox needs a provider-side revocation check, and only `CLAUDE_CODE_OAUTH_TOKEN` is safe to
delete immediately.

## Staging access: the Cloudflare Access service token (D3 #1369)

Its own section, not a row in the two tables above, because the tables are the GitHub-secret
inventory `test_secrets_docs_consistency.py` keeps honest: it derives its required set from
`${{ secrets.X }}` references and `CONTAINER_ENV_KEYS`, and these two names appear in neither.
They were never GitHub secrets and never will be.

| ESC key | Scope | What it is | Source | Read by | Rotation |
|---|---|---|---|---|---|
| `CF_ACCESS_CLIENT_ID` | `environmentVariables` of `lifeodyssey/animichi/staging` only | The public half of the Cloudflare Access service token; Access matches it in the `CF-Access-Client-Id` header | Stack output `stagingAccessClientId` of `seichijunrei-infra`/`staging` (`infra/src/staging-access.ts`), imported by the environment's `pulumi-stacks` provider | CI: `pulumi/esc-action` in `cd.yml`'s `smoke` job (from PR 2). Local: `esc env open`. In code: `packages/contract/src/access-service-token.ts`, read by `.github/scripts/staging-smoke-check.sh`, `e2e/playwright.config.ts` and `workers/edge/api-test/lane-origin.ts` | Bump `clientSecretVersion` on the Pulumi resource; ESC re-reads the output on the next open. **The token itself still expires — see the deadline below** |
| `CF_ACCESS_CLIENT_SECRET` | same | The secret half, matched in the `CF-Access-Client-Secret` header | Stack output `stagingAccessClientSecret`, sealed with `pulumi.secret` so it is ciphertext in Pulumi Cloud state | same | same |

Production has neither key: it has no Access application. The two are useless apart — Access
answers a request carrying one of them exactly as it answers one carrying neither, so every
consumer refuses a half-declared pair by name rather than sending a request that comes back
looking like a broken deploy.

### It expires. Nothing tells you.

`infra/src/staging-access.ts` sets `duration: "8760h"`, which is **one year** — the provider's own
default, written out so the number is visible. An earlier revision of this table said the token is
"never rotated by time"; that was true of *rotation* and false about *expiry*, which is the
distinction that matters at 03:00 when CI cannot reach staging.

- **Created** by the first `stage-foundation` apply that carries `infra/src/staging-access.ts`
  (2026-09, the CD run that lands PR #1498). **Expires one year later.** The exact instant is the
  resource's `expiresAt` attribute. It is deliberately NOT a stack output today — the two exported
  outputs are the ones ESC imports and nothing else — so read it from Zero Trust → Access →
  Service Auth in the dashboard, or from the service-tokens API. Exporting it, so the deadline is
  machine-readable, is a PR-2 follow-up.
- **Extend it** (same client id and secret, one more year): the dashboard's **Refresh** button on
  the token, or `POST …/access/service_tokens/{id}/refresh`. Changing `duration` on the Pulumi
  resource sets a new lifetime too.
- **Replace the secret** (new value, same token): bump `clientSecretVersion` on the Pulumi
  resource, which is the rotate call underneath —
  `previousClientSecretExpiresAt` is the grace window during which the old secret still works, so
  set it far enough out to cover one CD run and let ESC re-read the output. Omitting the grace
  window revokes the old secret immediately.
- **Who gets warned: nobody, today.** Cloudflare can email an "Expiring Access Service Token"
  notification a week before expiry, but it is a Notifications rule an account admin has to create
  by hand; it is not on by default, and nothing in this repository creates or asserts it. Unless
  the owner has already added it out of band, expiry surfaces as
  every automated caller getting the Access login page at once — the same symptom as a wrong value.
  Creating the notification (or a calendar reminder, whichever the owner prefers) is tracked as a
  PR-2 follow-up on #1369.

**Failure modes.** A wrong or revoked value locks CI, the browser lane and every local staging
lane out of staging at once (they answer with the Access login page, not a 4xx from the app);
production is unaffected. Renaming either stack output silently empties the ESC key — ESC
imports an unresolvable output as nothing — which is why `infra/topology-staging.test.ts` pins
both names.

## Cloudflare Secrets Store (not GitHub secrets)

#912 PR2 moved the per-component Neon DSNs out of GitHub secrets and into the **Cloudflare
Secrets Store** (the account's default store, id `66c9bb0faef644b4a0671bb7d90d98bd`; a second
store is refused by the account plan, `maximum_stores_exceeded`). Values are managed by the
`infra/database-access` Pulumi stack (staging branch roles + composed DSNs; see its `index.ts` for
the role→secret mapping and the bootstrap/rotation runbook). This file only covers GitHub
secrets, so store secrets are listed here for the reader, not enforced by
`test_secrets_docs_consistency.py`:

| Store secret | Worker binding | Consumed by |
|---|---|---|
| `CATALOG_DATABASE_URL` | `DATABASE_URL` | `workers/catalog/wrangler.toml` `[[env.staging.secrets_store_secrets]]` → `workers/catalog/src/index.ts` (`await env.DATABASE_URL.get()`) |
| `CATALOG_DATABASE_URL_PROD` | `DATABASE_URL` | `workers/catalog/wrangler.toml` `[[env.production.secrets_store_secrets]]` → `workers/catalog/src/index.ts` |
| `USERS_DATABASE_URL` | `DATABASE_URL` | `workers/users/wrangler.toml` `[[env.staging.secrets_store_secrets]]` → `workers/users/src/index.ts` |
| `USERS_DATABASE_URL_PROD` | `DATABASE_URL` | `workers/users/wrangler.toml` `[[env.production.secrets_store_secrets]]` → `workers/users/src/index.ts` |
| `AGENT_SVC_DATABASE_URL` | `AGENT_SVC_DATABASE_URL` | `workers/edge/wrangler.toml` `[[env.staging.secrets_store_secrets]]` → two consumers of the one binding: `workers/edge/src/container/container-env.ts` (forwarded into the agent container) and, from W1 (#1251), the edge Worker itself in `workers/edge/src/db/agent-database.ts` (the agent turn tier reads Neon directly) |
| `AGENT_SVC_DATABASE_URL_PROD` | `AGENT_SVC_DATABASE_URL` | `workers/edge/wrangler.toml` `[[env.production.secrets_store_secrets]]` → the same two consumers (W4-1, #1314) |

Bindings are declared per environment in `wrangler.toml` (`secrets_store_secrets` is
non-inheritable) and are applied automatically by `wrangler deploy` — no CI secret upload step
exists for them. The fail-closed guard is the binding itself: a missing store id/secret fails
the deploy API call, and `env.<binding>.get()` throws at runtime if the secret is ever deleted.
Note that `secrets.required` must NOT list a name that is also a Secrets Store binding —
wrangler rejects a name assigned to both binding types.

Catalog, users and the agent service all have distinct staging and `_PROD` store secrets because
both environments share one Cloudflare store — the account plan refuses a second, so the secret
name is the only thing separating the two environments' credentials. Their runtime DSNs are
bindings in both environments; CI does not upload them.

The agent-service binding was staging-only until W4-1 (#1314), which provisioned the production
`agent_svc` DSN through the `infra/database-access` prod stack and bound it on the production edge
Worker. Landing the binding changed no runtime behaviour: `AGENT_TURN_ROUTE` stays `"container"` in
production, so the binding only moves where the container's DSN comes from, and production edge
still receives `SUPABASE_DB_URL` through the exact core bulk payload until the cutover's later step
retires it (`docs/ops/prod-dsn-cutover.md`). Local dev is unchanged (`.dev.vars`) and binds no store
secret at all, which is why `AGENT_SVC_DATABASE_URL` is not in `CONTAINER_REQUIRED_KEYS`.

## Adding a new secret

Pick the matching chain above. A new **runtime** secret does not go through CI at all: declare it
in `infra/database-access` as a `cloudflare.SecretsStoreSecret`, bind it in the consuming Worker's
`wrangler.toml`, add the matching `CONTAINER_ENV_KEYS` entry if the container needs it, and record
it in this inventory. Do not add it to a workflow, and do not use `cloudflare/wrangler-action`'s
`secrets:` input — `test_cd_shape_contract.rb` fails the build if either appears. A **CI-plane**
credential (something a job itself must present, like the Cloudflare deploy token) belongs in the
matching Pulumi ESC environment. For a non-secret Wrangler var, use `ANON_DAILY_COST_BUDGET_USD`
as the reference.

## Handling

- Never paste a value into chat, a PR body, an issue, or a commit message. This repository
  has burned two secrets that way (a Turnstile secret on 2026-07-26, a Logfire read token
  on 2026-07-29) — in both cases the leak happened while *reporting* a rotation.
- Shared-environment deploys are **CD-only**. Developers must not run deployment commands from a
  workstation; the reviewed main-only `cd.yml` promotion is the supported write path. Secret
  *writes* are no longer a CD action at all: CI uploads no runtime secret (#1364), and Pulumi
  provisions the Secrets Store entries from Pulumi ESC. Until #1370 lands, rotating one of the
  eight edge runtime secrets is an owner-run `wrangler secret put` against the target Worker.
- Keep values out of process arguments in every approved provisioning path. A GitHub secret
  body-file/stdin interface (for example, `openssl rand -hex 32 | gh secret set <NAME>
  --body-file -`) avoids placing the value in argv; this is CI/admin automation guidance, not a
  command for developer workstations. A `--body "..."` value can be exposed through process
  listings, `/proc`, shell tracing, or persisted command history. Stdin avoids argv exposure but
  does not make the value public-proof, so never echo it or write it to a shared file.
- When a value must be identified, quote a prefix and a length (`pylf_v…[55 chars]`), never
  the whole thing.
- Non-TTY Wrangler secret writes can create a missing Worker — a `wrangler secret put` against a
  mistyped name silently provisions an empty Worker under it. That is one of the reasons CI no
  longer writes secrets at all; when the owner rotates one by hand, check the Worker name first.
