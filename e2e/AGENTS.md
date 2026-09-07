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
It needs nothing running beforehand; every other script targets `:3000` (or whatever
`E2E_WEB_BASE_URL` names) and does need one.

## Conventions

- Start `make dev-local` first if you want the real backend behind the stubbed edges, then run
  setup/tests. The setup script does not launch the backend.
- `E2E_WEB_BASE_URL` targets `apps/web` (default `:3000`, CI wrangler `:8799`).
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
