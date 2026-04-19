# Code Smell Refactor — God Modules & Components

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split 6 god modules/components and 2 god test files identified in the 2026-04-19 code smell audit. Each wave is independently shippable.

**Ref:** Code smell audit in conversation, executor.md smell prevention rules, `/backend-tdd` and `/frontend-tdd` skills

**Depends on:** `6406196` (smell fixes + TDD skills + agent updates already landed on main)

---

## Wave 1: Backend God Modules (3 cards, parallel)

### Card 1A: Split `fastapi_service.py` (694 lines → ~5 files)

**Why:** Single file owns 8 endpoints, 4 exception handlers, middleware, and app factory. Any change to any endpoint touches this file.

**AC:**
- [ ] Extract health routes → `backend/interfaces/routes/health.py` (`/healthz`) → unit
- [ ] Extract runtime routes → `backend/interfaces/routes/runtime.py` (`/v1/runtime`, `/v1/runtime/stream`) → unit
- [ ] Extract feedback routes → `backend/interfaces/routes/feedback.py` (`/v1/feedback`) → unit
- [ ] Extract conversation routes → `backend/interfaces/routes/conversations.py` → unit
- [ ] Extract bangumi routes → `backend/interfaces/routes/bangumi.py` (`/v1/bangumi/*`) → unit
- [ ] Keep app factory + middleware in `fastapi_service.py` (should be <100 lines) → unit
- [ ] All existing tests in `test_fastapi_service.py` still pass
- [ ] No new `Any` types introduced

**Files:**
- MODIFY: `backend/interfaces/fastapi_service.py`
- CREATE: `backend/interfaces/routes/health.py`
- CREATE: `backend/interfaces/routes/runtime.py`
- CREATE: `backend/interfaces/routes/feedback.py`
- CREATE: `backend/interfaces/routes/conversations.py`
- CREATE: `backend/interfaces/routes/bangumi.py`
- CREATE: `backend/interfaces/routes/__init__.py`

---

### Card 1B: Split `public_api.py` (564 lines → ~3 files)

**Why:** `RuntimeAPI.handle()` is 217 lines doing session load, pipeline exec, persistence, route saving, and title generation. Feature envy toward session_facade.

**AC:**
- [ ] Extract `handle()` into 3 methods: `_load_session()`, `_execute_pipeline()`, `_persist_result()` → unit
- [ ] Extract route persistence → `_persist_route()` private method → unit
- [ ] Extract request logging → `_log_request()` private method → unit
- [ ] `RuntimeAPI` stays under 200 lines after extraction
- [ ] No behavioral changes — all existing `test_public_api.py` tests pass
- [ ] No new `dict[str, object]` patterns — use typed returns

**Files:**
- MODIFY: `backend/interfaces/public_api.py`

---

### Card 1C: Split `retriever.py` (551 lines → ~3 files)

**Why:** 20+ private methods spanning SQL, geo, hybrid, write-through, bangumi enrichment, and caching. Too many unrelated concerns.

**AC:**
- [ ] Extract geo retrieval → `backend/agents/retrievers/geo.py` → unit
- [ ] Extract hybrid retrieval → `backend/agents/retrievers/hybrid.py` → unit
- [ ] Extract bangumi enrichment/write-through → `backend/agents/retrievers/enrichment.py` → unit
- [ ] Keep strategy dispatch + caching in `retriever.py` (<150 lines) → unit
- [ ] All existing retriever tests pass
- [ ] Cache behavior unchanged

**Files:**
- MODIFY: `backend/agents/retriever.py`
- CREATE: `backend/agents/retrievers/__init__.py`
- CREATE: `backend/agents/retrievers/geo.py`
- CREATE: `backend/agents/retrievers/hybrid.py`
- CREATE: `backend/agents/retrievers/enrichment.py`

---

## Wave 2: Frontend God Components (3 cards, parallel)

### Card 2A: Split `AuthGate.tsx` (465+ lines → ~4 files)

**Why:** Owns auth state, landing page layout, pin rendering, scroll-reveal, language switching, auth modal, and form logic. Every landing page change touches this one file.

**AC:**
- [ ] Extract landing page → `frontend/components/auth/LandingPage.tsx` → unit
- [ ] Extract auth modal → `frontend/components/auth/AuthModal.tsx` → unit
- [ ] Extract scroll-reveal hook → `frontend/hooks/useScrollReveal.ts` → unit
- [ ] `AuthGate.tsx` stays under 80 lines (auth state + routing only) → unit
- [ ] Visual appearance unchanged (verify with `/qa`)
- [ ] All existing auth tests pass

**Files:**
- MODIFY: `frontend/components/auth/AuthGate.tsx`
- CREATE: `frontend/components/auth/LandingPage.tsx`
- CREATE: `frontend/components/auth/AuthModal.tsx`
- CREATE: `frontend/hooks/useScrollReveal.ts`

---

### Card 2B: Split `RoutePlannerWizard.tsx` (444 lines → ~3 files)

**Why:** Duplicated timeline rendering (desktop + mobile), plus map, export, pacing, and responsive logic all in one component.

**AC:**
- [ ] Extract timeline → `frontend/components/generative/RouteTimeline.tsx` (used by both desktop and mobile) → unit
- [ ] Extract export handlers → `frontend/hooks/useRouteExport.ts` → unit
- [ ] Remove duplicated timeline code (desktop TimelineSidebar + mobile Drawer both use `RouteTimeline`) → unit
- [ ] `RoutePlannerWizard.tsx` stays under 150 lines → unit
- [ ] Route visualization appearance unchanged

**Files:**
- MODIFY: `frontend/components/generative/RoutePlannerWizard.tsx`
- CREATE: `frontend/components/generative/RouteTimeline.tsx`
- CREATE: `frontend/hooks/useRouteExport.ts`

---

### Card 2C: Reduce `AppShell.tsx` (373 lines) state coupling

**Why:** 8 state variables + 5 hooks + complex interdependencies. Prop drilling `onSuggest` and `onOpenDrawer` through 3 levels.

**AC:**
- [ ] Create `SuggestContext` to replace `onSuggest` prop drilling → unit
- [ ] Extract route-selected handler → `frontend/hooks/useRouteSelection.ts` → unit
- [ ] `AppShell.tsx` stays under 200 lines after extraction → unit
- [ ] All existing AppShell layout tests pass
- [ ] No new prop drilling introduced

**Files:**
- MODIFY: `frontend/components/layout/AppShell.tsx`
- MODIFY: `frontend/components/chat/ChatPanel.tsx`
- MODIFY: `frontend/components/chat/MessageList.tsx`
- MODIFY: `frontend/components/chat/MessageBubble.tsx`
- CREATE: `frontend/contexts/SuggestContext.tsx`
- CREATE: `frontend/hooks/useRouteSelection.ts`

---

## Wave 3: Test File Splits (2 cards, parallel)

### Card 3A: Split `test_public_api.py` (1141 lines → ~4 files)

**AC:**
- [ ] Split by concern: `test_public_api_session.py`, `test_public_api_pipeline.py`, `test_public_api_persistence.py`, `test_public_api_errors.py` → unit
- [ ] Each file under 300 lines
- [ ] All 617 backend tests still pass
- [ ] No test logic changes, only file reorganization

**Files:**
- MODIFY: `backend/tests/unit/test_public_api.py`
- CREATE: `backend/tests/unit/test_public_api_session.py`
- CREATE: `backend/tests/unit/test_public_api_pipeline.py`
- CREATE: `backend/tests/unit/test_public_api_persistence.py`

---

### Card 3B: Split `test_fastapi_service.py` (597 lines → ~3 files)

**AC:**
- [ ] Split by endpoint group: `test_routes_health.py`, `test_routes_runtime.py`, `test_routes_data.py` → unit
- [ ] Each file under 250 lines
- [ ] All tests still pass
- [ ] No test logic changes

**Files:**
- MODIFY: `backend/tests/unit/test_fastapi_service.py`
- CREATE: `backend/tests/unit/test_routes_health.py`
- CREATE: `backend/tests/unit/test_routes_runtime.py`
- CREATE: `backend/tests/unit/test_routes_data.py`

---

## Wave Graph

```
Wave 1: [1A] [1B] [1C]  ← parallel, backend only
           ↓
Wave 2: [2A] [2B] [2C]  ← parallel, frontend only
           ↓
Wave 3: [3A] [3B]       ← parallel, test-only (3A depends on 1B, 3B depends on 1A)
```

Wave 1 and Wave 2 can run in parallel since they touch different stacks. Wave 3 should follow Wave 1 since the test files mirror the production files being split.

## Wave 4: Backend MEDIUM Smells (4 cards, parallel)

### Card 4A: Fix `base.py` god class (533 lines)

**Why:** BaseHTTPClient owns request building, caching, rate limiting, retry logic, session management, JSON normalization, and error handling. 5 exception handlers nested in `_make_request()`.

**AC:**
- [ ] Extract caching → `backend/clients/cache_mixin.py` or separate class → unit
- [ ] Extract retry/rate-limiting → `backend/clients/retry.py` → unit
- [ ] `_make_request()` reduced from 68 lines to <20 → unit
- [ ] `request()` reduced from 69 lines to <20 → unit
- [ ] `base.py` under 200 lines → unit
- [ ] All `test_base_client.py` tests pass

**Files:**
- MODIFY: `backend/clients/base.py`
- CREATE: `backend/clients/cache_mixin.py`
- CREATE: `backend/clients/retry.py`

---

### Card 4B: Fix `anitabi.py` schema branching (168-line function)

**Why:** `get_bangumi_points()` has two inline branching paths (legacy vs official schema) with 12+ params per Point constructor. Complex conditionals make it hard to add new schema versions.

**AC:**
- [ ] Extract legacy schema adapter → `_parse_legacy_point()` → unit
- [ ] Extract official schema adapter → `_parse_official_point()` → unit
- [ ] Extract schema detection → `_detect_schema()` → unit
- [ ] `get_bangumi_points()` reduced to <30 lines (detect + delegate) → unit
- [ ] All existing anitabi tests pass

**Files:**
- MODIFY: `backend/clients/anitabi.py`

---

### Card 4C: Fix `session_facade.py` long parameter lists + primitive obsession

**Why:** `build_updated_session_state()` takes 7 parameters. Session state passed as untyped dict through 10+ functions.

**AC:**
- [ ] Create `SessionUpdate` dataclass for the 7 params → unit
- [ ] Create `ContextDelta` dataclass for context_delta dict → unit
- [ ] `build_updated_session_state()` accepts `SessionUpdate` instead of 7 kwargs → unit
- [ ] No `dict[str, object]` for session state — use typed model → unit
- [ ] All session-related tests pass

**Files:**
- MODIFY: `backend/interfaces/session_facade.py`
- MODIFY: `backend/interfaces/public_api.py` (caller)

---

### Card 4D: Fix `route_optimizer.py` mixed concerns (383 lines)

**Why:** Contains haversine distance, coordinate validation, union-find clustering, timed itinerary building, Google Maps URL encoding, and ICS calendar generation — 6 unrelated domains.

**AC:**
- [ ] Extract haversine + coordinate validation → `backend/agents/geo_utils.py` → unit
- [ ] Extract ICS generation → `backend/agents/export/ics.py` → unit
- [ ] Extract Google Maps URL → `backend/agents/export/maps_url.py` → unit
- [ ] `route_optimizer.py` keeps only clustering + itinerary (<200 lines) → unit
- [ ] All route optimizer tests pass

**Files:**
- MODIFY: `backend/agents/route_optimizer.py`
- CREATE: `backend/agents/geo_utils.py`
- CREATE: `backend/agents/export/__init__.py`
- CREATE: `backend/agents/export/ics.py`
- CREATE: `backend/agents/export/maps_url.py`

---

## Wave 5: Backend Duplicated Code + Intimacy (2 cards, parallel)

### Card 5A: Deduplicate search handlers

**Why:** `search_bangumi.py` and `search_nearby.py` follow identical patterns (extract → build RetrievalRequest → execute → return dict). 45 vs 39 lines of near-identical code.

**AC:**
- [ ] Extract shared handler template → `backend/agents/handlers/_base_search.py` → unit
- [ ] `search_bangumi.py` and `search_nearby.py` delegate to shared template → unit
- [ ] Each handler file under 20 lines → unit
- [ ] No behavioral changes

**Files:**
- MODIFY: `backend/agents/handlers/search_bangumi.py`
- MODIFY: `backend/agents/handlers/search_nearby.py`
- CREATE: `backend/agents/handlers/_base_search.py`

---

### Card 5B: Fix `supabase/client.py` inappropriate intimacy

**Why:** `__getattr__` delegates to 7 repositories, hiding real coupling. Properties use runtime assertion. Middle-man pattern adds no value.

**AC:**
- [ ] Remove `__getattr__` delegation — expose repositories as explicit properties → unit
- [ ] Callers access `db.bangumi.find_by_title()` instead of `db.find_bangumi_by_title()` → unit
- [ ] Remove pass-through methods that add no logic → unit
- [ ] All callers updated (public_api, retriever, fastapi_service) → integration
- [ ] No `__getattr__` magic remaining

**Files:**
- MODIFY: `backend/infrastructure/supabase/client.py`
- MODIFY: `backend/interfaces/public_api.py`
- MODIFY: `backend/interfaces/fastapi_service.py`
- MODIFY: `backend/agents/retriever.py`

---

## Wave 6: Frontend MEDIUM Smells (3 cards, parallel)

### Card 6A: Extract `MessageBubble.tsx` sub-components (296 lines)

**Why:** 4 nested sub-components (ClarificationBubble, ErrorDisplay, ResultAnchor, FeedbackButtons) defined inline. Hard to test individually.

**AC:**
- [ ] Extract `ClarificationBubble` → `frontend/components/chat/ClarificationBubble.tsx` → unit
- [ ] Extract `ResultAnchor` → `frontend/components/chat/ResultAnchor.tsx` → unit
- [ ] Extract `FeedbackButtons` → `frontend/components/chat/FeedbackButtons.tsx` → unit
- [ ] `MessageBubble.tsx` under 100 lines → unit
- [ ] All message rendering tests pass

**Files:**
- MODIFY: `frontend/components/chat/MessageBubble.tsx`
- CREATE: `frontend/components/chat/ClarificationBubble.tsx`
- CREATE: `frontend/components/chat/ResultAnchor.tsx`
- CREATE: `frontend/components/chat/FeedbackButtons.tsx`

---

### Card 6B: Fix i18n for `ThinkingProcess` + `NearbyChips`

**Why:** `TOOL_LABELS` hardcodes English strings ("Resolving anime title...") in a 3-locale app. `CHIP_COLORS` uses Tailwind palette (`bg-blue-500`) instead of design system CSS variables.

**AC:**
- [ ] Move `TOOL_LABELS` to i18n dictionaries (ja.json, zh.json, en.json) → unit
- [ ] `ThinkingProcess.tsx` uses `useDict()` for tool labels → unit
- [ ] Replace `CHIP_COLORS` Tailwind palette with `bg-[var(--color-*)]` tokens → unit
- [ ] Update all 3 locale dictionaries → unit
- [ ] Visual appearance unchanged

**Files:**
- MODIFY: `frontend/components/chat/ThinkingProcess.tsx`
- MODIFY: `frontend/components/generative/NearbyChips.tsx`
- MODIFY: `frontend/lib/dictionaries/en.json`
- MODIFY: `frontend/lib/dictionaries/ja.json`
- MODIFY: `frontend/lib/dictionaries/zh.json`

---

### Card 6C: Deduplicate quick action queries

**Why:** `ChatInput.tsx` and `WelcomeScreen.tsx` both define locale-specific query strings inline. DRY violation — change one, forget the other.

**AC:**
- [ ] Extract shared query constants → `frontend/lib/quick-actions.ts` → unit
- [ ] Both `ChatInput` and `WelcomeScreen` import from shared file → unit
- [ ] Replace nested ternaries (`locale === "ja" ? ... : locale === "zh" ? ...`) with lookup → unit
- [ ] No behavioral changes

**Files:**
- MODIFY: `frontend/components/chat/ChatInput.tsx`
- MODIFY: `frontend/components/chat/WelcomeScreen.tsx`
- CREATE: `frontend/lib/quick-actions.ts`

---

## Wave 7: Test Improvements (3 cards, parallel)

### Card 7A: Reduce excessive mocking in `appshell-layout.test.tsx`

**Why:** 12 mocks make the test meaningless — it's testing mock behavior, not the component.

**AC:**
- [ ] Reduce mocks to essential ones only (hooks that need browser APIs) → unit
- [ ] Use real child components where possible → integration
- [ ] Add missing interaction tests: new chat button, history button → unit
- [ ] File stays under 200 lines

**Files:**
- MODIFY: `frontend/tests/appshell-layout.test.tsx`

---

### Card 7B: Add missing interaction tests

**Why:** `ChatPanel.test.tsx` and `ConversationDrawer.test.tsx` only test render, never test user clicks/input.

**AC:**
- [ ] `ChatPanel.test.tsx`: add test for sending a message → unit
- [ ] `ConversationDrawer.test.tsx`: add test for selecting a conversation (verifies `onSelectConversation` callback) → unit
- [ ] `ConversationDrawer.test.tsx`: add test for new chat button → unit
- [ ] All new tests use `fireEvent` or `userEvent`

**Files:**
- MODIFY: `frontend/tests/ChatPanel.test.tsx`
- MODIFY: `frontend/tests/ConversationDrawer.test.tsx`

---

### Card 7C: Split god test files + add edge cases

**Why:** `clarification-redesign.test.tsx` (294 lines) tests 2 components. `result-panel.test.tsx` (437 lines) tests 6 features. Backend `test_entities.py` (550 lines) tests 6 entity classes. Missing edge cases for cache, retry, and validation.

**AC:**
- [ ] Split `clarification-redesign.test.tsx` into `clarification.test.tsx` + `message-bubble-clarification.test.tsx` → unit
- [ ] Split `result-panel.test.tsx` into `result-panel-empty.test.tsx` + `result-panel-grid.test.tsx` + `result-panel-filter.test.tsx` → unit
- [ ] Split `test_entities.py` by entity class → unit
- [ ] Add edge case: `points_count=0` valid boundary in Bangumi validation → unit
- [ ] Add edge case: cache with empty string, zero value, nested dict → unit
- [ ] Add edge case: retry with `exponential_base=1`, negative `base_delay` → unit
- [ ] Use `@pytest.mark.parametrize` where tests have identical structure → unit

**Files:**
- MODIFY/SPLIT: `frontend/tests/clarification-redesign.test.tsx`
- MODIFY/SPLIT: `frontend/tests/result-panel.test.tsx`
- MODIFY/SPLIT: `backend/tests/unit/test_entities.py`
- MODIFY: `backend/tests/unit/test_cache.py`
- MODIFY: `backend/tests/unit/test_retry.py`

---

## Updated Wave Graph

```
Wave 1: [1A] [1B] [1C]              ← backend god modules
Wave 2: [2A] [2B] [2C]              ← frontend god components (parallel with W1)
           ↓
Wave 3: [3A] [3B]                   ← test file splits (depends on W1)
Wave 4: [4A] [4B] [4C] [4D]        ← backend medium smells (parallel with W3)
Wave 5: [5A] [5B]                   ← backend dedup + intimacy (depends on W4)
Wave 6: [6A] [6B] [6C]             ← frontend medium smells (parallel with W4-5)
Wave 7: [7A] [7B] [7C]             ← test improvements (depends on W6)
```

Waves 1+2 can run in parallel. Waves 4+6 can run in parallel. Each wave takes 1-2 executor sessions.

## Already Fixed (2026-04-19, commit `6406196`)

These items from the audit were fixed directly and do NOT need cards:

| Item | Fix |
|---|---|
| `assert` → `RuntimeError` in supabase client (7 properties) | Done |
| `assert` → `ValueError` in retriever | Done |
| `RoutePlanParams` dataclass in `_helpers.py` | Done |
| Flaky timing tests widened (`test_retry.py`) | Done |
| Weak assertions strengthened (`test_cache.py`) | Done |
| Conditional test logic removed (`test_api_e2e.py`) | Done |
| 20 assertion messages added (`test_route_optimizer.py`) | Done |
| Eager test split into 3 (`test_entities.py`) | Done |
| `.not.toBeNull()` → `.toBeInTheDocument()` (frontend tests) | Done |
| CSS class assertion → `data-active` (ConversationDrawer) | Done |
| Conditional `fireEvent` fixed (clarification test) | Done |
| Dead `_dict`/`_pacing` removed (RoutePlannerWizard) | Done |
| TODO markers for i18n + design tokens | Done |
| `bg-white` → design tokens (9 files, commit `6b76ece`) | Done |
| `bg-gray-200` → design tokens | Done |
| IconSidebar inline → Tailwind | Done |
| ResultPanelToolbar inline → Tailwind | Done |
| PhotoCard inline → Tailwind | Done |
| AuthGate rgba → color-mix with CSS vars | Done |
| MessageList shadow rgba → oklch | Done |

## Definition of Done

- `make check` passes (lint + typecheck + test)
- No file exceeds 300 lines (production) or 300 lines (test)
- No new code smells from the audit anti-pattern list
- Reviewer approves using updated `reviewer.md` smell checks
- Every AC has a test annotation and corresponding test in the PR diff
