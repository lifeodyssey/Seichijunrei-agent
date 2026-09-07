# workers/catalog — AGENTS.md

TypeScript Cloudflare Worker: the anime **catalog REST API** + the **data platform** (ingest →
enrich → publish). Owns catalog-domain data; the Python agent is a read-only client of it.
Root guide: `../../AGENTS.md`.

## Commands (from `workers/catalog/`)

- pnpm. `pnpm run dev` (`wrangler dev`, local) — never `wrangler deploy` (hook `block-local-deploy`).
- `pnpm test` (`test:worker` alone — hermetic, boots no container) · `pnpm run test:spike`
  (Docker; deliberately not chained into `test`, see Test pools) · `pnpm run typecheck`
  (TypeScript 7.0.2) · `pnpm run lint:oxlint` (type-aware, strict, warnings denied).
  ESLint is gone.
- `pnpm run test:smoke` — boots the real deploy bundle in workerd and asserts
  `/healthz` 200. The worker pool evaluates unbundled modules, so bundle-only
  startup failures (the StringChunk TDZ, 2026-08-05) are invisible to it — this
  gate exists for exactly that class of bug. Runs in CI as `catalog-startup-smoke`.

## Stack (per the ADR)

- **Hono** HTTP; SSE via native `ReadableStream` (no buffering middleware).
- **oRPC** contract; **Drizzle for queries only** — Neon via @neondatabase/serverless (neon-http); no Hyperdrive.
- PostGIS via `sql` tagged template — do not vectorize structured geo (SD-29).

## Contract discipline (`packages/contract` is the source of truth)

- `src/types.ts` is **`import type` only** — never a value import, never zod (keeps the zod runtime out
  of the Worker bundle). Compile-time parity is asserted by `test/contract-parity.worker.test.ts` —
  **must stay green**.
- Error registry = **three mirrors, one registry** (contract zod → catalog no-zod mirror → Python
  mirror). Never throw a bare `ORPCError` / `Error` for an actionable failure — register a code.
  Full checklist + categories: `packages/contract/README.md`.

## Data platform

- `src/ingest/` (per-work TTL; singleflight via the `ingest_jobs` unique constraint — never stampede
  Anitabi) · `src/enrich/` (dedup / clustering / city backfill / attribution) · `src/publish/`.
- Route ordering is unified **here** (`src/lib/route.ts`, haversine × 1.3, SD-28) — the old Python
  `route_optimizer.py` is retired.
- Data-quality gate (X15): coordinate validation / dedup / episode completeness / volume-drift.
- Geocode API resolves normalized aliases exact-first; only an exact miss runs strict pg_trgm fuzzy
  matching, then deterministic collapse/limit (`src/api/geocode.ts`).
- Gazetteer source lock: `data/gazetteer-sources.json`; generator:
  `scripts/build-gazetteer.ts`; review output: `data/gazetteer-audit.csv`. The canonical invocation and
  provenance live in `docs/data-sources.md`.

## workerd gotchas (Drizzle / timestamptz)

- **Drizzle via the single adapter seam** — every statement is built with the Drizzle **query
  builder** through `statementBuilder()` (`src/db/client.ts`) plus the typed expression helpers in
  `src/db/expressions.ts`, then executed through `CatalogDb` (`db.execute` / `db.batch`). Raw `sql`
  tagged template is reserved for narrow fragments (PostGIS, pg_trgm, interval) inside the
  expressions module. Every complete-SQL statement runs through the builder so the worker pool can
  test through fakes; the remaining live-Neon caveat (builder execution under workerd + neon-http
  still needs a real-Neon validation) is documented on `statementBuilder()`.
- **timestamptz comes back as a raw string under workerd** (the pg driver doesn't parse it to `Date`;
  Node would). Normalize at the boundary — `new Date(stamp).toISOString()` (see `src/api/search.ts`).
- **zod runs only at the handler/contract boundary** to validate untrusted public input — the one
  sanctioned place for a zod *value* import (contrast `src/types.ts`, which stays `import type` only;
  see Contract discipline above).
- **Resolved (2026-08-10, RETENTION-1 #940)**: the jobs Worker was retired; the catalog
  cron-dispatcher shape below is the standing pattern (see `src/index.ts`).

## Test pools

- `*.worker.test.ts` runs inside workerd via `vitest.config.ts`; its filesystem is sandboxed.
- `*.spike.test.ts` runs in the Node pool via `vitest.spike.config.ts` for filesystem, TCP, Docker,
  or child-process work. Filesystem parity checks belong here, not in Worker tests — **unless the
  check must never be skippable**. The suite is **hermetic and fail-loudly** (card 1049): its
  `globalSetup` (`test/spike-db-global.ts`) boots a **Docker Postgres+PostGIS** container, applies
  the committed `migrations/neon` Atlas chain to a clean database, and any setup failure throws —
  there is no silent-skip path and **zero Neon environment variables**. That container is why
  `test` does **not** chain `test:spike` (#1473): `test` is what the pre-push hook runs for every
  affected package, so chaining it started Docker on every catalog push. The spike runs in CI as
  its own step of the `catalog` matrix lane (`Run the catalog spike against the offline Postgres
  image`, `.github/workflows/pr-verification.yml`, right after the step that builds the
  `animichi-test-postgres` image) and in `make check-full`.
  `.github/scripts/test_package_test_segments.rb` pins three things about that arrangement: `test`
  must not chain `test:spike`, those two files must each name `pnpm --filter catalog run test:spike`,
  and `test:spike` itself must still run `vitest.spike.config.ts` — a lane emptied out from any of
  the three ends goes red. Whether the container actually boots is `test/spike-db-global.ts`'s job.
  **colima (macOS) local runs**: testcontainers' ryuk reaper bind-mounts the daemon socket, and
  the macOS-side colima socket mounts as a dead file — ryuk panics and the suite dies with
  `Log stream ended and message "/.*Started.*/" was not received`. Export
  `DOCKER_HOST=unix://$HOME/.colima/default/docker.sock` **and**
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock` (the VM-internal path) before
  `pnpm test:spike`. CI's linux runners need neither.
  Config-as-data guards that must always run therefore belong in the worker pool, reading their file
  via Vite's `?raw` suffix (inlined at transform time, so the sandboxed filesystem never comes
  into it).
  See `test/wrangler-private.worker.test.ts`.
- TDD via `vitest-pool-workers`; keep `test/contract-parity.worker.test.ts` green.
