# apps/web — AGENTS.md

TanStack Start app replacing the retired Next.js frontend at cutover. `/` is a responsive doorway:
it serves a minimal indexable summary, hands mobile visitors (`<=640px`) to `/chat` on the first
client effect, and keeps desktop visitors on the clickable doorway. Root guide: `../../AGENTS.md`.

## Commands (from `apps/web/`)

- `pnpm run dev` — Vite dev server.
- `pnpm run build` — Vite/Nitro Cloudflare build; emits `.output/server/index.mjs` + public assets.
- `pnpm test` — Vitest unit suite with Istanbul coverage.
- `pnpm run test:integration` — build-output and Wrangler dry-run integration checks.
- `pnpm run typecheck` — TypeScript 7.0.2 `tsc --noEmit`.
- `pnpm run lint:oxlint` — type-aware oxlint with warnings denied.
- `pnpm run preview` — `wrangler dev` against the built `.output` entry.

## Conventions

- TanStack file routes live in `src/routes/`; create the router in `src/router.tsx`.
- Keep production functions at ≤10 lines and tests at ≤50. `apps/web/.oxlintrc.json` owns both
  limits and extends the root strict, type-aware config.
- **CSS is Tailwind v4 utilities first** — no new hand-written page CSS files; use the
  `tailwind-design-system` skill (user scope) for Tailwind work. Semantic tokens live
  once in `src/styles/globals.css` `:root` and are exposed to utilities via `@theme inline`
  (`bg-ground`, `text-ground-ink`, …); night variants use the `@custom-variant night` selector
  declared in `globals.css`. The legacy per-page stylesheets (`chat.css`, `shiori.css`, …)
  shrink as pages are rebuilt in the 2026-08-29 direction-E redesign.
- **UI styling comes from `animal-island-ui-tailwind`'s CSS class layer**
  (`animal-btn`, `animal-input-wrapper`, `animal-card`, …; already global via the
  `style/core` import in `globals.css`). Do NOT import its React components: the
  package's JS entry vendors `react-dom@19. 2.6` under `dist/es/node_modules`,
  which crashes against our React 19.2.8 ("Incompatible React versions"). Mirror
  the class structure its components render; retheme via `--animal-*` custom
  properties on a wrapper. `node_modules/animal-island-ui-tailwind/AI_USAGE.md`
  documents the design grammar (its HARD RULES are binding: never override the
  3D press shadow, etc.).
  - Pitfall: the package ships its own compiled Tailwind, so its plain utilities
    (`.hidden`, `.flex`, `.grid`, …) land in our shared `@layer utilities` AFTER our
    variant rules and beat them. Never pair a plain utility the package also
    defines with a responsive/state variant (`hidden md:block` breaks); use
    arbitrary properties instead (`[display:none] md:[display:block]`).
- Visual direction is **E · 绿底动森** (2026-08-29, user-approved comp): leaf-green ground
  `#6eb68e` + leaf tile, cream cards, teal `#19c8b9` interaction, gold `#f5c31c` CTA, brown
  `#827157` text. Mascot = flat fox set in `public/images/mascot/` (fox-peek/fox-cheer/fox-lying).
  Product truth for design work lives in `apps/web/PRODUCT.md` (impeccable).
- Use semantic tokens from `src/styles/globals.css`; alignment tests pin the Animal Island token
  layer.
- Keep legacy and rebuild E2E origins separate until cutover: `E2E_WEB_BASE_URL` targets this app.

## API layer (`src/api/`)

- Transport is oRPC `OpenAPILink` (the catalog/users Workers run `OpenAPIHandler`, not RPC).
  `clients.ts` exposes separate `createCatalogClient` / `createUsersClient` factories — each has its
  own base URL and forwards cookie/`Authorization` headers from the per-call `ApiClientContext`.
- `orpc.ts` wraps clients in `@orpc/tanstack-query` utils with disjoint key prefixes
  (`["catalog", …]` / `["users", …]`); consume them via query hooks in `src/api/hooks/` — UI never
  touches the transport directly (dependency points inward: component → hook → client).
- `config.ts` resolves per-service base URLs and the SSR absolute origin (`VITE_SITE_ORIGIN` on the
  server, `location.origin` in the browser). `query-client.ts` builds a fresh `QueryClient`; `getRouter`
  creates one per request and `routerWithQueryClient` wires dehydrate/hydrate (no cross-request leak,
  no double fetch).
- MSW has three swimlanes (`tests/msw/`): `node.ts` (`setupServer`, component/loader unit tests),
  `browser.ts` (`setupWorker`, client-navigation tests). SSR is deliberately NOT covered by MSW —
  it is validated against a real local Worker + backend at the G1 gate. Handlers never hand-write
  JSON: `contract-handler.ts` `parse()`s requests and responses against the `@animichi/contract`
  zod schemas and builds oRPC-typed error envelopes.

## Dependency direction (UI → features → clients/platform; never reverse)

- One-way layering, enforced by convention and peer review (no lint plugin exists; a back-edge is
  a review blocker):
  1. `src/routes/` and `src/components/` — UI. May import features, `src/api/hooks/`, `src/lib/`.
  2. `src/features/*/` — feature units. May import `src/api/` clients/hooks, `src/lib/`,
     `src/platform/`. Prefer no imports from other features' internals — share via `src/lib/`
     or `src/api/hooks/`. **Known exception:** map geometry/controller under
     `src/features/bubble-map/` is a shared map primitive used by chat maps until a
     `src/lib/map/` extract (TODO(refactor-skeleton): see #842).
  3. `src/api/` (transport + hooks) · `src/lib/` (pure utilities) · `src/platform/` — never import
     UI or features. Nothing may reverse this order.
- A feature owns everything it needs under `src/features/<feature>/` — components/, hooks, and a
  `lib/` subfolder for pure logic. `src/lib/` is reserved for cross-cutting/platform-adjacent
  utilities (auth, byok, turnstile, route-detail); it must never hold a feature's code twice.
- Chat is single-homed (consolidated in #842): its pure logic lives in
  `src/features/chat/lib/` — do NOT recreate `src/lib/chat/`.
- Remaining dual home tracked in #842: `route-detail` still spans `src/lib/route-detail/` +
  `src/components/route-detail/`; consolidate under `src/features/route-detail/` and delete
  `src/lib/route-detail/` (see the `TODO(refactor-skeleton)` markers in that folder).

## Key files + entrypoints

- `src/routes/__root.tsx` — document shell, metadata, error/not-found wiring.
- `src/routes/index.tsx` → `src/features/seo/DoorwaySummary.tsx` — the served `/` body.
- `src/routes/settings.tsx` + `src/components/settings/` — the dedicated settings page. It composes
  app preferences and BYOK with `animal-island-ui-tailwind` controls; chat only links to the route.
- `src/components/NotFound.tsx` — branded 404.
- `src/router.tsx` — TanStack router factory.
- `vite.config.ts` — TanStack Start/Nitro/React build composition.
- `wrangler.jsonc` — `.output/server/index.mjs` Worker entry + static asset binding.
- `tests/unit/` · `tests/integration/build-output.test.ts` — unit and emitted-bundle contracts.

## Auth is browser-only (`src/lib/auth/`)

- `neon-auth.ts` is the port. The browser binds it to `neon-auth-client.ts` (the official
  `@neondatabase/auth` SDK) through a dynamic import; SSR binds it to `signed-out-session.ts`.
- **Never import `@neondatabase/auth` from anything the server graph can reach.** The SDK mints a
  BroadcastChannel tab id with `crypto.randomUUID()` at module scope, and workerd evaluates every
  module top level outside an I/O context — even for a dynamic import from inside a handler — so
  the SDK reaching the server graph makes the Worker answer 500 to *every* request, static assets
  included. Wrangler's esbuild pass used to mask this by inlining dynamic imports into lazy
  initialisers; main CD promotes Nitro's prebuilt chunks with `--no-bundle`, which does not.
- Three things hold that line: the `client-only` marker in `neon-auth-client.ts`,
  `importProtection` in `vite.config.ts` (build fails, naming the import chain), and the sourcemap
  assertion in `tests/integration/build-output.test.ts` (the artifact itself is checked).
- A Worker has no cookie jar, so SSR never had a session to read anyway. `AuthStatus` models
  `"pending"` as a first-class state and `/` renders the anonymous doorway until the client answers.

## Native chat recovery

Chat uses the official AI SDK transport to consume the native Pi snapshot/live stream. Response
headers publish the session address immediately; a page return uses the read-only conversation
stream GET, without resubmitting model input or credentials. Native operation IDs pair visible
assistant snapshots with history; headers alone never hide an existing answer. Heartbeat bytes
renew the idle watchdog, so a healthy silent turn has no browser whole-turn timeout.

## Pitfalls

- `src/routeTree.gen.ts` is generated. Do not hand-edit it; oxlint and coverage ignore it. The unit
  pool runs without the TanStack Start vite plugin, so `tests/setup/generate-route-tree.ts`
  (vitest `globalSetup`) emits it before the suite; a normal build regenerates it otherwise.
- Coverage sweeps `src/**` (routes + `router.tsx` included, per campaign plan §0.6); the enforced
  floor is `statements 98 / branches 95 / functions 98 / lines 99`, read from `vitest.config.ts`,
  which is the authority — ratchet UP only. `routeTree.gen.ts` is the only exclusion (plus the
  WebGL map glue listed in the config's exclude ledger).
- `OpenAPILink` captures `globalThis.fetch` at construction: build clients at call time (the lazy
  `catalog()` / `users()` singletons do), not at module top, or MSW patching is missed in tests.
- A normal build must run before preview or build-output integration checks inspect `.output/`.
- Root lint strictness applies here; do not copy the frozen `frontend/` ESLint setup.
