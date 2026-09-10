# workers/edge — AGENTS.md

TypeScript Cloudflare Worker (Hono + `@cloudflare/containers`): the **request gateway**. Owns
identity/rate-limit/turnstile enforcement, routing + forwarding to Catalog / Users / the agent
container, and the image/tile proxies. **No pilgrimage domain model** — it is Gateway tier, never
`src/domain/`. The HTML surface lives in `apps/web`.
Root guide: `../../AGENTS.md`. Sibling worker guides: `../catalog/AGENTS.md`, `../users/AGENTS.md`.

Native tools, facts and deterministic selection rules are consumed through `@animichi/agent`
(`../../packages/agent/README.md`). Native SDK objects remain the execution authority; the
retired run engine and envelope paths have no forwarding modules.

## Commands (from `workers/edge/`)

- pnpm. `pnpm test` — the edge's whole deterministic gate set, in one command (#1358): the
  node:test suite under `test/*.test.ts` (doubles in `test/doubles/`), then `test:chat-answer-part`
  (`packages/contract/test/chat-answer-part.test.ts` — it guards THIS package's `data-response`
  projection, so it runs in this lane and not only when the contract changes), then
  `test:bundle-smoke`, then `test:ratelimit-namespace`
  (`scripts/check-edge-ratelimit-namespace.sh` and its behavioral test, which moved here from
  `.github/scripts/`). From the repo root the same command is `pnpm run test:worker` (forwards to
  `pnpm --filter edge-worker test`; `make test-worker` likewise).
- `pnpm run test:bundle-smoke` builds artifacts through the official Wrangler dry-run CLI and
  executes them in workerd. Entry tests reject esbuild, Node-only eval/conformance leakage,
  and exercise the native tools' request and response validation. The old zero-Zod rule was
  replaced under the user's explicit 2026-09-10 native hard-cut authorization: validators used
  by the production SDK/oRPC contract are part of the runtime, not a forbidden library brand.
- `pnpm run test:native-host` runs actual default/resource-fault SessionAgent calls with local
  workerd, native Pi, the production tools and disposable PostgreSQL. It includes automatic
  scheduling, cold reattachment, lost replies, authority and settlement. Coordinate the local
  database slot before this lane; no paid models or hosted database are used.
- `pnpm run test:catalog-api` — opt-in staging lane (`api-test/*.test.ts`, W1-4 #1253) for the
  catalog tools, against a deploy carrying the native agent candidate, plus the BYOK probe's
  invalid-key evidence (W2-3 #1289; the valid-key case is the owner's manual step, because it
  needs a key that must not be written down). Two halves: the five
  catalog procedures still have no public door (spec Appendix D), and one real `POST /v1/chat`
  through the deployed edge calls `resolve_anime` and is readable back by conversation id — the
  (api) evidence #1253 had to defer until the route switch. Fails closed without
  `CATALOG_API_ORIGIN` + `AGENT_TURN_BEARER`; never in CI. Why the turn is signed in and the
  anonymous journey is manual: `api-test/README.md` and `docs/ops/w1-staging-journey.md`.
- `pnpm run test:agent-db` runs the bounded native recovery scanners against disposable
  PostgreSQL (`agent-db-test/README.md`). Admission and host integration have their own
  native lanes. Coordinate Docker use; never substitute a live database implicitly.
- `pnpm run typecheck` — `tsc --noEmit` (TypeScript 7.0.2 via workspace hoist).
- `pnpm run lint:oxlint` — type-aware oxlint, warnings denied.
- Deploy is CI-only: `wrangler deploy -c workers/edge/wrangler.toml` from the repo root
  (hook `block-local-deploy`). Never deploy locally.

## Native agent layout (2026-09-10 hard cut)

- `src/entry.ts` exports `SessionAgent` as the deployed `AgentSession`; `src/app.ts` composes
  the existing authenticated gateway. `/v1/chat` always selects the native tier.
- `src/agent/host/` initializes direct Prisma/Neon SessionRepo and Models from Env, owns
  explicit exclusion, ephemeral operation credentials, native schedule/keepalive and recovery.
- `src/agent/admission/` persists request keys and quota coordinates before actual native
  accept. `src/agent/recovery/` discovers admissions, selection intents and independent
  unsettled obligations. Native inspectExecution/getResult are the execution witnesses.
- `src/agent/settlement/native-settlement.ts` reads immutable native results/usage and writes
  the existing billing aggregates plus settlement marker in one business transaction.
- `@animichi/agent/harness` composes the seven native tools. Catalog uses the original oRPC
  contract validators; model/web/catalog transport uses Workers-supported manual redirects
  and refuses redirects before any credential can leave the permitted origin.
- Native business tables and runtime storage are in `packages/pi-session-neon`. Existing
  Atlas quota/ownership tables are queried directly through bounded native SQL; do not copy
  them or revive old run state.
- Selection and facts use shared native tools/hooks and typed custom entries. Live chat uses
  native watch with AI SDK framing; transcript GET reads native storage directly. The request
  digest and current owner authorize read-only reconnection while the driver remains exclusive.
  No old engine, dual-write, TurnModel or executor facade is an acceptable fallback.
- Local artifact tests live in `bundle-smoke/`; full native business integration tests live in
  `host-integration-test/` and `admission-test/`. Production code never imports test fixtures.

## Runtime rules

- Edge verifies identity but does **not** re-authenticate Users: `/v1/users/*` gets
  `Authorization` stripped and verified identity forwarded as `X-User-Id`/`X-User-Type` (AUTH-2
  #950); `src/identity/auth.ts` resolves anonymous vs Neon-Auth JWT (the
  `sk_*` API-key path and the `agent` identity class are deleted, AUTH-1 #945), and
  `src/gateway/forward.ts` injects the identity headers.
- Policy stays in pure functions (`routing-policy.ts`, `catalog-policy.ts`) so it runs under
  node:test with no Cloudflare bindings; `app.ts` only wires them up. New public paths go in the
  policy tables, not the container class.
- `src/container/container-env.ts` owns the container env allowlist/required keys and the
  `DENIED_EGRESS_HOSTS` glob list — it is read verbatim by docs/security guards (see
  `docs/ops/secrets.md`, `docs/ops/cloudflare-hardening.md`); keep paths and key names in lockstep.
- The agent tier reads `AGENT_SVC_DATABASE_URL` via direct Prisma 8 `postgres<Contract>`
  and native `NeonSessionRepo`, with the database lifetime owned by the DO incarnation.
  Secret Store/string bindings are resolved in default startup, never from `process.env`.
- New Agent execution uses the published Cloudflare `Agent` class and its own schedules.
  Do not add custom alarm state machines or a replacement Session implementation.
- `wrangler.toml` is the single config surface (`main = "src/entry.ts"`, resolved config-relative);
  routes are declared in Pulumi, never here (#541).

## Tests

node:test (no vitest, no workers pool). Two files in the suite still read a workflow verbatim,
and they are the whole list: `auth-config.test.ts` (#1047 — no deploy surface may carry
`secrets.NEON_AUTH_JWKS_URL` / `secrets.CORS_ALLOWED_ORIGIN`) and `migration-boundary.test.ts`
(every environment reaches the database only through the migrator Worker). A change under
`.github/workflows/` must keep `pnpm run test:worker` green for those two. Everything else that
used to pin pipeline text was deleted or repointed at the file owning the contract (#1373) —
`release-toolchain.test.ts` reads `package.json` manifests, not workflows, and
`staging-baseline-reset.test.ts` now executes
`infra/database-access/production-baseline-guard.sh` instead of extracting it from `cd.yml`.
Do not add a new assertion about a job name, a step name, or an `if:` condition: pipeline shape
belongs to the contract tests in `.github/scripts`.
