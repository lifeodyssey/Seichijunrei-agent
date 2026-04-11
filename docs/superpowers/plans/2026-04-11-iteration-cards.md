# Iteration 10: Combined Execution Plan

Specs:
- `docs/superpowers/specs/2026-04-11-bug03-route-planning-fix-design.md` (BUG-03 Wave 2-3)
- `docs/superpowers/specs/2026-04-11-refactor-remaining-design.md`
- `docs/superpowers/specs/2026-04-11-test-infra-remaining-design.md`
- `docs/superpowers/specs/2026-04-11-seo-geo-harness-design.md`
- `docs/superpowers/specs/2026-04-11-layered-eval-harness-design.md`

Date: 2026-04-11
Status: PENDING APPROVAL

## Iteration Config
- executor_model: gpt-5.2 --effort xhigh (via codex exec)
- reviewer_model: gpt-5.2 (via codex review) + claude (via coderabbit)
- tester_model: claude-opus-4-6 (via browse/qa)
- pinned_at: 2026-04-11T17:00:00Z

---

## Card Consolidation

SEO tasks S2-S6 all modify `frontend/app/layout.tsx`. Collapsed into a single card:

| Original tasks | Merged card |
|---|---|
| S2 (JSON-LD) + S3 (OG image) + S4 (hreflang) + S5 (title/desc) + S6 (FAQ) | S_ALL |

Eval tasks E2/E3/E4 all modify `Makefile`. Executed sequentially within wave.

---

## Cards

### Card B2: Inject session search data into executor context
- **Scope:** Seed executor_context with session's last search results at pipeline startup
- **Files changed:**
  - backend/agents/pipeline.py (modify)
- **AC:**
  - [ ] context has last_search_data with search_bangumi -> executor_context["search_bangumi"] pre-populated -> unit
  - [ ] context has last_search_data with search_nearby -> executor_context["search_nearby"] pre-populated -> unit
  - [ ] context is None or no last_search_data -> executor_context only has locale -> unit
  - [ ] last_search_data present but rows is empty -> executor_context still seeded -> unit
- **Dependencies:** Card B1 (MERGED)
- **Wave:** 1
- **Branch:** iter9/pipeline-context-inject
- **Review mode:** full

### Card B5: Handle clarify SSE event in frontend API layer
- **Scope:** sendMessageStream consumer handles step event with tool==="clarify" as completion with needs_clarification. NOTE: `response_builder.py:49-53` only extracts `results` and `route` from final_output — clarify `question`/`options` get dropped from the `done` event. Frontend must capture clarify data from the intermediate `step` event payload.
- **Files changed:**
  - frontend/lib/api.ts (modify)
- **AC:**
  - [ ] SSE step event with tool="clarify" + data={question, options} -> resolves as RuntimeResponse with status needs_clarification -> unit
  - [ ] clarify with empty options array -> still resolves -> unit
  - [ ] Malformed clarify JSON -> stream error thrown -> unit
- **Dependencies:** Card B4 (MERGED)
- **Wave:** 1
- **Branch:** iter9/frontend-clarify-handler
- **Review mode:** full

### Card B3: Update planner validator to accept session-satisfied dependencies
- **Scope:** Validator accepts plan_route when search_bangumi exists in executor_context (session)
- **Files changed:**
  - backend/agents/planner_agent.py (modify)
  - backend/agents/pipeline.py (modify — pass context to planner)
- **AC:**
  - [ ] Session context has search_bangumi + planner emits plan_route -> validator accepts -> unit
  - [ ] Single-turn flow still works (search + route in same request) -> integration
  - [ ] No session context and no history -> validator rejects with ModelRetry -> unit
  - [ ] Session context key exists but is None/empty -> validator rejects -> unit
- **Dependencies:** Card B2
- **Wave:** 2
- **Branch:** iter9/validator-session-deps
- **Review mode:** full

### Card B6: Render clarification bubble in MessageBubble
- **Scope:** Render needs_clarification as question with tappable option buttons
- **Files changed:**
  - frontend/components/chat/MessageBubble.tsx (modify)
  - frontend/hooks/useChat.ts (modify)
- **AC:**
  - [ ] status=needs_clarification + options=["Tokyo Station","Tokyo Tower"] -> renders question + 2 buttons -> browser
  - [ ] Tap option button -> sends selected text as new user message -> browser
  - [ ] options empty or missing -> renders question text only, no buttons -> browser
  - [ ] question missing -> falls back to generic message text -> browser
  - [ ] Japanese clarification text renders correctly -> browser
- **Dependencies:** Card B5
- **Wave:** 2
- **Branch:** iter9/clarify-bubble-ui
- **Review mode:** full

### Card R1: Split frontend/lib/api.ts into api/ module
- **Scope:** Create `frontend/lib/api/` directory with 6 files. Delete original `api.ts`. Update all imports.
- **Files changed:**
  - frontend/lib/api/index.ts (new)
  - frontend/lib/api/client.ts (new)
  - frontend/lib/api/runtime.ts (new)
  - frontend/lib/api/conversations.ts (new)
  - frontend/lib/api/routes.ts (new)
  - frontend/lib/api/feedback.ts (new)
  - frontend/lib/api.ts (delete)
  - All importers (update)
- **AC:**
  - [ ] `npm run build` succeeds; all public functions importable from `@/lib/api` -> unit
  - [ ] No import of old `lib/api.ts` single-file path remains -> unit
  - [ ] `getAuthHeaders()` returns empty object when no supabase session (behavior preserved) -> unit
  - [ ] `sendMessage()` still throws on non-ok HTTP response (behavior preserved) -> unit
  - [ ] `npx tsc --noEmit` passes -> unit
- **Dependencies:** Card B5 (MUST merge first — B5 modifies api.ts)
- **Wave:** 3
- **Branch:** iter10/split-api-ts
- **Review mode:** full

### Card R2: Split frontend/lib/types.ts into types/ module
- **Scope:** Create `frontend/lib/types/` directory with 4 files. Delete original. Update imports.
- **Files changed:**
  - frontend/lib/types/index.ts (new)
  - frontend/lib/types/api.ts (new)
  - frontend/lib/types/domain.ts (new)
  - frontend/lib/types/components.ts (new)
  - frontend/lib/types.ts (delete)
  - All importers (update)
- **AC:**
  - [ ] `npm run build` succeeds; all types importable from `@/lib/types` -> unit
  - [ ] Type guards work correctly in barrel export -> unit
  - [ ] `isSearchData(null)` returns false, `isRouteData(undefined)` returns false -> unit
  - [ ] `npx tsc --noEmit` passes -> unit
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/split-types-ts
- **Review mode:** full

### Card R3: Write test_fastapi_service.py
- **Scope:** Unit tests for FastAPI route handlers, app creation, exception handlers, CORS.
- **Files changed:**
  - backend/tests/unit/test_fastapi_service.py (new)
- **AC:**
  - [ ] GET /healthz returns 200 with {status, service} shape -> unit
  - [ ] POST /v1/runtime with valid request returns 200 -> unit
  - [ ] POST /v1/runtime with empty text returns 422 -> unit
  - [ ] GET /v1/conversations without X-User-Id returns 400 -> unit
  - [ ] Unhandled exception returns 500 with {error: {code: "internal_error"}} -> unit
  - [ ] CORS middleware allows configured origin -> unit
  - [ ] create_fastapi_app sets app.state correctly -> unit
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/test-fastapi-service
- **Review mode:** full

### Card R4: Write repository unit tests
- **Scope:** One test file per supabase repository (7 repos, mock pool).
- **Files changed:**
  - backend/tests/unit/repositories/__init__.py (new)
  - backend/tests/unit/repositories/test_bangumi_repo.py (new)
  - backend/tests/unit/repositories/test_points_repo.py (new)
  - backend/tests/unit/repositories/test_session_repo.py (new)
  - backend/tests/unit/repositories/test_feedback_repo.py (new)
  - backend/tests/unit/repositories/test_user_memory_repo.py (new)
  - backend/tests/unit/repositories/test_routes_repo.py (new)
  - backend/tests/unit/repositories/test_messages_repo.py (new)
- **AC:**
  - [ ] BangumiRepo.get_bangumi returns dict when row exists -> unit
  - [ ] BangumiRepo.get_bangumi returns None when pool.fetchrow returns None -> unit
  - [ ] BangumiRepo.get_bangumi raises on pool error -> unit
  - [ ] PointsRepo.get_points_by_bangumi returns list -> unit
  - [ ] SessionRepo.upsert_session calls pool.execute with correct params -> unit
  - [ ] FeedbackRepo.save_feedback returns feedback_id -> unit
  - [ ] MessagesRepo.insert_message calls pool.execute -> unit
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/test-repositories
- **Review mode:** full

### Card T1: Migrate test_api_contract.py to testcontainer DB
- **Scope:** Replace _mock_db() with tc_db fixture. RuntimeAPI mock stays.
- **Files changed:**
  - backend/tests/integration/test_api_contract.py (modify)
- **AC:**
  - [ ] All existing tests pass with testcontainer DB -> integration
  - [ ] _build_app() accepts tc_db fixture -> integration
  - [ ] Empty DB table assertions still pass -> integration
  - [ ] 400/422 error shape tests still pass -> integration
  - [ ] DB connection failure raises clear fixture error -> integration
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/tc-api-contract
- **Review mode:** full

### Card T2: Migrate test_sse_contract.py to testcontainer DB
- **Scope:** Replace _mock_db() with tc_db fixture. RuntimeAPI mock stays.
- **Files changed:**
  - backend/tests/integration/test_sse_contract.py (modify)
- **AC:**
  - [ ] SSE event ordering tests pass with testcontainer DB -> integration
  - [ ] Done event shape test passes -> integration
  - [ ] Empty data payloads render correctly -> integration
  - [ ] Error event test passes with real DB -> integration
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/tc-sse-contract
- **Review mode:** full

### Card T3: Vitest + MSW setup for frontend
- **Scope:** Install Vitest, RTL, MSW, jsdom. Create config, MSW setup, fixtures.
- **Files changed:**
  - frontend/package.json (modify)
  - frontend/vitest.config.ts (new)
  - frontend/tests/setup.ts (new)
  - frontend/tests/mocks/handlers.ts (new)
  - frontend/tests/mocks/server.ts (new)
  - frontend/tests/fixtures/responses.ts (new)
- **AC:**
  - [ ] `cd frontend && npm test` exits 0 -> unit
  - [ ] vitest.config.ts configures jsdom, path aliases, setup file -> unit
  - [ ] MSW handlers return valid JSON; unmocked requests error -> unit
  - [ ] Fixtures include error + empty response shapes -> unit
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/vitest-setup
- **Review mode:** full

### Card S_ALL: SEO + GEO foundation (sitemap, meta, JSON-LD, OG, hreflang, FAQ)
- **Scope:** All 6 SEO tasks in one card since they all touch layout.tsx.
- **Files changed:**
  - frontend/public/sitemap.xml (new)
  - frontend/public/robots.txt (new)
  - frontend/public/og-image.png (new)
  - frontend/app/layout.tsx (modify)
- **AC:**
  - [ ] sitemap.xml is well-formed with root URL entry -> unit
  - [ ] robots.txt has Allow: / and Sitemap directive -> unit
  - [ ] WebSite + Organization JSON-LD blocks valid in page source -> unit
  - [ ] OG meta includes image 1200x630, type, locale -> unit
  - [ ] Twitter card meta set to summary_large_image -> unit
  - [ ] hreflang tags for ja, zh, en, x-default present -> unit
  - [ ] Title 50-60 chars with Japanese + "Seichijunrei" -> unit
  - [ ] Description 120-160 chars with target keywords -> unit
  - [ ] FAQPage JSON-LD with 2+ Q&A pairs valid -> unit
  - [ ] Lighthouse SEO score 90+ -> browser
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/seo-geo-foundation
- **Review mode:** full

### Card E1: Shared eval infrastructure (eval_common.py)
- **Scope:** Extract dataset loader, baseline management, gate enforcement from test_plan_quality.py.
- **Files changed:**
  - backend/tests/eval/eval_common.py (new)
  - backend/tests/eval/test_plan_quality.py (modify)
- **AC:**
  - [ ] load_dataset() returns 163 typed EvalCase objects -> unit
  - [ ] read_baseline/write_baseline round-trip works -> unit
  - [ ] enforce_gate returns empty list when scores pass -> unit
  - [ ] enforce_gate returns failure strings on regression -> unit
  - [ ] load_dataset() raises on missing file -> unit
  - [ ] read_baseline returns {} when stale case_count -> unit
  - [ ] Refactored test_plan_quality.py still passes with make test-eval -> integration
- **Dependencies:** None
- **Wave:** 1
- **Branch:** iter10/eval-common
- **Review mode:** full

### Card T4: Frontend component tests (MessageBubble, PilgrimageGrid, AppShell)
- **Scope:** Write component tests using RTL.
- **Files changed:**
  - frontend/tests/components/MessageBubble.test.tsx (new)
  - frontend/tests/components/PilgrimageGrid.test.tsx (new)
  - frontend/tests/components/AppShell.test.tsx (new)
- **AC:**
  - [ ] MessageBubble renders user message -> unit
  - [ ] MessageBubble renders bot message with anchor card -> unit
  - [ ] PilgrimageGrid renders spot names -> unit
  - [ ] AppShell renders sidebar + chat + result panel -> unit
  - [ ] MessageBubble handles undefined response.data -> unit
  - [ ] PilgrimageGrid empty rows -> empty state -> unit
  - [ ] MessageBubble error state + retry button -> unit
- **Dependencies:** Card T3
- **Wave:** 2
- **Branch:** iter10/component-tests
- **Review mode:** full

### Card T5: Frontend hook tests (useChat, useSession)
- **Scope:** Test hooks using renderHook.
- **Files changed:**
  - frontend/tests/hooks/useChat.test.ts (new)
  - frontend/tests/hooks/useSession.test.ts (new)
- **AC:**
  - [ ] useSession initializes from localStorage -> unit
  - [ ] useSession.setSessionId writes to localStorage -> unit
  - [ ] useChat.send appends messages -> unit
  - [ ] useChat.clear resets -> unit
  - [ ] useSession returns null when no key -> unit
  - [ ] useChat.send with empty text is no-op -> unit
  - [ ] useChat.send while sending is no-op -> unit
- **Dependencies:** Card T3
- **Wave:** 2
- **Branch:** iter10/hook-tests
- **Review mode:** full

### Card E2: Layer 1a — Component eval (deterministic)
- **Scope:** test_component_quality.py + Makefile target.
- **Files changed:**
  - backend/tests/eval/test_component_quality.py (new)
  - Makefile (modify)
- **AC:**
  - [ ] IntentClassifierAccuracy scores 1.0 on matching cases -> unit
  - [ ] ValidatorBehavior positive scenario accepted -> unit
  - [ ] ValidatorBehavior negative scenario raises ModelRetry -> unit
  - [ ] 163 cases complete in < 10 seconds -> unit
  - [ ] First run creates baseline, second run enforces gate -> unit
  - [ ] make test-eval-components exits non-zero on regression -> unit
- **Dependencies:** Card E1
- **Wave:** 2
- **Branch:** iter10/eval-layer1a
- **Review mode:** full

### Card E3: Layer 1b — Planner eval (single LLM call)
- **Scope:** test_planner_quality.py + Makefile target.
- **Files changed:**
  - backend/tests/eval/test_planner_quality.py (new)
  - Makefile (modify)
- **AC:**
  - [ ] FirstStepMatch scores 1.0 when tool matches expected_steps[0] -> eval
  - [ ] ThoughtRelevance scores 1.0 for non-boilerplate thoughts -> eval
  - [ ] Model precheck skips suite on unreachable model -> eval
  - [ ] Per-case timeout prevents stuck calls -> eval
  - [ ] Baseline created on first run, enforced on second -> eval
- **Dependencies:** Card E1, Card E2 (Makefile conflict — sequential)
- **Wave:** 3
- **Branch:** iter10/eval-layer1b
- **Review mode:** full

### Card E4: Layer 2 — ReAct loop eval (multi-LLM)
- **Scope:** test_react_quality.py + Makefile target.
- **Files changed:**
  - backend/tests/eval/test_react_quality.py (new)
  - Makefile (modify)
- **AC:**
  - [ ] StepsMatch scores 1.0 when tools match expected_steps -> eval
  - [ ] Convergence scores 1.0 when done event yielded -> eval
  - [ ] Efficiency scores 1.0 when steps <= expected + 1 -> eval
  - [ ] Mock DB returns realistic data -> eval
  - [ ] max_steps timeout scores 0.0 on Convergence -> eval
- **Dependencies:** Card E1, Card E3 (Makefile conflict — sequential)
- **Wave:** 4
- **Branch:** iter10/eval-layer2
- **Review mode:** full

### Card T6: Playwright E2E setup + 4 journey tests
- **Scope:** Install Playwright, config, auth fixture, 4 specs.
- **Files changed:**
  - package.json (modify — root)
  - e2e/playwright.config.ts (new)
  - e2e/fixtures/auth.ts (new)
  - e2e/tests/search-flow.spec.ts (new)
  - e2e/tests/route-planning.spec.ts (new)
  - e2e/tests/conversation.spec.ts (new)
  - e2e/tests/auth-flow.spec.ts (new)
- **AC:**
  - [ ] Search flow: type anime, send, grid renders -> browser
  - [ ] Route planning: search then route, result appears -> browser
  - [ ] Conversation: send, new chat, click old, history restored -> browser
  - [ ] Auth: magic link login, session, sidebar shows history -> browser
  - [ ] Unknown anime: empty/clarify state, no crash -> browser
  - [ ] Backend unavailable: error message shown -> browser
- **Dependencies:** None (but practical: run after app is stable)
- **Wave:** 3
- **Branch:** iter10/playwright-e2e
- **Review mode:** full

### Card E5: Makefile integration + Layer 1a in stable CI
- **Scope:** Composite Make targets, test-eval-components in make test.
- **Files changed:**
  - Makefile (modify)
- **AC:**
  - [ ] make test-eval-components runs test_component_quality.py -> unit
  - [ ] make test-eval-fast runs Layer 1a then 1b -> eval
  - [ ] make test-eval-all runs all layers -> eval
  - [ ] make test includes test-eval-components -> unit
  - [ ] Existing make test-eval unchanged -> integration
- **Dependencies:** Cards E2, E3, E4
- **Wave:** 5
- **Branch:** iter10/eval-makefile
- **Review mode:** light

### Card R5+T7: CI pipeline — frontend-test + e2e-local + playwright jobs
- **Scope:** Merged R5 + T7 since both touch ci.yml.
- **Files changed:**
  - .github/workflows/ci.yml (modify)
- **AC:**
  - [ ] frontend-test job runs npm test, blocks PR on failure -> integration
  - [ ] e2e-local job starts servers, runs Playwright -> integration
  - [ ] e2e-local depends on backend-test + frontend-build -> integration
  - [ ] Existing CI jobs unchanged -> integration
  - [ ] playwright-e2e failure blocks deploy -> integration
- **Dependencies:** Cards T3, T6
- **Wave:** 5
- **Branch:** iter10/ci-test-gates
- **Review mode:** full

---

## Wave Graph

### File overlap analysis:
- B2: pipeline.py | B3: pipeline.py + planner_agent.py — CONFLICT on pipeline.py
- B5: api.ts | R1: api.ts — CONFLICT, B5 must merge first
- E2/E3/E4/E5: Makefile — sequential
- R5+T7: ci.yml — merged into one card

### Wave assignment:

```
Wave 1:  [B2: pipeline inject]  ||  [B5: clarify handler]  ||  [R2: types split]
         [R3: fastapi tests]    ||  [R4: repo tests]        ||  [T1: tc api contract]
         [T2: tc sse contract]  ||  [T3: vitest setup]      ||  [S_ALL: seo/geo]
         [E1: eval common]
         (10 parallel cards — no file overlap)
              ↓ merge sequentially ↓

Wave 2:  [B3: validator deps]   ||  [B6: clarify bubble]   ||  [T4: component tests]
         [T5: hook tests]       ||  [E2: eval layer 1a]
         (5 parallel cards)
              ↓ merge sequentially ↓

Wave 3:  [R1: api.ts split]    ||  [E3: eval layer 1b]    ||  [T6: playwright e2e]
         (3 parallel cards)
              ↓ merge sequentially ↓

Wave 4:  [E4: eval layer 2]
         (1 card — Makefile conflict with E3)
              ↓ merge ↓

Wave 5:  [E5: eval makefile]   ||  [R5+T7: ci gates]
         (2 parallel cards)
              ↓ merge sequentially ↓
         RETRO
```

### Execution diagram:

```
Wave 1 (10):  B2 || B5 || R2 || R3 || R4 || T1 || T2 || T3 || S_ALL || E1
                   ↓ merge 10 PRs sequentially ↓
Wave 2 (5):   B3 || B6 || T4 || T5 || E2
                   ↓ merge 5 PRs sequentially ↓
Wave 3 (3):   R1 || E3 || T6
                   ↓ merge 3 PRs sequentially ↓
Wave 4 (1):   E4
                   ↓ merge ↓
Wave 5 (2):   E5 || R5+T7
                   ↓ merge 2 PRs ↓
              RETRO
```

Total: 21 cards, 5 waves, max 10 parallel in Wave 1.
