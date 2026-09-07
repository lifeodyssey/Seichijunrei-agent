# Deployment

This is the canonical deployment runbook for the current runtime.
The old root `DEPLOYMENT.md` compatibility pointer was removed in iter6 A6 (#640); this file is the only deployment runbook.

This file covers non-secret runtime config. For what each GitHub secret is, who consumes it,
and rotation impact, see [`secrets.md`](./secrets.md).

## Delivery architecture

There are exactly two automatic delivery entry points:

- `.github/workflows/pr-verification.yml` (`CI`) validates pull requests and merge-queue heads.
- `.github/workflows/cd.yml` (`CD`) deploys only a push to `main`.

There is no tag-triggered or manually dispatched deployment path. The protected branch requires
exactly `PR Verification` and `Security`. The first aggregates every selected CI
gate, `Security` directly aggregates changed-secret scans and affected security tools, and the last
plus native review-thread resolution; the merge gate is documented in [`review-gate.md`](./review-gate.md).

### Affected-only PR CI

The affected set is pnpm's, not ours. `plan` runs
`pnpm ls -r --depth -1 --json --filter "...[<merge-base>]"`, which selects every workspace project
whose files changed plus every dependent of one, and subtracts the three projects that own a job of
their own: the root project (no lint/typecheck/test scripts), `@animichi/agent` (its `test` is
`uv run pytest`), and `animichi-e2e` (its `test` is the browser suite). Every selected package
becomes one `affected` matrix leg running that package's own `lint`, `typecheck`, `test` and
`test:integration`. There is no component manifest and no second router: a package's lane is its
own `package.json`, which is also what `pre-push` runs.

Four paths sit outside the package graph and are routed by `dorny/paths-filter` instead:
`apps/agent/**` and `packages/contract/**` (the Python `agent` job), `apps/web/**`, `e2e/**` (the
browser job), `migrations/neon/**` (the schema job), and the root dependency files, whose change
means "every package" because pnpm answers a root-lockfile change with the root project alone.
The six security jobs are never path-gated. `PR Verification` and `Security` each aggregate their
dependencies with `always()` and fail on any failed or cancelled one.

### Build once, promote the same artifact

On a `main` push, `CD` selects the affected set from the exact `github.event.before..github.sha`
range with the same pnpm filter. Two guards sit in front of it: a zero or unreachable `before`
(first push, force push, rewritten history) falls back to `HEAD~1`, and `github.sha` must still be
the head of `origin/main`, so re-running a run that a newer push has overtaken deploys nothing.

One `build` job produces ONE artifact, `release-<sha>`, a tar of everything this push deploys: the
web output, the four Worker bundles with their deploy-time configs, the migration chain, and the
sealed Pulumi programs. Container images are built with `docker/build-push-action` and pushed to
`registry.cloudflare.com` under the single tag `sha-<sha>`; the image reference is written into the
shipped Wrangler config once, at build time, and never re-tagged. Its `artifact-digest` is recorded
in the job summary. Staging and production both download that one artifact —
`promote-production` has no build step at all.

The ordered stages are foundation, migration, services, edge, and web, each publishing with
`cloudflare/wrangler-action` and `deploy … --tag sha-<sha>` so `wrangler versions list` names the
commit a running version came from. A stage whose unit was not affected is skipped without
weakening the order; every stage lists every earlier stage in `needs`, so a real failure cannot
evaporate into a skip on the way down the chain. `smoke` then probes the two staging surfaces
(#1198), and one `production` environment approval releases the same artifact.

Three contracts guard this, each owning one question.
`.github/scripts/test_cd_shape_contract.rb` is the job graph: one build, one artifact, the `needs`
chains, the concurrency groups, the pairing rules, and push-to-main as the only trigger.
`test_cd_publish_contract.rb` is how it publishes: the pinned Wrangler, the `sha-<sha>` tag, the
environment each job may target — through the action **and** through a shell, because
`pnpm exec wrangler deploy … --env production` in a staging stage would go live with no approval
and touch no action input — and that the smoke probe's exit code is what decides its job.
`test_cd_credential_boundary_contract.rb` is what the pipeline may hold: the Pulumi token type and
ESC export list, no retired backend credential, no runtime-secret upload. All three run in CI's
`contracts` job and in `scripts/local-gates/quality.sh`.

Concurrency is per job, not per workflow: `cd-staging` covers the five stages and the smoke probe,
`cd-production` covers the promotion. A run parked at the production approval gate no longer holds
the staging lane (#1204, #1325). Both groups set `cancel-in-progress: false` and `queue: max`, so up
to 100 pending jobs queue in order instead of cancelling the one already waiting.

## Edge Topology

```text
Browser
  ├─ static paths ───────────────────────────────▶ Cloudflare ASSETS
  ├─ /img/* ─────────────────────────────────────▶ Worker image proxy/cache
  ├─ /healthz ───────────────────────────────────▶ Worker → RuntimeContainer → FastAPI service
  ├─ /catalog/* ─────────────────────────────────▶ Worker → CATALOG service binding → catalog Worker
  │                                                          └─ Neon Postgres/PostGIS via neon-http (`DATABASE_URL`)
  └─ /v1/* ── auth at Worker edge ───────────────▶ Worker → RuntimeContainer → FastAPI service
                                                            ├─ Neon Postgres (`AGENT_SVC_DATABASE_URL`)
                                                            ├─ catalog read path (`CATALOG_API_URL` → /catalog/*)
                                                            └─ MiMo primary (`MIMO_API_KEY`)
                                                               └─ DeepSeek fallback temporarily disabled
                                                                  (`DEEPSEEK_API_KEY` remains provisioned)
```

The hybrid topology runs the edge Worker plus the catalog and users Workers. The main `seichijunrei` Worker
(`workers/edge/src/entry.ts`) routes `/catalog/*` to the separate `catalog` Worker
(`workers/catalog/wrangler.toml`) via a wrangler service binding (`env.CATALOG.fetch`).
The Python agent in the container cannot use that JS-only binding, so it reaches
the catalog over the public origin: `CATALOG_API_URL` (forwarded into the
container as a plain var) points at the deployed host, and `CatalogClient` POSTs
to `{CATALOG_API_URL}/catalog/<method>`, which the main Worker forwards to the
catalog Worker. Deploy order: catalog Worker first (so `service = "catalog"`
resolves), then the main Worker.

Catalog and users Workers query Neon through Drizzle's `neon-http` driver, which supplies their
runtime query/type metadata. The checked-in Atlas directory is the only Neon schema authority for
all three. See
[`migrations.md`](./migrations.md) before changing a table or deploy step.

Agent HTTP surface (paths relative to `apps/agent/src/animichi/`):

- `interfaces/fastapi_service.py` / `interfaces/routes/health.py` — `GET /healthz`
- `interfaces/routes/runtime.py` — `POST /v1/runtime` and `POST /v1/runtime/stream` (SSE)
- `interfaces/routes/feedback.py` — `POST /v1/feedback`
- `apps/agent/Dockerfile` packages the agent into a single container image

The deployment target stays intentionally thin. The Worker owns routing and edge auth; the container runs the agent service and stays unaware of raw end-user credentials.

## Trust Boundaries

| Layer | Responsibility | Secrets/config it should see |
|---|---|---|
| Web app (`apps/web`) | SSR browser surface, deployed as its own Worker on its own route | none of this Worker's secrets |
| Worker edge | Route match, JWT auth, identity injection | `NEON_AUTH_JWKS_URL` |
| Container runtime | Backend service, DB, model/provider calls | `AGENT_SVC_DATABASE_URL`, `MIMO_API_KEY`, `DEEPSEEK_API_KEY`, `CORS_ALLOWED_ORIGIN`, optional observability keys |

Current hardening rule: the Worker strips the raw `Authorization` header before proxying and forwards only trusted `X-User-Id` / `X-User-Type` identity headers to the container.

## Auth Flow

Worker auth is implemented in `workers/edge/src/identity/auth.ts`:

- JWT flow: `authenticate()` verifies the token signature locally against the branch's Neon Auth JWKS (jose `createRemoteJWKSet`, cached per isolate) — no per-request round-trip to the auth origin. AUTH-2 #950 hard cut: `NEON_AUTH_JWKS_URL` is the edge's ONLY identity source; issuer/audience are derived from it (EdDSA), and the injected `X-User-Id` is the token `sub`.
- Production JWKS is unset — the production edge Worker fails closed on any bearer until its Neon Auth branch is provisioned.
- `sk_*` API keys are gone (AUTH-1 #945): an `sk_*` Bearer token is rejected as invalid — there is no `api_keys` lookup and no "agent" identity class.
- Forwarding flow: the Worker injects `X-User-Id` and `X-User-Type`, deletes `Authorization`, and proxies the request to `CONTAINER` (unchanged); `/v1/users/*` goes to the `USERS` service binding with the same identity headers (users trusts only the edge-forwarded identity).

Auth expectations:

- `/v1/*` always requires `Authorization: Bearer ...`
- `/healthz` and static assets bypass auth
- the container trusts only the Worker-injected identity headers; it is not the auth enforcement point

## Local Service Run

Install dependencies and start the service:

```bash
uv sync --extra dev
make serve
```

Default bind settings:

- `SERVICE_HOST=0.0.0.0`
- `SERVICE_PORT=8080`

## Environment by Boundary

### Worker edge

Required at deploy time:

- `NEON_AUTH_JWKS_URL` (staging; production unset — fails closed until its Neon Auth branch is provisioned)

These secrets stay in the Worker environment and are not forwarded into the container runtime. The edge JWT path verifies against the branch's public JWKS — no Supabase/anon key is involved (AUTH-2 #950).

### Container runtime

Required:

- `AGENT_SVC_DATABASE_URL` — the Postgres DSN (#995: the `SUPABASE_DB_URL` fallback
  was deleted from settings). The role-scoped Neon DSN (`agent_svc` role) is supplied
  via the edge Worker's Secrets Store binding and forwarded into the container. The legacy
  `SUPABASE_DB_URL` name remains only as a **transitional container-DSN env name** (a Neon DSN,
  not a live Supabase plane) pending the #855 rename; see `docs/ops/prod-dsn-cutover.md`.
- `MIMO_API_KEY` for the primary `mimo-v2.5` model
- `DEEPSEEK_API_KEY` remains deploy-required and provisioned for the dormant DeepSeek fallback
- `APP_ENV` — forwarded from `wrangler.toml`'s per-environment `[vars]` block (`development` /
  `staging` / `production`), NOT a GitHub secret. Fail-closed since issue #498: the Worker throws at
  container-start if it is missing rather than seeding a hardcoded default, because a silent default
  previously tagged every environment's Logfire traces as `production` regardless of which
  environment actually deployed them.

  **There is a second, unrelated `APP_ENV`** — `apps/web/wrangler.jsonc`'s per-env `vars`, read by
  `apps/web/src/server/noindex-plugin.ts`. Same name, same meaning, **opposite behaviour when
  absent**: the container's is fail-**closed** (throw), the web app's is fail-**open-to-noindex**
  (assume non-production and send `X-Robots-Tag`). Both directions are deliberate — a mislabelled
  trace is cheap, a live site that stops sending `noindex` is not, and neither is a live site that
  starts. Do not "unify" them without deciding which cost you are choosing. Guarded by
  `apps/web/tests/unit/wrangler-app-env.test.ts`, which also pins the top-level block: its `name` is
  the production Worker, so a `wrangler deploy` without `--env` would otherwise publish to
  production with no `APP_ENV` and silently deindex the site.

- `EDGE_SHOWCASE_MODE` — edge-only `[vars]` (NOT forwarded to the container, NOT a GitHub secret),
  the worker-side half of "prod is a landing-only showcase" (GOAL C): `"true"` (production) makes
  every functional route (`/v1/*`, `/v1/users/*`, the public catalog read) answer 403
  `showcase_denied` before any binding is touched, while `/healthz`, `/img/*`, `/tiles/*` stay
  reachable. Strict boolean like `VITE_SHOWCASE_MODE`: only the literal `"false"` opens the
  backend — unset/empty/malformed values fail closed (deny) with a one-per-isolate warning. Pinned
  by `workers/edge/test/container-env.test.ts`. Until automatic smoke debt is repaid, the owner
  verifies the same denial during the manual staging/production smoke.

Production is temporarily MiMo-only while the DeepSeek account has insufficient balance. After
recharging DeepSeek, set `FALLBACK_AGENT_MODEL=deepseek:deepseek-v4-flash` to re-enable the already
provisioned fallback path.

Common runtime config:

- `CORS_ALLOWED_ORIGIN`
- `DEFAULT_AGENT_MODEL`
- `FALLBACK_AGENT_MODEL` (empty by default for MiMo-only operation)
- `LOG_LEVEL`
- `MAX_RETRIES`
- `TIMEOUT_SECONDS`
- `OBSERVABILITY_SERVICE_NAME`
- `OBSERVABILITY_SERVICE_VERSION`
- `LOGFIRE_TOKEN` (optional — tracing/metrics export to Logfire only when set). Since issue #498,
  production and staging each write to their own Logfire project (`animichi-prod` /
  `animichi-staging`) via **GitHub Environment-scoped secrets of the same name**
  (`LOGFIRE_TOKEN` defined directly on the `production` and `staging` GitHub Environments), not
  via workflow-level branching. Staging promotion and the single production promotion both run
  under their job-level `environment:`, and GitHub environment secrets take precedence over a same-named secret the
  caller workflow explicitly passes through `secrets:` for a job that references that environment
  — see [Reuse workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
  ("If you include environment in the reusable workflow at the job level, the environment secret
  will be used, and not the secret passed from the caller workflow"). This was confirmed empirically
  against this repo's real GitHub Actions runners with a throwaway diagnostic workflow (three
  differently-sized marker secrets — repo-level, `production`-environment, `staging`-environment —
  each job resolved the environment-scoped one, not the repo-level one the caller passed): staging
  resolved the staging marker, production resolved the production marker, in both cases overriding
  what the caller's `secrets: LOGFIRE_TOKEN: ${{ secrets.LOGFIRE_TOKEN }}` line explicitly passed.
  The repo-level `LOGFIRE_TOKEN` secret remains only as the implicit fallback for a hypothetical
  environment with no `LOGFIRE_TOKEN` secret of its own (same convention already relied on for the
  8-9 other secrets — `CLOUDFLARE_API_TOKEN`, `NEON_DATABASE_URL`, `PULUMI_*`, `R2_*`,
  `NEON_AUTH_JWKS_URL` — that are defined both at repo level and per-environment).
- `CORS_ALLOWED_ORIGIN` is defined as a **`production`-environment secret** (no repo-level copy) —
  by the same precedence rule above, it was already reaching the container correctly in production
  deploys. Staging gets its value a different way (#527/#528): `wrangler.toml`'s
  `[env.staging.vars].CORS_ALLOWED_ORIGIN` sets it to the real staging web origin
  (`https://animichi-web-staging.zhenjiazhou0127.workers.dev`) as a plain (non-secret) value, not a
  GitHub secret — a domain name isn't a secret, and this needs no owner action to provision. Do
  **not** add a `CORS_ALLOWED_ORIGIN` secret to the `staging` GitHub Environment: it is no longer
  in `deploy-root-staging`'s `worker_secrets` list, so such a secret would be dead (unread), and if
  it were ever added back to that list later, the secret would silently override the wrangler var,
  reintroducing a second source of truth. Before #527/#528, staging had neither the secret nor the
  var, and inherited APP_ENV's mislabeling as "production" (see above) — which made
  `cors_allowed_origin`'s `"*"` default fail the production-strictness CORS check and **crash the
  container at boot** rather than silently accept a wildcard origin; #527/#528 fixed this at the
  `wrangler.toml` layer, independent of the APP_ENV fix in this same issue.
- `GOOGLE_MAPS_API_KEY` (optional)
- `ANON_DAILY_COST_BUDGET_USD` (optional — the global anonymous daily-dollar circuit breaker, X4/#274; `0` disables it)
- `ANON_DAILY_MESSAGE_QUOTA` (optional — the per-identity anonymous daily message quota, S1.10/#282, a fairness/UX mechanism rather than a defense line; `0` or unset disables it, same convention as the budget ceiling above)

Session storage:

- the backend currently uses the in-memory session store only

## Container Path

Build the image locally:

```bash
docker build -t seichijunrei-runtime .
```

Run the image locally:

```bash
docker run --rm -p 8080:8080 \
  -e AGENT_SVC_DATABASE_URL \
  -e MIMO_API_KEY \
  -e DEEPSEEK_API_KEY \
  -e CORS_ALLOWED_ORIGIN \
  seichijunrei-runtime
```

Smoke test:

```bash
curl http://127.0.0.1:8080/healthz
curl -X POST http://127.0.0.1:8080/v1/runtime \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: local-dev' \
  -H 'X-User-Type: human' \
  -d '{"text":"从京都站出发去吹响的圣地"}'
```

Note: direct container access trusts forwarded identity headers. Bearer-token auth is enforced at the Worker edge, not inside the container process.

## Cloudflare Workers + Containers Path

Production runs on Cloudflare Workers + Containers (backed by a Durable Object container class).
`wrangler deploy` builds the image from `Dockerfile`, uploads it to Cloudflare's container registry, and wires it to `RuntimeContainer`.

Requirements:

- Wrangler 4+ (`[[containers]]` is ignored by Wrangler 3)
- GitHub Actions uses `cloudflare/wrangler-action@v4` with `wranglerVersion: "4.79.0"`
- This repo deploys from the checked-in `Dockerfile`; there is no GHCR handoff

Routing defined by `wrangler.toml`:

- `/v1/*` and `/healthz` run through the Worker and proxy to `CONTAINER`
- `/v1/users/*` goes to the `USERS` service binding, trusting only the edge-forwarded identity headers (it no longer verifies its own JWT — AUTH-2 #950)
- `/catalog/public/anime-overview/:id` is the one allowlisted anonymous catalog read
- `/img/*` runs through the Worker image proxy/cache
- everything else answers a JSON `404 not_found`

<!-- historical: retired in #537 -->
Issue #537 removed the bundled legacy static frontend and with it the `[assets]` binding: this
Worker has **no** HTML surface. `apps/web` (TanStack Start) deploys as its own Worker and owns
every page. Route ownership for the apex is declared in Pulumi (`infra/index.ts`, #541): until
`webRoutesEnabled` is on, the root Worker may have no public hostname at all
(`workers_dev = false`). `apps/web` owns HTML on its Worker hostname; the root Worker is API +
proxy only (`/v1/*`, `/healthz`, `/img/*`, `/tiles/*`, one public catalog read).

## Deploy Sequence

There is one workflow-backed deploy path: the main-only `CD` workflow. It is not tag-triggered or
manually dispatched.

### Schema change policy

Neon migrations run from `migrations/neon/` before the Worker rollout, but the old container can
still serve traffic while that step is running. A destructive change can therefore briefly break
old code that still reads or writes the removed schema; the `route_anime` release, for example,
dropped `routes.bangumi_id` in the same release that changed the writer. For schema changes where
that overlap matters, use expand/contract: add the replacement first, deploy compatible readers
and writers, then remove the old column in a later release. Today’s infrequent, approval-gated
cadence keeps this window low-risk, but it does not make destructive same-release changes safe by
construction. The full authoring/apply boundary is [`migrations.md`](./migrations.md).

### Migration promotion

The artifact carries the committed `migrations/neon/` chain and `atlas.sum` under
`release/migrations/`. Staging applies it through the **migrator Worker**: `stage-migration` runs
`scripts/delivery/migrate-through-worker.sh staging`, which reads the sealed head, exchanges the
job's GitHub OIDC identity for a token scoped to `animichi:github-actions:migrator`, and POSTs
`/migrate` with that head. CI holds no database credential on this path, not even a short-lived one.

Production goes the same way (#1365): `promote-production` refuses a sealed chain carrying a
`STAGING_ONLY_BASELINE` marker, deploys the migrator Worker with `--env production`, then runs
`scripts/delivery/migrate-through-worker.sh production` against `vars.MIGRATOR_PRODUCTION_URL`.
That Worker is a separate deployment with a separate DSN (`MIGRATOR_DATABASE_URL_PROD` in the
shared Secrets Store) and a separate OIDC allowlist selected by its `MIGRATOR_OIDC_POLICY` var, so
a token minted by the staging job cannot open it. The transitional Atlas step and
`secrets.NEON_DATABASE_URL` are gone with it: CI now holds no database credential at all.

Both environments run the same handshake first, because `wrangler deploy` returning is not the new
bundle serving (#1332): the script polls `GET /healthz` until the `bundleHead` the Worker reports
is the sealed head (12 attempts, 5s apart), and retries a bounded number of times if the Worker
answers `409 stale_bundle` anyway.

The sealed head is also the ceiling of the apply: the Worker applies the carried chain only through
the head the script asked for, so a run can never leave the database further ahead than the chain it
sealed. A database already standing past that head is answered `422` with nothing applied — unlike
the `409`, that refusal is terminal and the script does not re-poll it.

Expand/contract compatibility remains mandatory because schema promotion precedes consumers and a
Worker rollback does not reverse an applied migration. For provisioning or recovery checks, follow
[`migrations.md`](./migrations.md) and [`neon-backup-rpo.md`](./neon-backup-rpo.md); do not infer
database state from a green build.

### Main-only affected promotion (`.github/workflows/cd.yml`)

A push to `main` is the only deployment trigger. `plan` resolves the range and the affected package
set (see "Build once, promote the same artifact" above); `build` produces the single
`release-<sha>` artifact; the five stages publish it to staging in order; `smoke` probes staging;
`promote-production` publishes the same artifact after the approval.

Which stage runs is three pairing rules and nothing else:

| stage | runs when |
|---|---|
| `stage-foundation` | `infra/**` changed |
| `stage-migration` | the `migrator` package is affected, **or** `migrations/neon/**` changed — the migrator image bakes the chain (`workers/migrator/Dockerfile`), so a migrations-only push rebuilds and redeploys the Worker rather than POSTing a new head to one carrying the old chain |
| `stage-services` | the `catalog` or `users` package is affected |
| `stage-edge` | the `edge-worker` package is affected, **or** `apps/agent/**` changed — the edge Worker carries the agent container image, so the two ship together until W4 removes the image |
| `stage-web` | the `web` package is affected |

A push that deploys nothing (documentation, a library package with no deployable dependent) skips
`build` and every stage, so it never reaches the production approval.

The two `**or**` rows above are the pipeline's only pairing rules, and they exist because those
units take an input from outside their own pnpm project. Every step that publishes one carries both
halves of its condition, not just the job — a migrator image built without the migrations half would
be the old chain under a new tag. `test_cd_shape_contract.rb` fails if either half goes missing.

`smoke` probes `https://animichi-staging.zhenjiazhou0127.workers.dev/healthz` and the SSR shell at
`https://animichi-web-staging.zhenjiazhou0127.workers.dev/`, retrying 8 times at 15s. It probes
workers.dev rather than the zone hostname because GitHub-runner IPs get a managed challenge at the
zone front door and Bot Fight Mode cannot be skipped on the Free plan. The container cold-starts on
roughly every deploy (measured at 24.5s), so the retry window has to outlast cold start plus agent
boot, not just route propagation. A red smoke blocks `promote-production` (#1198).

`promote-production` requests the single GitHub `production` environment approval, then deploys the
same artifact. It does not check out another revision, rebuild a unit, or re-tag an image; the
bytes production starts are the bytes staging was smoke-checked on. Rejecting the approval fails
that run and nothing else. There is no manual or tag-triggered alternative.

**CF Worker routing** (`workers/edge/src/app.ts`):
- `/v1/*` and `/healthz` → `CONTAINER` (Durable Object → FastAPI service on port 8080)
- `/v1/users/*` → `USERS` service binding
- `/catalog/public/anime-overview/:id` → allowlisted anonymous catalog read
- `/img/*` → image proxy + cache
- Everything else → JSON `404 not_found` (no asset/page fallback since #537)

### Pulumi state, encryption, and CI identity (#1077, #1078)

Both Pulumi projects — `seichijunrei-infra` (`infra/`) and `animichi-neon-secrets`
(`infra/database-access/`) — keep their state and their `secure:` encryption in **Pulumi Cloud**,
organization `lifeodyssey`. `backend.url` in each `Pulumi.yaml` is the source of truth for that.

No long-lived Pulumi access token is stored in GitHub secrets. `stage-foundation` and the
`promote-production` infra step run `pulumi/auth-actions`, which exchanges the job's GitHub OIDC
identity for a short-lived Pulumi Cloud **personal** token scoped to user `lifeodyssey` (the action
input `scope: user:lifeodyssey`). `lifeodyssey` is an individual-edition organization, and Pulumi
Cloud rejects organization tokens for non-enterprise organizations (`Org tokens are not supported
for non enterprise organizations`), so an organization token type cannot be used here. The Pulumi
Cloud OIDC issuer policy for this GitHub issuer must therefore carry a **personal** token-type
policy authorizing that user. The exchanged token is exported as `PULUMI_ACCESS_TOKEN` for the rest
of that job only. Those two jobs therefore carry
`id-token: write`, and `pulumi/actions` fails when that token is absent. Applies are
organization-qualified (`pulumi up --stack lifeodyssey/<stack>`, the action's `stack-name` input) so
a token that defaults elsewhere cannot land the apply in another organization. `PULUMI_BACKEND_URL`,
`PULUMI_CONFIG_PASSPHRASE`, and the two R2 state keys are no longer read anywhere on the delivery
lane.

Immediately after that login, each of the two jobs opens the matching **Pulumi ESC** environment
with `pulumi/esc-action` — `lifeodyssey/animichi/staging` for the staging foundation phase,
`lifeodyssey/animichi/prod` for the production infra step — and that is where the two Pulumi-plane
credentials come from (#1078):

| ESC key | What reads it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the Cloudflare provider in both Pulumi programs. The ESC key already carries the Pulumi-scoped token, so `CLOUDFLARE_PULUMI_API_TOKEN` has no reader on the delivery lane |
| `NEON_API_KEY` | the Neon provider in `infra/database-access` (`animichi-neon-secrets`) |

Neither is a GitHub secret on the delivery lane any more. Three properties are worth stating:

- **The export list is an explicit two-name allowlist**, not the action's export-everything
  default. Whatever an ESC environment grows later cannot reach a CI job by accident, so ADR 0003
  ("no runtime DSN or model key in ESC") holds structurally rather than by convention.
- **Worker publishing never opens ESC.** Only `stage-foundation` and the `promote-production` infra
  steps run `pulumi/esc-action`; every Worker-publishing step passes
  `apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}` to `cloudflare/wrangler-action` as its own input,
  which the action uses instead of any ambient environment value. Inside `promote-production`, where
  both happen in one approval-gated job, that input wins over the job-level value ESC injected. The
  Pulumi-plane token cannot deploy a Worker, and the Worker deploy token cannot touch Pulumi state.
  Card #1367 moves the publishing token into ESC too.
- **The ESC step installs the `.pulumi.version` CLI.** `pulumi/esc-action` installs a Pulumi CLI and
  prepends it to `PATH`; left unpinned it fetches the latest release and would silently shadow the
  version `pulumi/actions` just installed. Given the same version it detects the existing install
  and downloads nothing, so a small step resolves `.pulumi.version` into the action's `version`
  input rather than duplicating the number.

**Owner step, not done by this change:** the two ESC environments must actually hold the values,
projected under `environmentVariables` — that is the section `pulumi env open --format detailed`
reads and the action injects from. `pulumi env set --secret` alone puts a value under `values`; if
it is not also referenced from `environmentVariables`, the action logs `No value found for …` and
the Pulumi apply fails on the missing provider credential. Check with
`pulumi env open lifeodyssey/animichi/staging --format detailed` (and `…/prod`) before the first
run; never paste the values anywhere. AC3 of #1078 — one staging infra and neon-secrets apply with
tokens only from ESC — is that first CD run, and it is the owner's to observe.

The pre-apply `pulumi stack export` copied into the R2 state bucket is retired: Pulumi Cloud's own
update history is the rollback record, and it does not require writing a state snapshot into the
bucket that used to hold live state.

#### One-time migration (owner, once per stack)

Agents do not run this — it needs the passphrase and an interactive Pulumi Cloud login. Run it once
per stack, from the project directory, with the campaign paused (no `main` push mid-flight).

Stacks to move: `seichijunrei-infra/staging`, `seichijunrei-infra/prod`,
`animichi-neon-secrets/staging`, `animichi-neon-secrets/prod`.

```bash
cd infra                     # or: cd infra/database-access

# 1. Export from the retiring R2 backend, using the passphrase that still owns the ciphertext.
#    The explicit `pulumi login` matters: after you have done step 2 for an earlier stack, the
#    CLI's stored login points at Pulumi Cloud, and this is what re-points it at R2. It is also
#    exactly what the retired CD code did before every apply.
#    The two secret values are read with `read -r -s` instead of being typed into an `export`:
#    an inline assignment lands the value in the shell history file and, briefly, in the process
#    list. `-s` also keeps it off the terminal. Reading them from a mode-600 file works too.
export PULUMI_BACKEND_URL='<the retiring s3:// R2 backend URL>'
export AWS_ACCESS_KEY_ID='<R2 state key id>'
export AWS_DEFAULT_REGION=auto
read -r -s -p 'Pulumi config passphrase: ' PULUMI_CONFIG_PASSPHRASE && echo
read -r -s -p 'R2 state secret: ' AWS_SECRET_ACCESS_KEY && echo
export PULUMI_CONFIG_PASSPHRASE AWS_SECRET_ACCESS_KEY
pulumi login "$PULUMI_BACKEND_URL"
pulumi stack select <stack>
pulumi stack export --file "/tmp/$(basename "$PWD")-<stack>.json"   # no --show-secrets, ever

# 2. Log into Pulumi Cloud and create the destination stack under the org. PULUMI_BACKEND_URL
#    must be unset first: it takes precedence over both the stored login and Pulumi.yaml's
#    backend.url (measured on Pulumi 3.255.0, the version .pulumi.version pins).
unset PULUMI_BACKEND_URL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION
pulumi login                                        # https://api.pulumi.com
pulumi stack init lifeodyssey/<stack>

# 3. Import the checkpoint, then re-encrypt the stack's `secure:` values under Pulumi Cloud's
#    provider. change-secrets-provider needs the OLD passphrase to read the existing ciphertext,
#    so keep PULUMI_CONFIG_PASSPHRASE exported until this command has succeeded.
pulumi stack import --file "/tmp/$(basename "$PWD")-<stack>.json" --stack lifeodyssey/<stack>
pulumi stack change-secrets-provider default --stack lifeodyssey/<stack>
unset PULUMI_CONFIG_PASSPHRASE

# 4. Verify: a clean preview against Pulumi Cloud with no passphrase in the environment.
pulumi preview --stack lifeodyssey/<stack>
```

Step 3 rewrites `Pulumi.<stack>.yaml` in the working tree — the `encryptionsalt` line disappears and
each `secure:` value is replaced by Pulumi Cloud ciphertext. Commit those four files as a normal
reviewed change. `infra/database-access/Pulumi.prod.yaml` has no encrypted material today, so its
`change-secrets-provider` is a no-op; run it anyway so all four stacks end on the same provider.

Until every stack is imported, the rollback path is the old one: re-point `PULUMI_BACKEND_URL` at
R2 and restore the export taken in step 1. After the cutover, rollback is Pulumi Cloud history.
Deleting the GitHub secrets themselves is #1081, not this step.

## WAF and Edge Hardening

Manual Cloudflare dashboard steps live in `docs/ops/cloudflare-hardening.md`.
That runbook covers:

- `/v1/*` rate limiting
- coarse prompt-injection WAF filters
- rollback steps for over-blocking rules
- the future AI Gateway insertion point

The edge's layered rate-limit rollback procedure (native vs durable tiers, and
the rate-policy decision table) is `docs/ops/rate-limit-rollback.md`; it belongs
next to any `/v1/*`-rate-limiting incident run.

## AI Gateway Insertion Path

If AI Gateway is enabled later, it belongs between the container and the upstream model provider.
It does not belong in the browser and does not belong in the Worker.

Planned env design:

- `CLOUDFLARE_AI_GATEWAY_URL` as an optional container-only env

Important: this is a documentation target only right now. Before enabling it, the backend planner client must support provider base-URL override through env rather than assuming the provider default.

## Rollback

Rollback is incident recovery, not a second deployment path. There is no rollback workflow: the
hand-written one was deleted with #1364 because Cloudflare already keeps every published version.
Recovery is `wrangler rollback`, run by the owner from a laptop, against one Worker at a time. No
workflow and no agent runs it — `CD` only ever moves forward (spec §二).

### The five Workers, by environment

| unit | staging Worker | production Worker |
|---|---|---|
| catalog | `catalog-staging` | `catalog` |
| users | `users-staging` | `users` |
| migrator | `migrator-staging` | added by #1365 (`workers/migrator/wrangler.toml` has no `[env.production]` before it) |
| edge (carries the agent container image) | `animichi-staging` | `animichi` |
| web (SSR) | `animichi-web-staging` | `animichi-web` |

The names are `[env.<stage>].name` in `workers/catalog/wrangler.toml`, `workers/users/wrangler.toml`,
`workers/migrator/wrangler.toml`, `workers/edge/wrangler.toml` and `apps/web/wrangler.jsonc`.
`wrangler rollback` addresses the deployed Worker by name, so always pass `--name` rather than
relying on a config file and `--env`.

### 1. Find the version

```sh
pnpm exec wrangler versions list --name <worker>
```

It prints the **10 most recent** versions with their `Version ID`, `Created`, and `Tag`. From #1364
on, every `CD` deploy tags the version it publishes `sha-<sha>`, so the tag is the commit the
version was built from: pick the last version whose tag is a commit you trust. Versions published
before that card carry `Tag: -` and are only identifiable by timestamp.

The rollback window is wider than the listing. Cloudflare: "You can only roll back to the 100 most
recently published versions", and "When using Wrangler in interactive mode, you can select from up
to 100 recent versions"
([rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/)).
So for anything older than the 10 the CLI prints, run `wrangler rollback --name <worker>` with no
version id and pick from the interactive list, or read the ids off **Workers & Pages → your Worker →
Deployments** in the dashboard. The listing window slides with every deploy — measured on
`catalog-staging` on 2026-09-07, one new deploy moved the earliest listable version from
`2026-09-06T15:40:27Z` to `2026-09-06T18:54:36Z` — so "not in `versions list`" does not mean "cannot
roll back to".

### 2. Roll back

```sh
pnpm exec wrangler rollback <version-id> --name <worker> -y --message "<why>"
```

`--message` is the incident record; wrangler's prompt caps it at 120 characters ("Please provide an
optional message for this rollback (120 characters max)"). The Cloudflare docs say that specifying it
skips both the confirmation and the message prompt, and they do not list `-y` among `rollback`'s
options at all — wrangler 4.114.0 nonetheless accepts `-y, --yes` (`wrangler rollback --help`). What
the drill below actually captured, with `-y --message` on both runs: the message prompt still printed
once, on the roll-back run, and resolved itself ("Using default value in non-interactive context:
…"); the confirmation prompt still printed once, on the roll-forward run, and the command completed
without waiting. Pass both flags — between the two of them nothing in either run needed a terminal.
Omitting `<version-id>` rolls back to "the version uploaded before the latest version"
([wrangler](https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback)), which is
the usual incident case, but naming the id is what makes the step reviewable afterwards.

### 3. Verify

```sh
pnpm exec wrangler deployments list --name <worker>
```

The newest entry is last: it carries your `--message` and `(100%) <version-id>`. A rollback creates a
new **deployment**, not a new version — `versions list` is byte-for-byte unchanged after one, so
never verify a rollback with `versions list` alone.

Then check health on a route that actually exists for that Worker:

- edge: `https://animichi-staging.zhenjiazhou0127.workers.dev/healthz` — the same URL `CD`'s `smoke`
  job probes.
- web: `https://animichi-web-staging.zhenjiazhou0127.workers.dev/` — the SSR shell, `smoke`'s second
  probe.
- migrator: `GET $MIGRATOR_STAGING_URL/healthz` (the workflow variable of that name). Today it
  answers `{status, service, env}` (`workers/migrator/src/create-app.ts`) — it does not yet say which
  migration chain the Worker carries; #1365 adds `bundleHead` to that response.
- catalog and users: **no public host** — both configs set `workers_dev = false` and are reached only
  through the edge's service bindings. Verify them with `deployments list` plus a request through the
  edge (`/catalog/public/anime-overview/:id` for catalog, an authenticated `/v1/users/*` call for
  users). A probe of `catalog-staging.<subdomain>.workers.dev/healthz` returns 404 no matter which
  version is deployed; that 404 is the absent host, not a failed rollback.

### 4. Roll forward

The same command with the newer version id. There is no separate "undo": rolling forward is a
rollback to a later version, and it appends another deployment with its own message.

### What a rollback does and does not restore

A version "captures the complete state of your Worker at a point in time: its bundled code, static
assets, bindings, and compatibility settings"
([versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/)), so
the target version's binding declarations return with its code. What does not return is the state
behind them: "Resources connected to your Worker will not be changed during a rollback", and "State
changes for associated storage resources such as KV, R2, Durable Objects, and D1 are not tracked with
versions". Concretely, a rollback does not:

- reverse an applied Neon migration — schema promotion precedes consumers, which is why
  expand/contract is mandatory (see "Migration promotion" above);
- undo a Durable Object class lifecycle change. Cloudflare **refuses** the rollback outright when a
  DO class lifecycle change (via exports or the legacy `migrations` array) happened between the
  active version and the target, or when the target has a binding to an R2 bucket, KV namespace, or
  queue that no longer exists. Plan a code fix forward for those, not a rollback;
- restore Pulumi state (see the Pulumi paragraph below);
- change the container image on its own: a rolled-back edge Worker references the image its version's
  config named, so the agent tier follows the Worker version;
- rewind a secret. Values behind Secrets Store bindings are read live, and the version records only
  the binding. "`wrangler secret put` creates a new version of the Worker and deploys it immediately"
  ([secrets](https://developers.cloudflare.com/workers/configuration/secrets/)), so a rotation is
  itself a version; what a rollback across one does to the value is not documented and has not been
  exercised here.

Honest limit on the binding claim: it is Cloudflare's documentation, not our measurement. On
2026-09-07 the two most recent `catalog-staging` versions bound the same two Secrets Store entries
(`CATALOG_ADMIN_TOKEN`, `CATALOG_DATABASE_URL`) and the same two R2 buckets, and the last three
`animichi-web-staging` versions carried identical `APP_ENV` / `RUNTIME_CONFIG` vars — no deploy in
the window changed a binding, so a rollback *across* a binding change is still unexercised here
(spec §七 #15).

### Drill: 2026-09-07, `catalog-staging`

`catalog-staging` was serving `33fe9323-2261-466f-be22-2a66efa2ce57` (published 12:55:52Z by `CD`).

1. `wrangler rollback d4e2e9d7-2d2e-4dd7-9b26-90d0877dcfbf --name catalog-staging -y --message "C4
   drill: roll back one version"` → deployment at 14:36:35Z, `(100%) d4e2e9d7…`, message recorded.
2. `wrangler deployments list --name catalog-staging` → newest entry is that deployment;
   `versions list` still returned the same 10 versions.
3. Roll forward with the same command and `33fe9323-2261-466f-be22-2a66efa2ce57` → `SUCCESS Worker
   Version 33fe9323… has been deployed to 100% of traffic`, deployment at 14:37:02Z with message
   "C4 drill: roll forward".

Elapsed: 27 seconds from rollback to roll-forward. The drill also produced the 404 caveat above — the
health probe used, `catalog-staging.zhenjiazhou0127.workers.dev/healthz`, 404s in both states because
catalog has no public host, which is why this runbook names the edge and web URLs instead.

### After any recovery

Release artifacts are retained for 14 days, so a `CD` run older than that cannot be re-run to
redeploy; land a reviewed revert on `main` and let `CD` build a new artifact instead. Revert the bad
change on `main` so the next release restores trunk state — a rolled-back Worker is behind `main`
until you do.

For Pulumi, inspect the failed update in Pulumi Cloud's stack history and roll back from there: read
the last-good version number out of `pulumi stack history`, then `pulumi stack export --version
<version> --file state.json` and `pulumi stack import --file state.json`. A bare `pulumi stack
export` writes the *latest* checkpoint, which after a failed update is the broken one, so the version
is not optional. Follow the import with a reviewed reconciliation — the pre-apply R2 export is
retired (#1077). Never place a state export in a public GitHub artifact.

`CD`'s own `smoke` job does not run on a recovery, so the owner must manually check health and the
affected user journey after one.

## Known Limitations

- default session storage is in-memory unless a distributed backend is introduced later
- OpenTelemetry exporters are opt-in and disabled by default
- AI Gateway is documented but not yet wired in backend provider configuration
- Release identity is the artifact name `release-<sha>` plus the `artifact-digest` that
  `actions/upload-artifact` reports; artifacts are immutable, so staging and production download
  the same bytes by construction rather than by re-verifying a manifest. Runtime health metadata is
  useful diagnosis but is not the artifact authority.

## HISTORICAL (pre-2026-07): feat/ssr-cloudflare Post-deploy Notes

This section records the old feat/ssr-cloudflare merge runbook. It is not the current deployment
trigger or an executable migration procedure. **Historical only; no longer current.** The current
Neon migration authority is `migrations/neon/` applied by pinned Atlas before the Worker rollout;
use [`migrations.md`](./migrations.md) and the workflow paths above instead.

After the old feat/ssr-cloudflare merge, operators used these checks:

1. **Historical Supabase schema event (not a current apply)** — the old Supabase CLI path recorded
   these legacy schema files:
   - `20260509200000_fix_wrong_bangumi_ids.sql` — delete wrong seed IDs
   - `20260510170000_add_bangumi_platform.sql` — add platform column
   - `20260510180000_add_points_city.sql` — add city column to points

2. **Backfill city for existing points** — one-time, run after migrations:
   ```bash
   AGENT_SVC_DATABASE_URL=<production_dsn> uv run python -m backend.scripts.backfill_city
   ```
   This reverse-geocodes all points with `city IS NULL` using GeoNames data (~12MB).
   Expected: ~1000+ points across ~50 cities. Takes <30 seconds.

3. **Verify** — check a few bangumi:
   ```sql
   SELECT city, count(*) FROM points GROUP BY city ORDER BY count DESC LIMIT 10;
   ```

## Neon topology

See [neon-env-topology.md](./neon-env-topology.md) (N3 / #859).
