# Test Infrastructure: Remaining Work (Testcontainer Migration, Playwright E2E, Vitest Components, CI Gates)

## Context

Parent spec: `docs/superpowers/specs/2026-04-08-test-infrastructure-design.md`

That spec is 60% landed. Tasks 1, 3, and 4 shipped (testcontainer conftest, eval migration, 160 eval cases). This spec covers the four remaining items:

1. **Task 2 (partial):** `test_api_contract.py` and `test_sse_contract.py` still use `MagicMock` for the DB — they need to consume the `tc_db` fixture from `backend/tests/integration/conftest.py`.
2. **Task 5 (not started):** Playwright E2E — config, directory structure, 4 user journey tests.
3. **Task 6 (not started):** Frontend component tests — Vitest + React Testing Library + MSW for `MessageBubble`, `PilgrimageGrid`, `AppShell`, `useChat`, `useSession`.
4. **Task 7 (partial):** CI pipeline needs Playwright E2E gate and frontend component test gate added to `.github/workflows/ci.yml`.

Current frontend test runner is Node's built-in `node:test` (3 files in `frontend/tests/`). No Vitest, no `@testing-library/react`, no MSW installed. No Playwright anywhere.

## Goals

1. Zero `MagicMock` for DB in `backend/tests/integration/` — all integration tests use testcontainer PostgreSQL
2. Playwright E2E covering 4 critical user journeys (search, route, conversation, auth)
3. Vitest component test suite for 3 components + 2 hooks with MSW API mocking
4. CI gates: `frontend-test` job and `e2e-local` job block PRs on failure

## Non-Goals

- No visual regression / screenshot comparison
- No Playwright tests against production URL (post-deploy E2E is a future iteration)
- No migration of existing `frontend/tests/*.test.ts` files from `node:test` to Vitest (they work fine)
- No load testing or performance benchmarks
- No changes to eval infrastructure (already landed)

## Architecture

### Integration test DB strategy change

```
Before:  test_api_contract.py  →  _mock_db() → MagicMock
         test_sse_contract.py  →  _mock_db() → MagicMock

After:   test_api_contract.py  →  tc_db fixture → testcontainer PostgreSQL
         test_sse_contract.py  →  tc_db fixture → testcontainer PostgreSQL
```

RuntimeAPI.handle is still mocked (these are contract tests — they verify HTTP shape, not pipeline logic). Only the DB dependency changes from MagicMock to real PostgreSQL.

### Frontend test stack

```
frontend/
├── vitest.config.ts              (new)
├── tests/
│   ├── setup.ts                  (new — MSW server setup)
│   ├── mocks/
│   │   ├── handlers.ts           (new — MSW request handlers)
│   │   └── server.ts             (new — MSW setupServer)
│   ├── components/
│   │   ├── MessageBubble.test.tsx (new)
│   │   ├── PilgrimageGrid.test.tsx(new)
│   │   └── AppShell.test.tsx     (new)
│   └── hooks/
│       ├── useChat.test.ts       (new)
│       └── useSession.test.ts    (new)
│   ├── conversation-api.test.ts  (existing, unchanged)
│   ├── conversation-history.test.ts (existing, unchanged)
│   └── supabase-config.test.ts   (existing, unchanged)
├── package.json                  (add vitest, @testing-library/react, msw, jsdom)
```

### Playwright E2E structure

```
e2e/
├── playwright.config.ts          (new — baseURL localhost:3000)
├── fixtures/
│   └── auth.ts                   (new — Supabase magic-link test helper)
├── tests/
│   ├── search-flow.spec.ts       (new)
│   ├── route-planning.spec.ts    (new)
│   ├── conversation.spec.ts      (new)
│   └── auth-flow.spec.ts         (new)
```

### CI pipeline additions

Two new jobs in `.github/workflows/ci.yml`:

```
frontend-test:
  needs: frontend-quality
  runs: cd frontend && npx vitest run

e2e-local:
  needs: [backend-test, frontend-build]
  runs: start servers → npx playwright test
```

Both jobs are **required** (no `continue-on-error`). They block merge on failure.

---

## Task Breakdown

### Task 1: Migrate test_api_contract.py to testcontainer DB

- **Scope:** Replace `_mock_db()` with `tc_db` fixture in `test_api_contract.py`. The RuntimeAPI mock stays (contract tests mock the handle method). Only the DB parameter to `create_fastapi_app` changes from MagicMock to real SupabaseClient.
- **Files changed:**
  - Modify: `backend/tests/integration/test_api_contract.py`
- **AC (with mandatory categories):**
  - [ ] Happy path: All existing tests pass with testcontainer DB replacing MagicMock; response shapes unchanged -> integration
  - [ ] Happy path: `_build_app()` helper accepts `tc_db` fixture and passes it to `create_fastapi_app` -> integration
  - [ ] Null/empty: Tests that assert empty response lists (conversations, routes) still pass with real empty DB tables -> integration
  - [ ] Error path: Tests that assert 400/422 error shapes still pass — error handling does not depend on DB mock behavior -> integration
  - [ ] Error path: DB connection failure during test setup raises clear fixture error, not silent MagicMock fallback -> integration
- **Quality Ratchet:** every AC has test type annotation

### Task 2: Migrate test_sse_contract.py to testcontainer DB

- **Scope:** Replace `_mock_db()` with `tc_db` fixture in `test_sse_contract.py`. The RuntimeAPI mock stays (SSE tests mock handle with `emit_steps` side effect). Only DB param changes.
- **Files changed:**
  - Modify: `backend/tests/integration/test_sse_contract.py`
- **AC (with mandatory categories):**
  - [ ] Happy path: SSE event ordering tests (planning -> step -> done) pass with testcontainer DB -> integration
  - [ ] Happy path: Done event shape test passes — `PublicAPIResponse` keys present -> integration
  - [ ] Null/empty: Step events with empty data payloads (`row_count: 0`) render correctly in SSE stream -> integration
  - [ ] Error path: SSE error event test (RuntimeError → error event) passes with real DB -> integration
  - [ ] Error path: Blank text on stream still returns 422 with real DB backing the app -> integration
- **Quality Ratchet:** every AC has test type annotation

### Task 3: Vitest + MSW setup for frontend

- **Scope:** Install Vitest, React Testing Library, MSW, jsdom. Create vitest config, MSW server setup, and shared response fixtures. Add `test` script to `frontend/package.json`.
- **Files changed:**
  - Modify: `frontend/package.json` (add devDependencies + `"test": "vitest run"` script)
  - Create: `frontend/vitest.config.ts`
  - Create: `frontend/tests/setup.ts` (MSW beforeAll/afterEach/afterAll)
  - Create: `frontend/tests/mocks/handlers.ts` (MSW request handlers for `/v1/runtime`, `/v1/conversations`)
  - Create: `frontend/tests/mocks/server.ts` (MSW `setupServer`)
  - Create: `frontend/tests/fixtures/responses.ts` (canned RuntimeResponse objects)
- **AC (with mandatory categories):**
  - [ ] Happy path: `cd frontend && npm test` exits 0 with vitest runner (even with zero component tests initially) -> unit
  - [ ] Happy path: vitest.config.ts configures jsdom environment, path aliases (`@/` → `./`), and setup file -> unit
  - [ ] Null/empty: MSW handlers return valid JSON for all mocked endpoints; unmocked requests fail with `onUnhandledRequest: 'error'` -> unit
  - [ ] Error path: Response fixtures include error response (`success: false, status: 'error'`) and empty response (`rows: [], row_count: 0`) -> unit
- **Quality Ratchet:** every AC has test type annotation

### Task 4: Frontend component tests (MessageBubble, PilgrimageGrid, AppShell)

- **Scope:** Write component tests using React Testing Library. MessageBubble: render user vs bot messages, handle null data. PilgrimageGrid: render spot list, empty state. AppShell: three-column layout presence, message selection.
- **Files changed:**
  - Create: `frontend/tests/components/MessageBubble.test.tsx`
  - Create: `frontend/tests/components/PilgrimageGrid.test.tsx`
  - Create: `frontend/tests/components/AppShell.test.tsx`
- **AC (with mandatory categories):**
  - [ ] Happy path: MessageBubble renders user message text in a right-aligned bubble -> unit
  - [ ] Happy path: MessageBubble renders bot message with anchor card when response has visual data -> unit
  - [ ] Happy path: PilgrimageGrid renders spot names from response data -> unit
  - [ ] Happy path: AppShell renders sidebar, chat panel, and result panel containers -> unit
  - [ ] Null/empty: MessageBubble renders without crash when `response.data` is undefined (BUG-02 regression) -> unit
  - [ ] Null/empty: PilgrimageGrid renders empty state when `rows` is an empty array -> unit
  - [ ] Null/empty: AppShell renders correctly with zero messages -> unit
  - [ ] Error path: MessageBubble renders error state when `response.success` is false -> unit
  - [ ] Error path: MessageBubble shows retry button on error and calls `onRetry` callback -> unit
  - [ ] i18n: MessageBubble renders correctly wrapped in i18n DictProvider (no missing key crashes) -> unit
- **Quality Ratchet:** every AC has test type annotation

### Task 5: Frontend hook tests (useChat, useSession)

- **Scope:** Test hooks using `renderHook` from React Testing Library. useChat: send message, abort, clear. useSession: persist/clear session ID in localStorage.
- **Files changed:**
  - Create: `frontend/tests/hooks/useChat.test.ts`
  - Create: `frontend/tests/hooks/useSession.test.ts`
- **AC (with mandatory categories):**
  - [ ] Happy path: useSession initializes from localStorage if key exists -> unit
  - [ ] Happy path: useSession.setSessionId writes to localStorage -> unit
  - [ ] Happy path: useChat.send appends user message and bot response to messages array -> unit
  - [ ] Happy path: useChat.clear resets messages to empty array -> unit
  - [ ] Null/empty: useSession returns null when localStorage has no key -> unit
  - [ ] Null/empty: useChat.send with empty/whitespace text does not append messages -> unit
  - [ ] Error path: useSession.clearSession removes key from localStorage -> unit
  - [ ] Error path: useChat.send while already sending (sending=true) is a no-op -> unit
- **Quality Ratchet:** every AC has test type annotation

### Task 6: Playwright E2E setup and 4 journey tests

- **Scope:** Install Playwright, create config pointing at `localhost:3000`, create auth fixture for Supabase test user, write 4 user journey specs.
- **Files changed:**
  - Modify: `package.json` (root — add `@playwright/test` devDependency)
  - Create: `e2e/playwright.config.ts`
  - Create: `e2e/fixtures/auth.ts`
  - Create: `e2e/tests/auth-flow.spec.ts`
  - Create: `e2e/tests/search-flow.spec.ts`
  - Create: `e2e/tests/route-planning.spec.ts`
  - Create: `e2e/tests/conversation.spec.ts`
- **AC (with mandatory categories):**
  - [ ] Happy path: Search flow — type anime name, send, PilgrimageGrid renders with row count > 0 -> browser
  - [ ] Happy path: Route planning — after search, request route, route result or clarify prompt appears -> browser
  - [ ] Happy path: Conversation — send message, start new chat, click old conversation, history restored -> browser
  - [ ] Happy path: Auth flow — magic link login, session created, sidebar shows history -> browser
  - [ ] Null/empty: Search flow with unknown anime shows empty or clarify state, no crash -> browser
  - [ ] Null/empty: Conversation history is empty for fresh user, sidebar shows empty state -> browser
  - [ ] Error path: Backend unavailable — error message shown, send button recovers after backend returns -> browser
  - [ ] Error path: Blank message — send button disabled, no request sent -> browser
- **Quality Ratchet:** every AC has test type annotation

### Task 7: CI pipeline — add frontend-test and e2e-local jobs

- **Scope:** Add two new jobs to `.github/workflows/ci.yml`. `frontend-test` runs Vitest. `e2e-local` starts backend + frontend dev servers, then runs Playwright. Both are required gates (no `continue-on-error`).
- **Files changed:**
  - Modify: `.github/workflows/ci.yml`
- **AC (with mandatory categories):**
  - [ ] Happy path: `frontend-test` job runs `cd frontend && npm test` and blocks PR on failure -> integration
  - [ ] Happy path: `e2e-local` job starts backend (make serve) + frontend (npm run dev), waits for readiness, runs `npx playwright test` -> integration
  - [ ] Happy path: `e2e-local` depends on `backend-test` and `frontend-build` (runs in Stage 2) -> integration
  - [ ] Null/empty: `frontend-test` job installs deps and runs even when no component tests exist yet (exits 0 from vitest with no test files = configurable) -> integration
  - [ ] Error path: `frontend-test` failure blocks the deploy job — deploy `needs` includes `frontend-test` -> integration
  - [ ] Error path: `e2e-local` failure blocks the deploy job — deploy `needs` includes `e2e-local` -> integration
- **Quality Ratchet:** every AC has test type annotation

---

## Verification Plan

After all tasks ship, run the following commands and verify green:

1. `uv run pytest backend/tests/integration/test_api_contract.py -v` — all pass, no MagicMock for DB
2. `uv run pytest backend/tests/integration/test_sse_contract.py -v` — all pass, no MagicMock for DB
3. `grep -r "MagicMock" backend/tests/integration/` — returns zero matches for DB mocking (MagicMock may remain for RuntimeAPI mock, which is expected)
4. `cd frontend && npm test` — Vitest runs, 5 test files pass
5. `npx playwright test` — 4 spec files pass against local dev server
6. Push a PR and verify CI pipeline runs `frontend-test` and `e2e-local` jobs without `continue-on-error`

## Dependencies

| Dependency | Status | Required by |
|---|---|---|
| Docker (testcontainers) | Available on CI runners and local dev | Tasks 1, 2 |
| `testcontainers[postgres]` | Already in pyproject.toml dev deps | Tasks 1, 2 |
| `vitest`, `@testing-library/react`, `msw`, `jsdom` | Not installed | Tasks 3, 4, 5 |
| `@playwright/test` | Not installed | Task 6 |
| Backend testcontainer conftest (`backend/tests/conftest_db.py`) | Landed (Task 1 of parent spec) | Tasks 1, 2 |
| Integration conftest `tc_db` fixture (`backend/tests/integration/conftest.py`) | Landed | Tasks 1, 2 |
| Supabase test user (`qa-bot@seichijunrei.test`) | Created (see memory) | Task 6 (auth flow) |
| Local dev servers (make serve + npm run dev) | Working | Task 6 |

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Testcontainer DB changes behavior of contract tests (tests relied on MagicMock returning specific values) | Medium | Medium | Keep RuntimeAPI mocked; only DB param changes. Review each test to ensure it does not depend on DB return values for contract shape assertions. |
| Vitest + Next.js 16 compatibility issues (RSC, path aliases, CSS imports) | Medium | Medium | Use `vitest.config.ts` with explicit path aliases and CSS stub. Test `"use client"` components only (no RSC). |
| MSW v2 API changes (handlers syntax) | Low | Low | Pin MSW version. Follow `docs/testing-strategy.md` MSW setup pattern. |
| Playwright flakiness on CI (server startup race) | High | Medium | Use `webServer` config in `playwright.config.ts` with `reuseExistingServer: true` and health check URL. Add retry count of 2. |
| E2E auth flow depends on Supabase magic link — hard to automate in CI | High | High | Use Supabase Admin API to create session directly in auth fixture, bypassing email delivery. Alternatively, use API key auth for E2E tests. |
| CI job ordering — `e2e-local` needs both backend and frontend servers running | Medium | Medium | Use Playwright `webServer` array config to start both servers. Add `timeout: 120000` for server startup. |
