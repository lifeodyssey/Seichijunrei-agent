# Full-Stack Refactoring: Clean Code + Best Practices

## Context

The Seichijunrei codebase has grown organically through 5 iterations. While the layered architecture (domain → application → infrastructure → interfaces → agents) is sound, several files have become "god objects" that mix concerns. The backend runs on aiohttp but a FastAPI cutover plan exists. Frontend has minimal test coverage (3/51 files). No E2E or production API tests exist.

**Trigger:** User request for full refactoring — backend + frontend — to clean code standards with FastAPI and Next.js best practices, plus production-grade API and E2E tests.

## Goals

1. **Backend: aiohttp → FastAPI** — Full cutover with Pydantic request/response models, dependency injection, and OpenAPI docs
2. **Backend: Decompose god files** — Every file under 300 lines, single responsibility
3. **Frontend: Component & hook hygiene** — Barrel exports, consistent naming, proper error boundaries
4. **Test suite: Production-grade** — FastAPI contract tests, Playwright E2E tests, frontend component tests

## Non-Goals

- Changing the agent pipeline logic (planner → executor flow stays the same)
- Changing the Cloudflare Worker auth layer
- Changing the database schema or migrations
- Changing the frontend design system (palette, typography, layout)
- Adding new features

## Architecture

### Current State

```
interfaces/
  http_service.py     (596L, aiohttp adapter)
  public_api.py       (1007L, god object: facade + session + response + models)
infrastructure/supabase/
  client.py           (857L, god object: all DB operations)
agents/
  executor_agent.py   (645L, all tool handlers in one file)
frontend/lib/
  api.ts              (347L, all API calls in one file)
  types.ts            (236L, all types in one file)
```

### Target State

```
interfaces/
  fastapi_service.py          (≤200L, FastAPI app + routes)
  dependencies.py             (≤100L, FastAPI Depends providers)
  schemas.py                  (≤150L, request/response Pydantic models, extracted from public_api.py)
  public_api.py               (≤300L, RuntimeAPI facade only — orchestration)
  response_builder.py         (≤150L, pipeline result → PublicAPIResponse conversion)
  session_facade.py           (≤200L, session load/persist/compact logic)

infrastructure/supabase/
  client.py                   (≤100L, pool management + base class only)
  repositories/
    __init__.py
    bangumi.py                (≤150L, bangumi table operations)
    points.py                 (≤150L, points table operations)
    session.py                (≤150L, session + conversation operations)
    feedback.py               (≤100L, feedback + request_log)
    user_memory.py            (≤100L, user memory operations)
    routes.py                 (≤100L, route persistence)

agents/
  executor_agent.py           (≤200L, dispatch loop + result types only)
  handlers/
    __init__.py
    resolve_anime.py          (≤100L)
    search_bangumi.py         (≤80L)
    search_nearby.py          (≤80L)
    plan_route.py             (≤100L)
    plan_selected.py          (≤100L)
    answer_question.py        (≤60L)
    greet_user.py             (≤60L)
  messages.py                 (≤70L, static _MESSAGES dict)

frontend/
  lib/
    api/
      index.ts                (barrel export)
      client.ts               (≤80L, auth headers + base fetch)
      runtime.ts              (≤100L, sendMessage + sendMessageStream)
      conversations.ts        (≤80L, conversation CRUD)
      routes.ts               (≤60L, route history)
      api-keys.ts             (moved from lib/)
    types/
      index.ts                (barrel export)
      api.ts                  (request/response types)
      domain.ts               (PilgrimagePoint, RouteData, etc.)
      components.ts           (component prop types)
  components/
    layout/index.ts           (barrel export)
    chat/index.ts             (barrel export)
    generative/index.ts       (barrel export)
    auth/index.ts             (barrel export)

tests/
  backend/tests/
    unit/test_fastapi_service.py
    unit/test_response_builder.py
    unit/test_session_facade.py
    unit/repositories/
      test_bangumi_repo.py
      test_points_repo.py
      test_session_repo.py
    integration/
      test_api_contract.py        (FastAPI TestClient, all endpoints)
      test_sse_contract.py        (SSE streaming behavior)
  e2e/
    playwright.config.ts
    tests/
      auth-flow.spec.ts
      search-flow.spec.ts
      route-planning.spec.ts
      conversation-history.spec.ts
  frontend/tests/
    components/
      MessageBubble.test.tsx
      PilgrimageGrid.test.tsx
      AppShell.test.tsx
    hooks/
      useChat.test.ts
      useSession.test.ts
```

## Task Breakdown

### Phase 1: Contract Lock (safety net before any refactoring)

**P1-T1: Extract Pydantic schemas from public_api.py**

Move `PublicAPIRequest`, `PublicAPIResponse`, `PublicAPIError` to `interfaces/schemas.py`. Update all imports. This is a mechanical move — no logic changes.

- Files: `backend/interfaces/schemas.py` (new), `backend/interfaces/public_api.py` (edit)
- AC: `make check` passes; all existing tests pass with new import paths

**P1-T2: Write FastAPI contract tests**

Using `httpx.AsyncClient` + `FastAPI.TestClient`, assert every endpoint's request/response shape:
- `GET /healthz` → 200, `{status, service, version}`
- `POST /v1/runtime` → 200, `PublicAPIResponse` shape
- `POST /v1/runtime/stream` → SSE with `event: planning`, `event: step`, `event: done`
- `GET /v1/conversations` → 200, list shape
- `GET /v1/conversations/{id}/messages` → 200, list shape
- `POST /v1/feedback` → 200
- `POST /v1/runtime` with blank text → 422, `{error: {code, message}}`
- Error JSON shape must be `{error: {code, message}}`, not FastAPI's default 422 detail

These tests run against the FastAPI adapter (written in P2) but define the contract NOW.

- Files: `backend/tests/integration/test_api_contract.py` (new), `backend/tests/integration/test_sse_contract.py` (new)
- AC: Tests exist and are importable; they will fail until P2 delivers the FastAPI adapter

### Phase 2: Backend — FastAPI Cutover + File Decomposition

**P2-T1: Create FastAPI adapter**

New `backend/interfaces/fastapi_service.py` with:
- All endpoints matching current aiohttp surface (`/healthz`, `/v1/runtime`, `/v1/runtime/stream`, `/v1/conversations`, etc.)
- FastAPI dependency injection for `RuntimeAPI`, `SupabaseClient`, `Settings`
- `dependencies.py` for `Depends()` providers
- Custom exception handlers to preserve `{error: {code, message}}` shape
- SSE via `StreamingResponse` with `asyncio.Queue` pattern (not buffered)
- CORS from settings, not hardcoded `*`
- Trusted headers (`X-User-Id`, `X-User-Type`) read via `Header()`

- Files: `backend/interfaces/fastapi_service.py` (new), `backend/interfaces/dependencies.py` (new)
- AC: All P1-T2 contract tests pass; `make serve` starts FastAPI on port 8080; `/docs` shows OpenAPI

**P2-T2: Switch entrypoints**

- `pyproject.toml` script → `backend.interfaces.fastapi_service:main`
- `Dockerfile` CMD → uvicorn
- `Makefile` `make serve` still works
- `.github/workflows/ci.yml` import check updated
- Add `fastapi`, `uvicorn` to dependencies; keep `aiohttp` temporarily (retriever uses `aiohttp.ClientSession`)

- Files: `pyproject.toml`, `Makefile`, `Dockerfile`, `.github/workflows/ci.yml`
- AC: `make serve` launches FastAPI; CI import check passes

**P2-T3: Decompose public_api.py**

Split into:
- `schemas.py` — already done in P1-T1
- `response_builder.py` — `_pipeline_result_to_public_response()`, `_application_error_response()`, `_build_message_for_result()`
- `session_facade.py` — `_load_session_state()`, `_persist_session()`, `_persist_messages()`, `_persist_user_state()`, `_build_updated_session_state()`, `_compact_session_interactions()`, `_load_user_memory()`, `_maybe_persist_route()`
- `public_api.py` — `RuntimeAPI.handle()` orchestration only, importing from above

- Files: `backend/interfaces/response_builder.py` (new), `backend/interfaces/session_facade.py` (new), `backend/interfaces/public_api.py` (edit)
- AC: All existing `test_public_api.py` tests pass; each file ≤ 300 lines

**P2-T4: Decompose supabase/client.py into repositories**

Split by domain:
- `repositories/bangumi.py` — `get_bangumi`, `list_bangumi`, `upsert_bangumi`, `get_bangumi_by_area`, `find_bangumi_by_title`, `upsert_bangumi_title`
- `repositories/points.py` — `get_points_by_bangumi`, `get_points_by_ids`, `search_points_by_location`, `upsert_point`, `upsert_points_batch`
- `repositories/session.py` — `get_session`, `upsert_session`, `upsert_conversation`, `update_conversation_title`, `get_conversations`, `get_conversation`, `upsert_session_state`, `get_session_state`, `delete_session_state`
- `repositories/feedback.py` — `save_feedback`, `insert_request_log`, `fetch_bad_feedback`, `fetch_request_log_unscored`, `update_request_log_score`
- `repositories/user_memory.py` — `upsert_user_memory`, `get_user_memory`
- `repositories/routes.py` — `save_route`, `get_user_routes`
- `repositories/messages.py` — `insert_message`, `get_messages`
- `client.py` — Pool management + composed facade (delegates to repos via `self.bangumi`, `self.points`, etc.)

Each repository takes a pool reference, not the full client. The `SupabaseClient` class keeps backward-compatible attribute access so callers don't all break at once.

- Files: `backend/infrastructure/supabase/repositories/` (new dir, 7 files), `backend/infrastructure/supabase/client.py` (edit)
- AC: `test_supabase_client.py` passes; each repo file ≤ 150 lines; `client.py` ≤ 150 lines

**P2-T5: Decompose executor_agent.py into handlers**

- `messages.py` — `_MESSAGES` dict + `_build_message()`
- `handlers/resolve_anime.py` — `_execute_resolve_anime()`
- `handlers/search_bangumi.py` — `_execute_search_bangumi()`
- `handlers/search_nearby.py` — `_execute_search_nearby()`
- `handlers/plan_route.py` — `_execute_plan_route()` + `_optimize_route()`
- `handlers/plan_selected.py` — `_execute_plan_selected()`
- `handlers/answer_question.py` — `_execute_answer_question()` + `_execute_clarify()`
- `handlers/greet_user.py` — `_execute_greet_user()`
- `executor_agent.py` — `ExecutorAgent` class with dispatch loop, `StepResult`, `PipelineResult`; imports handlers

Each handler is a standalone async function with signature `async def execute(step, db, context, on_step) -> StepResult`.

- Files: `backend/agents/handlers/` (new dir, 7 files), `backend/agents/messages.py` (new), `backend/agents/executor_agent.py` (edit)
- AC: `test_executor_agent.py` passes; executor_agent.py ≤ 200 lines

**P2-T6: Remove aiohttp adapter**

- Delete `backend/interfaces/http_service.py`
- Update `backend/interfaces/__init__.py`
- Remove or mark aiohttp-only tests
- Keep `aiohttp` in deps if `clients/base.py` still uses `aiohttp.ClientSession`

- Files: `backend/interfaces/http_service.py` (delete), `backend/interfaces/__init__.py` (edit)
- AC: No import of `http_service` anywhere; `make check` passes

### Phase 3: Frontend — Component & Hook Hygiene

**P3-T1: Split lib/api.ts into api/ module**

- `api/client.ts` — `getAuthHeaders()`, base URL config
- `api/runtime.ts` — `sendMessage()`, `sendMessageStream()`
- `api/conversations.ts` — `fetchConversations()`, `updateConversation()`, `fetchMessages()`
- `api/routes.ts` — `fetchUserRoutes()`
- `api/index.ts` — barrel re-export

Update all imports across components.

- Files: `frontend/lib/api/` (new dir, 5 files), `frontend/lib/api.ts` (delete)
- AC: `npm run build` succeeds; no `api.ts` single-file import remaining

**P3-T2: Split lib/types.ts into types/ module**

- `types/api.ts` — `RuntimeRequest`, `RuntimeResponse`, `ConversationRecord`, `RuntimeStreamEvent`
- `types/domain.ts` — `PilgrimagePoint`, `ResultsMeta`, `SearchResultData`, `RouteData`, `TimedItinerary`
- `types/components.ts` — Component prop interfaces
- `types/index.ts` — barrel re-export + type guards (`isSearchData`, `isRouteData`, `isQAData`)

- Files: `frontend/lib/types/` (new dir, 4 files), `frontend/lib/types.ts` (delete)
- AC: `npm run build` succeeds; `npm run typecheck` passes (if configured)

**P3-T3: Add barrel exports to component directories**

Add `index.ts` to each component subdirectory (`layout/`, `chat/`, `generative/`, `auth/`, `map/`, `settings/`, `ui/`).

- Files: 7 new `index.ts` files
- AC: Components importable via `@/components/layout` etc.

**P3-T4: Hook naming & deduplication audit**

- Verify `useConversationHistory` vs `lib/conversation-history.ts` — consolidate if overlapping
- Verify `lib/japanRegions.ts` usage — remove if dead code
- Verify `lib/utils.ts` usage — remove if dead code
- Ensure all hooks follow `use` + PascalCase convention

- Files: Various frontend files
- AC: No dead exports; all hooks consistently named

### Phase 4: Test Suite — Production-Grade

**P4-T1: Backend unit tests for new modules**

Write tests for the newly extracted modules:
- `test_response_builder.py` — pipeline result → response conversion
- `test_session_facade.py` — session state load/persist cycle
- `test_fastapi_service.py` — route registration, middleware, error handlers
- `tests/unit/repositories/` — one test file per repo (mock pool)

- Files: 6+ new test files under `backend/tests/unit/`
- AC: `make test` passes; new modules have > 80% line coverage

**P4-T2: Backend integration tests (FastAPI contract)**

Finalize and run the P1-T2 contract tests against the real FastAPI app with mocked DB:
- Every endpoint returns the correct shape
- Error responses match `{error: {code, message}}`
- SSE events arrive in order: `planning → step* → done`
- Auth header forwarding works

- Files: `backend/tests/integration/test_api_contract.py`, `backend/tests/integration/test_sse_contract.py`
- AC: `make test-integration` passes

**P4-T3: Frontend component tests**

Using Vitest + React Testing Library:
- `MessageBubble.test.tsx` — renders text, anchor card, handles click
- `PilgrimageGrid.test.tsx` — renders grid items, handles empty state
- `AppShell.test.tsx` — three-column layout renders, mobile drawer triggers
- `useChat.test.ts` — message send/receive flow
- `useSession.test.ts` — session creation/restoration

- Files: 5 new test files under `frontend/tests/`
- AC: `npm test` passes

**P4-T4: E2E tests with Playwright**

Set up Playwright targeting the deployed staging or local dev environment:
- `auth-flow.spec.ts` — magic link login → session created → sidebar shows history
- `search-flow.spec.ts` — type anime name → results grid appears → click point shows detail
- `route-planning.spec.ts` — select points → plan route → route visualization renders
- `conversation-history.spec.ts` — send messages → switch conversation → history preserved

- Files: `e2e/` directory with config + 4 spec files
- AC: `npx playwright test` passes against local dev

### Phase 5: Wire Up — CI, Deployment, Cleanup

**P5-T1: Update CI pipeline**

- Add FastAPI import check
- Add Playwright E2E step (can be optional/manual trigger)
- Add frontend test step (`npm test`)
- Remove aiohttp import check

- Files: `.github/workflows/ci.yml`
- AC: CI passes on PR

**P5-T2: Update deployment docs**

- `DEPLOYMENT.md` — FastAPI/uvicorn references
- `CLAUDE.md` — update architecture section, commands, tool descriptions

- Files: `DEPLOYMENT.md`, `CLAUDE.md`
- AC: Docs match actual runtime

**P5-T3: Final verification**

- `make check` green
- `make test-integration` green
- `npm run build` green
- `npm test` green
- Local smoke test: start server, hit all endpoints, verify SSE
- OpenAPI docs at `/docs` are complete

- AC: All gates pass; ready to deploy

## Iteration Phases (Execution Order)

```
Wave 1 (parallel):
  ├── P1-T1: Extract schemas           (backend, no deps)
  └── P3-T3: Barrel exports            (frontend, no deps)
  └── P3-T4: Hook/dead code audit      (frontend, no deps)

Wave 2 (parallel, after Wave 1):
  ├── P1-T2: Contract tests            (needs schemas from P1-T1)
  ├── P2-T4: Decompose supabase client (backend, needs P1-T1 for clean imports)
  ├── P2-T5: Decompose executor        (backend, independent)
  ├── P3-T1: Split api.ts              (frontend, independent)
  └── P3-T2: Split types.ts            (frontend, independent)

Wave 3 (after Wave 2):
  ├── P2-T3: Decompose public_api.py   (needs P2-T4 repos, P1-T1 schemas)
  └── P2-T1: FastAPI adapter           (needs P1-T1 schemas, P2-T4 repos)

Wave 4 (after Wave 3):
  ├── P2-T2: Switch entrypoints        (needs P2-T1 FastAPI adapter)
  ├── P2-T6: Remove aiohttp            (needs P2-T2)
  └── P4-T1: Backend unit tests        (needs P2-T3, P2-T4, P2-T5)

Wave 5 (after Wave 4):
  ├── P4-T2: Integration tests         (needs P2-T1 FastAPI running)
  ├── P4-T3: Frontend component tests  (needs P3-T1, P3-T2)
  └── P4-T4: E2E tests                 (needs full stack running)

Wave 6 (final):
  ├── P5-T1: CI update
  ├── P5-T2: Docs update
  └── P5-T3: Final verification
```

## Verification Plan

Each wave must pass before the next starts:
- **Wave 1-2:** `make check` + `npm run build`
- **Wave 3:** `make check` + all existing tests pass with new import paths
- **Wave 4:** `make check` + `make serve` starts FastAPI + `make test-integration`
- **Wave 5:** Full test suite green
- **Wave 6:** Complete CI pipeline green

## Dependencies

- `fastapi` + `uvicorn[standard]` — new Python deps
- `httpx` — for FastAPI async test client
- `playwright` — for E2E tests (dev dependency)
- `vitest` + `@testing-library/react` — for frontend tests (dev dependency)

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Breaking existing API contracts during refactor | Contract tests (P1-T2) lock the shape before any changes |
| Import chain breakage after file splits | Each decomposition step runs `make check` before continuing |
| SSE behavior regression | Dedicated SSE contract test asserts event order |
| Frontend build breakage from type/api split | `npm run build` gate after each frontend change |
| aiohttp removal breaks clients/base.py | Keep aiohttp dep if ClientSession still used; only remove http_service.py |
