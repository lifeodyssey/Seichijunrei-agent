# workers/users — AGENTS.md

TypeScript Cloudflare Worker: the **user-domain data service** (saved routes today; the
anonymous-claim flow and more user data later). Owns user-scoped rows in Neon; reached ONLY via the
edge Worker's `USERS` service binding at `/v1/users/*` — no public route of its own.
Root guide: `../../AGENTS.md`. Template sibling: `../catalog/AGENTS.md`.

## Commands (from `workers/users/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` / `pnpm run test:worker` (`vitest-pool-workers`) · `pnpm run typecheck`
  (TypeScript 7.0.2) · `pnpm run lint:oxlint` (type-aware, strict, warnings denied).

## Trust model (AUTH-2 #950 — internal identity boundary, NO self-verification)

- The users service verifies NOTHING itself (the JWKS/bearer verifier was deleted). It trusts ONLY
  the edge's verified identity, which arrives over the USERS service binding as `X-User-Id`
  (+ `X-User-Type`) after the edge stripped `Authorization` and any caller-supplied identity
  headers (see `workers/edge/src/gateway/forward.ts`).
- A request that still carries `Authorization` is raw bearer access (it did not come from the
  edge) → flat **401**. Missing/empty `X-User-Id` → **401**. Anonymous access is NEVER allowed
  here. Cross-user access to an owned row → defined **403** `ROUTE_NOT_OWNED`.
- There is no service-to-service secret beyond this no-public-route premise: the users worker has
  no route that is reachable outside the edge binding.

## Stack + workerd gotchas (mirrors catalog — read `../catalog/AGENTS.md` for the long form)

- Hono + oRPC; contract source of truth = `packages/contract/src/users-contract.ts`
  (error registry mirror: `src/lib/errors.ts` — keep in lockstep).
- **Drizzle via the `UsersDb` seam** — statements are built with the Drizzle **query builder**
  (`src/adapters/neon-saved-route-repo.ts`) and executed through the `UsersDb` seam
  (`db.execute`); the raw `sql` tagged template is reserved for bound array params (`sql.param`).
  "Builder hangs" concerns were retired by the #992 query-builder cutover.
- **Arrays**: interpolating a JS array in the `sql` template expands to a tuple (`($1,$2)`; empty
  → invalid `()`). Bind arrays as ONE param: `${sql.param(arr)}::text[]` (see `src/adapters/neon-saved-route-repo.ts`).
- **timestamptz** returns raw strings under workerd → normalize `new Date(v).toISOString()` at the
  boundary.
- zod value imports only at the contract/handler boundary; internals `import type` from
  `@animichi/contract`.

## Config / secrets

- `wrangler.toml` `[vars]` holds ENVIRONMENT only. `DATABASE_URL` is a secret
  (`.dev.vars` locally — see `.dev.vars.example`; `wrangler secret put` / deploy-lane env
  in CI). The users worker no longer reads `NEON_AUTH_JWKS_URL` (identity arrives as headers).
- Envs: `[env.staging]` = `users-staging`, `[env.production]` = `users` (routeless; binding-only).
- DB schema changes ride `migrations/neon/` (atlas, timestamped files + `atlas migrate hash`).

## Tests

TDD via `vitest-pool-workers` (`test/*.worker.test.ts`, ≤200 lines each). Identity is injected as
the edge-forwarded `X-User-Id` header (`identity-fixture.ts`); the fake executor renders queries
with `PgDialect.sqlToQuery` — no drizzle-internals guessing. Real-DB
round-trips (neon-http array/timestamptz serialization) are NOT covered here yet — verify against a
real Postgres before building on top (leftover from S2.8).
