# e2e — AGENTS.md

Playwright browser coverage for `apps/web`, the only browser surface left after issue #537
retired the legacy `frontend/` package. The suite exercises the branded 404, the chat flows, and
the Neon Auth login. Root guide: `../AGENTS.md`.

## Commands (from repo root)

- `make dev-local` — start the backend and web app. **Not a prerequisite for the suite**: every
  transport is stubbed via `page.route`, so E2E runs with just the web app up (auth E2E needs no
  Supabase — AUTH-2 #950 cut the local-login path over to Neon Auth).
- `make e2e-setup` — install E2E deps + the Chromium binary and check the web app; it no longer
  starts Supabase or the email function.
- `make e2e` — run the complete Playwright suite against an app you started.
- From `e2e/`: `pnpm test` · `pnpm run test:headed` · `pnpm run test:web`.

`pnpm test` is the CI browser lane, not the whole suite: it builds `apps/web`, serves the
emitted Worker with `wrangler dev` on `:8799` itself (`playwright.config.ts` `webServer`,
opt-in through `E2E_SERVE_EMITTED_WORKER=1`) and runs the ten specs the lane owns —
`web-404`, `web-maplibre-canary`, `web-chat-anonymous`, `web-hero-query`,
`web-state-ownership`, `web-a11y-axe`, `web-a11y-keyboard`, `web-a11y-states`, `web-cwv`,
`web-chat-settings-return`.
After the emitted-Worker specifications, the same `test` command runs the native browser lane
(`edge-worker test:native-browser`). It starts disposable Postgres, bundles the actual native
SessionAgent with Wrangler, and serves the real web app through Vite’s same-origin proxy.
Chromium verifies leaving a running tool and returning through SDK GET resume, one admission /
one quota reservation, and a real network heartbeat across controlled browser time. Only the
external provider/catalog and Turnstile boundaries are scripted. This local evidence does not
replace deployed lifetime or APAC latency acceptance.

It needs nothing running beforehand; every other script targets `:3000` (or whatever
`E2E_WEB_BASE_URL` names) and does need one.

## Conventions

- Start `make dev-local` first if you want the real backend behind the stubbed edges, then run
  setup/tests. The setup script does not launch the backend.
- `E2E_WEB_BASE_URL` targets `apps/web` (default `:3000`, CI wrangler `:8799`).
- **Reaching staging (D3 #1369).** When the target is staging rather than a local or
  emitted Worker, the suite presents a Cloudflare Access **service token**:
  `CF_ACCESS_CLIENT_ID` + `CF_ACCESS_CLIENT_SECRET`, turned into the
  `CF-Access-Client-Id` / `CF-Access-Client-Secret` request headers on
  `use.extraHTTPHeaders` by `playwright.config.ts`. It is headers and not a storage
  state because Access reads the credential off each request — which is why #1369 also
  deleted `global-setup.ts`, whose whole job was launching a browser before the run to
  seed the retired WAF gate's `animichi_staging` cookie. Both variables or neither — half a token is answered with the Access login page, and
  `@animichi/contract/access-service-token` refuses it by name before any spec starts.
  It is scoped to the TARGET, and the scoping is a **refusal**, not a filter, because
  `use.extraHTTPHeaders` is context-wide — it rides `context.request` calls too, and
  `web-neon-login.spec.ts` posts a live sign-in to the Neon Auth origin through exactly
  that API. So the config refuses to start when a token is declared and either (a) the
  target is this machine (`isLoopbackHostname` in the contract package owns that list:
  `localhost`, `*.localhost`, all of `127.0.0.0/8`, `[::1]`, `0.0.0.0`, `::`), or (b) any
  other configured origin the suite can reach — `NEON_AUTH_BASE_URL`,
  `VITE_NEON_AUTH_BASE_URL` — sits on a different host from the target. Playwright has no
  per-origin header option; a `context.route` interceptor was the alternative and was
  rejected because it has to be right on every request forever and fails OPEN when it is
  not, whereas a config that will not start cannot leak. Add any new origin variable to
  `CROSS_ORIGIN_BASE_URL_VARS` when you add it to a spec.
  Get the values with `esc env open lifeodyssey/animichi/staging
  environmentVariables.CF_ACCESS_CLIENT_ID --format string` (and the secret likewise);
  CI takes them from the same ESC environment. `test/repo-config/playwright.test.rb`
  fails if the config stops presenting them.
  **The headers also ride Cloudflare-operated subresources.** `extraHTTPHeaders` is
  context-wide, so a page that loads `challenges.cloudflare.com` (Turnstile) or
  `static.cloudflareinsights.com` sends them the pair too. That is acceptable today — the
  recipient is Cloudflare, the same party that issued the token and terminates Access —
  and the refusal above only covers origins the suite is *configured* to reach, not ones a
  page pulls in. Re-check this the first time a spec loads a subresource from anybody
  else: a non-Cloudflare third party would be a real leak and needs the `context.route`
  interceptor this file argues against, or a narrower target.
- Keep browser assertions user-visible and locale-aware; failure screenshots are automatic.

## Key files + entrypoints

- `playwright.config.ts` — Chromium project, origins, timeouts, trace/screenshot policy.
- `web-404.spec.ts` — `apps/web` branded-not-found contract.
- `web-chat-*.spec.ts` — `apps/web` chat anonymous / error-state / selection / login-wall flows.
- `web-neon-login.spec.ts` — **live** Neon Auth login round-trip (AUTH-2 #950): password sign-in
  against the real Neon Auth origin via `context.request`, then the app's `/auth/callback`
  exchange. Self-skips without `NEON_AUTH_BASE_URL` + `QA_NEON_USER_EMAIL` + `QA_NEON_USER_PASSWORD`
  (Path A, `docs/ops/auth-migration-neon.md` §4).
- `web-cwv.spec.ts` — CWV observer spec for `apps/web` (CLS gate + LCP warn), sharing thresholds
  from `apps/web/web-cwv.config.ts`.
- `../scripts/e2e-setup.sh` — dependency + browser install; no Supabase/Mailpit preparation.

## Pitfalls

- The pre-cutover magic-link E2E that #537 deleted was Supabase/GoTrue (localStorage token
  injection). It is not coming back: the Neon flow is an HttpOnly cookie on the Neon Auth origin,
  which is exactly why the live login spec signs in through the browser context's shared cookie
  jar rather than injecting a token. Recover the old fixture from git history only for reference.
- The remaining `e2e/fixtures/` hold only `chat-stream.ts` and `map-spike.ts`.
- Before running, inspect `http://localhost:8080/healthz` and confirm `git_branch` is the intended
  checkout. The endpoint exposes the runtime's actual branch and commit.
