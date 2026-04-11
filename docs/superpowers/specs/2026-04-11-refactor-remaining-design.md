# Refactor Remaining Work: Frontend Splits + Backend Tests + CI Wiring

## Context

Parent spec: `docs/superpowers/specs/2026-04-07-full-stack-refactor-design.md`

The full-stack refactor (Phases 1-2) landed successfully: FastAPI adapter live, aiohttp removed, supabase client decomposed into 7 repositories, executor handlers extracted. However, three areas remain incomplete:

1. **Phase 3 (Frontend):** `frontend/lib/api.ts` (393L) and `frontend/lib/types.ts` (236L) are monolithic files that need splitting into module directories.
2. **Phase 4 (partial):** `test_fastapi_service.py` (route registration, middleware, error handlers) and `tests/unit/repositories/` (per-repo unit tests) were never written. Note: `test_fastapi_service_helpers.py` exists and covers helper functions (`_http_error_code`, `_call_optional_async`, `_require_db_method`, `_contains_json_invalid_error`), but route handlers and app creation paths are untested.
3. **Phase 5 (partial):** CI pipeline (`ci.yml`) has no frontend test step and no Playwright E2E step.

## Goals

1. Split `frontend/lib/api.ts` into `frontend/lib/api/` module (6 files, barrel export)
2. Split `frontend/lib/types.ts` into `frontend/lib/types/` module (4 files, barrel export)
3. Write `backend/tests/unit/test_fastapi_service.py` covering route handlers, app creation, exception handlers
4. Write `backend/tests/unit/repositories/` with one test file per repository (7 repos, mock pool)
5. Add `frontend-test` and `playwright-e2e` steps to `.github/workflows/ci.yml`

## Non-Goals

- Changing any runtime behavior (these are purely structural splits and test additions)
- Writing Playwright E2E spec files (only the CI step wiring; E2E spec authoring is a separate iteration)
- Writing Vitest component tests (only the CI step wiring; component test authoring is a separate iteration)
- Installing Vitest/testing-library in frontend (that is a prerequisite for component tests, not this iteration)
- Extracting `dependencies.py` from `fastapi_service.py` (tracked separately as P2-T1 remainder)
- Further decomposing `public_api.py` (tracked separately as P2-T3 remainder)

## Architecture

### Frontend lib/api.ts split

Current 393L file contains: auth headers, sendMessage, sendSelectedRoute, SSE parsing, sendMessageStream, submitFeedback, fetchConversations, fetchConversationMessages, fetchRouteHistory, patchConversationTitle, hydrateResponseData, buildSelectedRouteActionText.

Target structure:
```
frontend/lib/api/
  index.ts              -- barrel re-export of all public functions
  client.ts             -- RUNTIME_URL, getAuthHeaders(), parseResponseData(), hydrateResponseData()
  runtime.ts            -- sendMessage(), sendSelectedRoute(), sendMessageStream(), parseSSEChunk(),
                           buildSelectedRouteActionText(), SELECTED_ROUTE_ACTION_TEXT, StreamEventPayload type
  conversations.ts      -- fetchConversations(), fetchConversationMessages(), ConversationMessage interface,
                           patchConversationTitle()
  routes.ts             -- fetchRouteHistory(), RouteHistoryEntry interface
  feedback.ts           -- submitFeedback()
```

### Frontend lib/types.ts split

Current 236L file contains: Intent, PilgrimagePoint, ResultsMeta, SearchResultData, RouteData, LocationCluster, TimedStop, TransitLeg, TimedItinerary, QAData, RuntimeRequest, PublicAPIError, StepEvent, RouteHistoryRecord, ConversationRecord, UIDescriptor, RuntimeResponse, ErrorCode, ChatMessage, type guards.

Target structure:
```
frontend/lib/types/
  index.ts              -- barrel re-export + type guards (isSearchData, isRouteData, isQAData, isTimedRouteData)
  api.ts                -- RuntimeRequest, RuntimeResponse, PublicAPIError, StepEvent,
                           RouteHistoryRecord, ConversationRecord, UIDescriptor, Intent
  domain.ts             -- PilgrimagePoint, ResultsMeta, SearchResultData, RouteData, LocationCluster,
                           TimedStop, TransitLeg, TimedItinerary, QAData, TimedRouteData
  components.ts         -- ErrorCode, ChatMessage (frontend-only types)
```

### Backend test additions

- `test_fastapi_service.py` -- tests route handler registration, CORS middleware, exception handler shapes, app lifespan (create_fastapi_app with injected runtime_api), auth context extraction. Complements existing `test_fastapi_service_helpers.py` (which covers utility functions only).
- `tests/unit/repositories/` -- one test file per repo: bangumi (88L), points (141L), session (150L), feedback (114L), user_memory (80L), routes (80L), messages (46L). Each mocks the asyncpg pool with AsyncMock and tests method input/output.

### CI additions

- `frontend-test` job: runs after `frontend-quality`, executes `npm test` (placeholder until Vitest is configured; job uses `continue-on-error: true` initially)
- `playwright-e2e` job: optional manual trigger via `workflow_dispatch`, runs Playwright against local dev stack

## Task Breakdown

### Task 1: Split frontend/lib/api.ts into api/ module

- **Scope:** Create `frontend/lib/api/` directory with 6 files. Delete original `api.ts`. Update all imports across the frontend codebase.
- **Files changed:**
  - `frontend/lib/api/index.ts` (new)
  - `frontend/lib/api/client.ts` (new)
  - `frontend/lib/api/runtime.ts` (new)
  - `frontend/lib/api/conversations.ts` (new)
  - `frontend/lib/api/routes.ts` (new)
  - `frontend/lib/api/feedback.ts` (new)
  - `frontend/lib/api.ts` (delete)
  - All files importing from `../lib/api` or `@/lib/api` (update imports)
- **AC (with mandatory categories):**
  - [ ] Happy path: `npm run build` succeeds after split; all public functions are importable from `@/lib/api` -> unit
  - [ ] Happy path: No import of the old `lib/api.ts` single-file path remains in any `.ts`/`.tsx` file -> unit
  - [ ] Null/empty: `getAuthHeaders()` returns empty object when no supabase session exists (behavior preserved) -> unit
  - [ ] Error path: `sendMessage()` still throws on non-ok HTTP response (behavior preserved) -> unit
  - [ ] Happy path: `npx tsc --noEmit` passes (no type errors introduced) -> unit

### Task 2: Split frontend/lib/types.ts into types/ module

- **Scope:** Create `frontend/lib/types/` directory with 4 files. Delete original `types.ts`. Update all imports across the frontend codebase.
- **Files changed:**
  - `frontend/lib/types/index.ts` (new)
  - `frontend/lib/types/api.ts` (new)
  - `frontend/lib/types/domain.ts` (new)
  - `frontend/lib/types/components.ts` (new)
  - `frontend/lib/types.ts` (delete)
  - All files importing from `../lib/types` or `@/lib/types` (update imports)
- **AC (with mandatory categories):**
  - [ ] Happy path: `npm run build` succeeds; all types importable from `@/lib/types` -> unit
  - [ ] Happy path: Type guards (`isSearchData`, `isRouteData`, `isQAData`, `isTimedRouteData`) remain in barrel export and function correctly -> unit
  - [ ] Null/empty: `isSearchData(null)` returns false, `isRouteData(undefined)` returns false -> unit
  - [ ] Error path: Importing a non-existent type from `@/lib/types` produces a TypeScript error at compile time -> unit
  - [ ] Happy path: `npx tsc --noEmit` passes -> unit

### Task 3: Write test_fastapi_service.py (route handlers + app creation)

- **Scope:** Unit tests for FastAPI service: route registration, exception handlers, CORS configuration, auth context extraction, app lifespan with injected dependencies. Complements existing `test_fastapi_service_helpers.py` (which covers utility functions).
- **Files changed:**
  - `backend/tests/unit/test_fastapi_service.py` (new)
- **AC (with mandatory categories):**
  - [ ] Happy path: GET /healthz returns 200 with `{status, service}` shape using TestClient -> unit
  - [ ] Happy path: POST /v1/runtime with valid request + mocked RuntimeAPI returns 200 with PublicAPIResponse shape -> unit
  - [ ] Happy path: POST /v1/feedback with valid payload returns 200 with `{feedback_id}` -> unit
  - [ ] Happy path: GET /v1/conversations with X-User-Id header returns 200 -> unit
  - [ ] Happy path: PATCH /v1/conversations/{id} with valid title returns 200 -> unit
  - [ ] Happy path: GET /v1/routes with X-User-Id returns 200 with `{routes}` shape -> unit
  - [ ] Null/empty: POST /v1/runtime with empty text field returns 422 with `{error: {code, message}}` shape (not FastAPI default) -> unit
  - [ ] Null/empty: GET /v1/conversations without X-User-Id header returns 400 -> unit
  - [ ] Error path: POST /v1/runtime with invalid JSON returns 400 with `{error: {code: "invalid_json"}}` -> unit
  - [ ] Error path: Unhandled exception in RuntimeAPI.handle returns 500 with `{error: {code: "internal_error"}}` -> unit
  - [ ] Error path: GET /v1/conversations/{id}/messages for non-existent conversation returns 404 -> unit
  - [ ] Happy path: CORS middleware allows configured origin -> unit
  - [ ] Happy path: create_fastapi_app with injected runtime_api sets app.state correctly -> unit

### Task 4: Write repository unit tests

- **Scope:** One test file per repository in `backend/infrastructure/supabase/repositories/`. Each test mocks the asyncpg pool with AsyncMock, tests input/output of every public method.
- **Files changed:**
  - `backend/tests/unit/repositories/__init__.py` (new)
  - `backend/tests/unit/repositories/test_bangumi_repo.py` (new)
  - `backend/tests/unit/repositories/test_points_repo.py` (new)
  - `backend/tests/unit/repositories/test_session_repo.py` (new)
  - `backend/tests/unit/repositories/test_feedback_repo.py` (new)
  - `backend/tests/unit/repositories/test_user_memory_repo.py` (new)
  - `backend/tests/unit/repositories/test_routes_repo.py` (new)
  - `backend/tests/unit/repositories/test_messages_repo.py` (new)
- **AC (with mandatory categories):**
  - [ ] Happy path: BangumiRepo.get_bangumi returns dict when row exists (mock pool.fetchrow returns data) -> unit
  - [ ] Happy path: PointsRepo.get_points_by_bangumi returns list of dicts -> unit
  - [ ] Happy path: SessionRepo.upsert_session calls pool.execute with correct params -> unit
  - [ ] Happy path: FeedbackRepo.save_feedback returns feedback_id string -> unit
  - [ ] Happy path: UserMemoryRepo.get_user_memory returns dict or None -> unit
  - [ ] Happy path: RoutesRepo.get_user_routes returns list -> unit
  - [ ] Happy path: MessagesRepo.insert_message calls pool.execute -> unit
  - [ ] Null/empty: BangumiRepo.get_bangumi returns None when pool.fetchrow returns None -> unit
  - [ ] Null/empty: PointsRepo.search_points_by_location with zero radius returns empty list -> unit
  - [ ] Null/empty: MessagesRepo.get_messages returns empty list when pool.fetch returns [] -> unit
  - [ ] Error path: BangumiRepo.get_bangumi raises when pool raises asyncpg.PostgresError -> unit
  - [ ] Error path: FeedbackRepo.save_feedback propagates pool exceptions -> unit
  - [ ] Error path: SessionRepo.get_session_state raises on pool error -> unit

### Task 5: Add frontend-test and playwright-e2e CI steps

- **Scope:** Add two new jobs to `.github/workflows/ci.yml`: a frontend test step and an optional Playwright E2E step.
- **Files changed:**
  - `.github/workflows/ci.yml` (edit)
- **AC (with mandatory categories):**
  - [ ] Happy path: `frontend-test` job exists in ci.yml, runs after `frontend-quality`, executes `npm test` in `frontend/` working directory -> integration
  - [ ] Happy path: `playwright-e2e` job exists with `workflow_dispatch` trigger, runs Playwright -> integration
  - [ ] Null/empty: `frontend-test` job has `continue-on-error: true` until Vitest is installed (graceful no-op) -> integration
  - [ ] Error path: `playwright-e2e` job is not in the `deploy.needs` list (does not block production deploys) -> integration
  - [ ] Happy path: Existing CI jobs remain unchanged and pass (no regressions) -> integration

## Verification Plan

1. **After Tasks 1-2 (frontend splits):** Run `cd frontend && npm run build && npx tsc --noEmit` -- both must succeed. Grep for old import paths (`from.*["'].*lib/api["']` excluding `lib/api/`) to confirm no stale imports.
2. **After Tasks 3-4 (backend tests):** Run `make test` -- all unit tests pass including new ones. Verify coverage does not decrease.
3. **After Task 5 (CI):** Push branch, confirm CI passes. Verify `frontend-test` job appears. Verify `playwright-e2e` job is only triggered on `workflow_dispatch`.
4. **Final:** `make check` green, `npm run build` green.

## Dependencies

- Tasks 1 and 2 are independent of each other (can be parallelized)
- Tasks 3 and 4 are independent of each other (can be parallelized)
- Tasks 1-2 are independent of Tasks 3-4 (frontend vs backend, can be parallelized)
- Task 5 depends on nothing but should be done last so the CI config references the correct test commands
- No new package installations required for backend tests (pytest, httpx, AsyncMock are already available)
- Frontend test CI step is a placeholder until Vitest is installed (separate iteration)

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Import path breakage after api.ts split | Build failure | Medium | Barrel re-export preserves `@/lib/api` path; grep for stale imports before committing |
| Type re-export ordering causes circular deps | Build failure | Low | Keep type guards in `types/index.ts`, domain types import nothing from api types |
| Repository tests couple to SQL strings | Brittle tests | Medium | Test method signatures and mock call args, not SQL text content |
| `frontend-test` CI step fails because no test runner exists | CI red | High | Use `continue-on-error: true` until Vitest is installed |
| New unit tests reduce overall coverage percentage (more files, same covered lines) | CI gate failure | Low | New tests add coverage, not reduce it; verify with `--cov-fail-under=70` locally |
