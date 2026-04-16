# Unified Iteration Plan -- 2026-04-15

**Planner:** Planning Agent
**Date:** 2026-04-15
**Specs audited:** 8

---

## 1. Inventory Table

After reading all 8 specs and cross-referencing the codebase (git log, file existence checks, grep for key patterns), here is the ground truth.

| # | Spec | Status in Spec | Actual Remaining Cards | Key Files Touched | Cross-Spec Dependencies | Priority |
|---|------|---------------|----------------------|-------------------|------------------------|----------|
| 1 | bug03-route-planning-fix | IN PROGRESS (Wave 1 merged) | **2** (Task 3: validator update, Task 6: clarify bubble in MessageBubble) | `planner_agent.py`, `pipeline.py`, `MessageBubble.tsx`, `useChat.ts` | Task 6 touches MessageBubble -- conflicts with journey-redesign Card 5 | **P0** |
| 2 | ux-feature-improvement | 90% done, 2 scraps | **2** (Phase 0b: root cleanup, Phase 5c: ResultPanel auto-open) | Root dir (`coverage.xml`, `htmlcov/`), `AppShell.tsx` | AppShell.tsx conflicts with journey-redesign Card 1 | **P0** |
| 3 | test-infrastructure | 60% done per spec | **0 remaining** (see Supersedence below) | Was: integration tests, Playwright, Vitest, CI | All remaining tasks superseded by test-infra-remaining and landed PRs | **DONE** |
| 4 | layered-eval-harness | READY | **4** (Task 2: Layer 1a component eval, Task 3: Layer 1b planner eval, Task 4: Layer 2 ReAct eval, Task 5: Makefile integration) | `backend/tests/eval/` (3 new files), `Makefile` | Task 1 (eval_common) already landed (PR #101). No conflicts with other specs. | **P2** |
| 5 | refactor-remaining | READY | **2** (Task 1: api.ts split, Task 5: CI steps) | `frontend/lib/api.ts` -> `frontend/lib/api/`, `.github/workflows/ci.yml` | api.ts split conflicts with journey-redesign Cards 2 and 6 (both modify api.ts) | **P1** |
| 6 | seo-geo-harness | READY | **0 remaining** (see Supersedence below) | Was: `layout.tsx`, `public/sitemap.xml`, `robots.txt`, `og-image.png` | All 6 tasks landed in PR #100 | **DONE** |
| 7 | test-infra-remaining | READY | **4** (Tasks 4-5: component + hook tests, Task 6: Playwright E2E, Task 7: CI gates) | `frontend/tests/components/`, `frontend/tests/hooks/`, `e2e/`, `.github/workflows/ci.yml` | Task 7 (CI) overlaps with refactor-remaining Task 5 (CI) | **P2** |
| 8 | journey-redesign | READY | **13** (all Cards 1-13) | Major rewrites: `AppShell.tsx`, `AuthGate.tsx`, `ResultPanel.tsx`, `PilgrimageGrid.tsx`, `api.ts`, `Clarification.tsx`, `NearbyMap.tsx`, dictionaries, `fastapi_service.py`, `schemas.py`, `bangumi.py` | Touches nearly everything. Supersedes multiple older spec tasks. | **P1** |

### Cards Remaining by Spec (verified against codebase)

**bug03-route-planning-fix:** 2 cards
- Task 1 (session context delta): LANDED (PR #88/#92 -- `_seed_executor_context` in `pipeline.py`)
- Task 2 (inject session search data): LANDED (same PR)
- Task 3 (validator update): NOT LANDED (no session context check in `planner_agent.py` validator)
- Task 4 (forward clarify events): LANDED (clarify handling exists in `pipeline.py` lines 211, 258)
- Task 5 (frontend clarify SSE): LANDED (PR #93 -- `api.ts` handles clarify events)
- Task 6 (clarify bubble in MessageBubble): NOT LANDED (no `needs_clarification` rendering in MessageBubble)

**ux-feature-improvement:** 2 scraps
- Phase 0b scraps: `coverage.xml` and `htmlcov/` still in root. `findings.md`, `progress.md`, `task_plan.md` already gone.
- Phase 5c: `latestVisualResponseMessage` fallback already removed from `AppShell.tsx` (grep returns 0 matches). Only scrap is confirming auto-open behavior is truly fixed.

**test-infrastructure:** 0 remaining
- Task 2 (testcontainer migration): LANDED. API contract (PR #97), SSE contract (PR #98) both migrated. Note: `MagicMock` still appears in these files for RuntimeAPI mocking (expected -- contract tests mock handle, not DB).
- Task 5 (Playwright): Covered by test-infra-remaining Task 6.
- Task 6 (Vitest): LANDED (PR #99 -- vitest config, MSW setup, mocks).
- Task 7 (CI): Covered by test-infra-remaining Task 7.

**refactor-remaining:** 2 cards
- Task 1 (api.ts split): NOT DONE. `frontend/lib/api.ts` is still a 417-line monolith. No `frontend/lib/api/` directory.
- Task 2 (types.ts split): LANDED (PR #94 -- `frontend/lib/types/` module exists with 4 files).
- Task 3 (test_fastapi_service.py): LANDED (PR #95).
- Task 4 (repository unit tests): LANDED (PR #96 -- 7 test files in `backend/tests/unit/repositories/`).
- Task 5 (CI steps): NOT DONE (needs frontend-test and playwright-e2e jobs).

**seo-geo-harness:** 0 remaining
- All 6 tasks landed in PR #100. `sitemap.xml`, `robots.txt`, `og-image.png` exist. JSON-LD (WebSite, Organization, FAQ) in `layout.tsx`. Hreflang in commit message confirms full landing.

**layered-eval-harness:** 4 cards
- Task 1 (eval_common.py): LANDED (PR #101).
- Task 2 (Layer 1a component eval): NOT DONE (no `test_component_quality.py`).
- Task 3 (Layer 1b planner eval): NOT DONE (no `test_planner_quality.py`).
- Task 4 (Layer 2 ReAct eval): NOT DONE (no `test_react_quality.py`).
- Task 5 (Makefile integration): NOT DONE.

**test-infra-remaining:** 4 cards
- Task 1 (migrate test_api_contract.py): LANDED (PR #97).
- Task 2 (migrate test_sse_contract.py): LANDED (PR #98).
- Task 3 (Vitest + MSW setup): LANDED (PR #99).
- Task 4 (component tests): NOT DONE (no `frontend/tests/components/` directory).
- Task 5 (hook tests): NOT DONE (no `frontend/tests/hooks/` directory).
- Task 6 (Playwright E2E): NOT DONE (no `e2e/` directory).
- Task 7 (CI gates): NOT DONE.

---

## 2. Cross-Spec Dependency and Conflict Analysis

### File Conflict Matrix

| File / Area | Specs Touching It | Conflict Severity |
|-------------|-------------------|-------------------|
| `frontend/components/layout/AppShell.tsx` | ux-improvement (Phase 5c), journey-redesign (Card 1 rewrite) | **HIGH** -- Card 1 rewrites the entire file. Phase 5c is a 1-line change. |
| `frontend/components/chat/MessageBubble.tsx` | bug03 (Task 6 clarify bubble), journey-redesign (Card 5 source badges) | **MEDIUM** -- different sections of the file, but both add rendering logic. |
| `frontend/lib/api.ts` | refactor-remaining (Task 1 split into module), journey-redesign (Cards 2, 6 add functions) | **HIGH** -- refactor-remaining deletes the file; journey-redesign modifies it. |
| `frontend/components/generative/Clarification.tsx` | journey-redesign (Card 7 redesign) | Low -- only one spec touches it. |
| `frontend/components/generative/PilgrimageGrid.tsx` | journey-redesign (Card 5 badges) | Low -- only one spec touches it. |
| `frontend/components/auth/AuthGate.tsx` | journey-redesign (Cards 9, 10, 11) | Low internally -- but all three cards are sequential within the spec. |
| `frontend/lib/dictionaries/*.json` | journey-redesign (Cards 2, 9, 10, 11) | **MEDIUM** -- additive changes across waves but same files. Spec already handles sequencing. |
| `backend/agents/planner_agent.py` | bug03 (Task 3 validator) | Low -- only one spec. |
| `backend/agents/pipeline.py` | bug03 (Task 3 passes context to planner) | Low -- only one spec. |
| `backend/tests/eval/` | layered-eval-harness (Tasks 2-5 new files) | Low -- all new files, no conflicts. |
| `backend/infrastructure/supabase/repositories/bangumi.py` | journey-redesign (Cards 12, 13) | **MEDIUM** -- both add methods to same file. Spec says additive, same wave OK. |
| `backend/interfaces/fastapi_service.py` | journey-redesign (Cards 12, 13) | **MEDIUM** -- both add routes. Additive, same wave OK. |
| `.github/workflows/ci.yml` | refactor-remaining (Task 5), test-infra-remaining (Task 7) | **HIGH** -- both add jobs. Must be combined into one card. |
| `Makefile` | layered-eval-harness (Task 5) | Low -- only one spec. |

### Critical Conflicts

1. **api.ts split vs journey-redesign**: The refactor-remaining spec wants to split `api.ts` into `api/` module (6 files). Journey-redesign Cards 2 and 6 add new functions (`fetchPopularBangumi()`, `origin_lat`/`origin_lng` in request). **Resolution:** Do the api.ts split FIRST, then journey-redesign cards add to the already-split module. Otherwise, journey-redesign adds to the monolith and the split becomes harder.

2. **AppShell.tsx: ux-improvement Phase 5c vs journey-redesign Card 1**: Journey-redesign Card 1 does a full rewrite of AppShell.tsx. The Phase 5c auto-open fix is a 1-line change that will be obliterated by the rewrite. **Resolution:** DROP ux-improvement Phase 5c. Journey-redesign Card 1 subsumes it (new AppShell has no auto-open behavior).

3. **MessageBubble.tsx: bug03 Task 6 vs journey-redesign Card 5**: Bug03 Task 6 adds clarification bubble rendering. Journey-redesign Card 7 redesigns the Clarification component entirely (card layout with cover art). **Resolution:** DO bug03 Task 6 first (it adds rendering for `needs_clarification` status). Journey-redesign Card 7 then enhances the visual design in Clarification.tsx, which is a separate component from MessageBubble.

4. **CI pipeline: refactor-remaining Task 5 vs test-infra-remaining Task 7**: Both add jobs to `ci.yml`. **Resolution:** MERGE into a single card that adds all CI jobs at once.

---

## 3. Supersedence Check

### FULLY SUPERSEDED (drop entirely)

| Spec | Card | Reason | Action |
|------|------|--------|--------|
| **seo-geo-harness** | All 6 tasks | Fully landed in PR #100. Sitemap, robots.txt, og-image, JSON-LD, hreflang, enhanced title/meta all shipped. | **DROP SPEC** -- mark as LANDED |
| **test-infrastructure** | All remaining | Task 2 landed (PRs #97, #98). Tasks 5-7 covered by test-infra-remaining. Task 6 (Vitest) landed in PR #99. | **DROP SPEC** -- mark as LANDED |

### PARTIALLY SUPERSEDED (drop specific cards)

| Spec | Card | Superseded By | Action |
|------|------|---------------|--------|
| **ux-improvement** Phase 5c | ResultPanel auto-open fix (AppShell.tsx) | Journey-redesign Card 1 rewrites AppShell entirely. New layout has no auto-open. | **DROP** -- subsumed by Card 1 |
| **ux-improvement** Phase 0b | Root cleanup (coverage.xml, htmlcov/) | Nothing supersedes this; still needs doing. But `findings.md`, `progress.md`, `task_plan.md` are already gone. | **KEEP** (reduced to: delete coverage.xml + htmlcov/) |
| **refactor-remaining** Task 5 | CI steps (frontend-test, playwright-e2e) | Overlaps with test-infra-remaining Task 7. | **MERGE** -- combine into one CI card |
| **refactor-remaining** Task 1 | api.ts split | Journey-redesign Cards 2/6 add functions to api.ts. NOT superseded -- the split must happen, but sequencing matters. | **KEEP** -- do before journey-redesign |

### NOT SUPERSEDED

| Spec | Cards | Reason |
|------|-------|--------|
| **bug03** Tasks 3, 6 | Validator session-context awareness and clarify bubble are functionality that journey-redesign does not implement. Journey-redesign Card 7 redesigns Clarification.tsx visuals, but does not add `needs_clarification` rendering in MessageBubble. | **KEEP** |
| **layered-eval-harness** Tasks 2-5 | Entirely backend eval infrastructure. No overlap with any other spec. | **KEEP** |
| **test-infra-remaining** Tasks 4-7 | Frontend component tests, hook tests, Playwright E2E, CI gates. Journey-redesign does not include test authoring. | **KEEP** |
| **journey-redesign** All 13 cards | New spec, nothing supersedes it. | **KEEP** |

---

## 4. Execution Plan: Redesign-Driven TDD

### Philosophy

**Redesign is the driver.** When a redesign card touches a file that another spec also needs, absorb that work into the redesign card. No separate cleanup or refactoring waves. Every card follows TDD: write the test (or eval) first, then implement. Eval-driven for backend, browser-test-driven for frontend.

### Absorbed work (folded into redesign cards)

| Old Card | Absorbed Into | Why |
|----------|---------------|-----|
| ux-improvement Phase 5c (auto-open) | W1-1 (AppShell rewrite) | AppShell rewrite obliterates old auto-open code |
| ux-improvement Phase 0b (root cleanup) | W1-1 (AppShell rewrite) | Delete `coverage.xml`, `htmlcov/` in same PR as layout rewrite |
| refactor-remaining Task 1 (api.ts split) | W1-2 (ChatPanel + WelcomeScreen) | Split api.ts into module first, then add `fetchPopularBangumi()` to the new module structure |
| bug03 Task 6 (clarify bubble) | W2-3 (Clarification redesign) | Both touch chat message rendering. Redesign subsumes the bug fix |
| bug03 Task 3 (validator context) | W1-5 (backend APIs) | Planner validator fix is backend, bundle with backend API cards |
| refactor-remaining Task 5 + test-infra-remaining Task 7 (CI) | W4-4 (CI gates) | Combined into one CI card at the end |

### Remaining: 20 cards, 5 waves

---

### WAVE 1: Foundation (Layout + api.ts split + Backend APIs)
**TDD approach:** Write Vitest layout tests and backend API tests FIRST, then implement.

| Card | Scope (redesign + absorbed work) | Files | TDD gate | Effort |
|------|----------------------------------|-------|----------|--------|
| W1-1: AppShell + IconSidebar | Rewrite layout to 3-column hybrid. Delete `Sidebar.tsx`. Delete root `coverage.xml`/`htmlcov/`. Absorbs ux Phase 0b + 5c. | `frontend/components/layout/AppShell.tsx` (rewrite), `frontend/components/layout/IconSidebar.tsx` (new), delete `frontend/components/layout/Sidebar.tsx`, `.gitignore`, delete root `coverage.xml`/`htmlcov/` | Vitest: renders 3 cols on desktop, 1 col on mobile | Heavy |
| W1-2: ChatPanel + WelcomeScreen + api.ts split | **Two commits:** (1) Split `frontend/lib/api.ts` (417L) into `frontend/lib/api/` module (6 files: `index.ts`, `client.ts`, `runtime.ts`, `conversations.ts`, `routes.ts`, `feedback.ts`). Delete `api.ts`. Update all imports. (2) Create `frontend/components/chat/ChatPanel.tsx` + `frontend/components/chat/WelcomeScreen.tsx`. Add `fetchPopularBangumi()` to `frontend/lib/api/client.ts`. Add welcome i18n keys to dictionaries. | `frontend/lib/api/` (6 new), delete `frontend/lib/api.ts`, `frontend/components/chat/ChatPanel.tsx` (new), `frontend/components/chat/WelcomeScreen.tsx` (new), `frontend/lib/dictionaries/{ja,zh,en}.json` | Vitest: api barrel exports resolve, welcome screen renders, quick-action tap sends query | Heavy |
| W1-3: ResultPanel grid/map toggle | Rewrite ResultPanel. Grid/map toggle with shared selection. Leaflet lazy-loaded. | `frontend/components/layout/ResultPanel.tsx` (rewrite), `frontend/components/generative/SelectionBar.tsx` (modify) | Vitest: toggle preserves selection, Leaflet dynamically imported | Heavy |
| W1-4: Mobile sheet + drawer | ResultSheet (vaul), ConversationDrawer. Delete old ResultDrawer. | `frontend/components/layout/ResultSheet.tsx` (new), `frontend/components/layout/ConversationDrawer.tsx` (new), delete `frontend/components/layout/ResultDrawer.tsx` | Vitest: sheet opens on anchor tap, drawer opens on hamburger | Medium |
| W1-5a: Backend API endpoints | `GET /v1/bangumi/popular`, `GET /v1/bangumi/nearby`, `origin_lat/lng` schema on `PublicAPIRequest`, `plan_route` coordinate handling. | `backend/interfaces/schemas.py`, `backend/infrastructure/supabase/repositories/bangumi.py`, `backend/interfaces/fastapi_service.py`, `backend/interfaces/public_api.py`, `backend/agents/handlers/plan_route.py`, `backend/tests/unit/repositories/test_bangumi_repo.py`, `backend/tests/unit/test_public_api.py` | pytest: endpoints return correct shapes, origin coords skip geocode, auth required | Medium |
| W1-5b: Bug03 planner validator fix | Planner validator accepts session-satisfied dependencies (e.g., search_bangumi already in session context from prior interaction). | `backend/agents/planner_agent.py`, `backend/agents/pipeline.py`, `backend/tests/unit/test_planner_agent.py` | pytest: validator accepts plan_route when search_bangumi in session history | Light |

**All 6 cards parallel.** No file overlaps (verified). Backend and frontend are independent.
**Gate:** `make check` + `npm run build` + all new tests pass.

---

### WAVE 2: Interactions (Data handling + Clarification + Nearby)
**TDD approach:** Write component tests for badges/prompts/chips FIRST, then implement the visual layer.

| Card | Scope (redesign + absorbed work) | Files | TDD gate | Effort |
|------|----------------------------------|-------|----------|--------|
| W2-1: Source badges + missing data | SourceBadge (🎬/📷). PilgrimageGrid: handle missing ep, city, screenshot_url. | `SourceBadge.tsx` (new), `PilgrimageGrid.tsx` | Vitest: URL pattern detection, ep=0 hides badge, null city shows "---" | Light |
| W2-2: LocationPrompt + geolocation | LocationPrompt inline chat. ChatInput 📍 button. Wire `origin_lat/lng` in request. | `LocationPrompt.tsx` (new), `ChatInput.tsx`, `api/runtime.ts` | Vitest: geo denied shows fallback, coords sent in payload | Medium |
| W2-3: Clarification + clarify bubble | Redesign Clarification to cards with cover art. ALSO add `needs_clarification` rendering in MessageBubble. Absorbs bug03 T6. | `Clarification.tsx`, `MessageBubble.tsx`, `registry.ts` | Vitest: ambiguous query shows cards, clarify status renders bubble | Medium |
| W2-4: Nearby anime chips | Colored chips per anime. Tap to filter. | `NearbyChips.tsx` (new), `NearbyMap.tsx`, `registry.ts` | Vitest: 3 anime = 3 chips, tap filters, 1 anime = no chips | Light |

**All 4 cards parallel.** W2-3 and W2-4 both touch `registry.ts` but changes are additive (different components).
**Gate:** `make check` + `npm run build` + browser QA.

---

### WAVE 3: Landing + Auth (sequential, all touch AuthGate + dictionaries)
**TDD approach:** Write browser test assertions FIRST (no "Join beta", no "Internal beta", locale auto-detect), then implement.

| Card | Scope | Files | TDD gate | Effort |
|------|-------|-------|----------|--------|
| W3-1: Landing page rewrite | Hero with Anitabi photos, search input, stats, 3-step section, anime gallery. Remove "Join beta", language switcher. | `AuthGate.tsx`, dictionaries | Browser: no "Join beta" text, hero visible, search submits | Heavy |
| W3-2: Login modal cleanup | Clean copy, no all-caps, no "Internal beta". | `AuthGate.tsx`, dictionaries | Browser: no "Internal beta", button is sentence-case | Light |
| W3-3: i18n auto-detect + dictionary cleanup | Remove language switcher code. Remove dead keys. Verify auto-detect. | `AuthGate.tsx`, dictionaries | Vitest: navigator.language=ja→ja, zh-CN→zh, fr→ja (fallback) | Light |

**Sequential: W3-1 → W3-2 → W3-3** (all share `AuthGate.tsx` + dictionaries).
**Gate:** `npm run build` + browser QA all 3 locales.

---

### WAVE 4: Eval + Tests + CI (infrastructure, parallel with Wave 3)
**Eval-driven approach:** Write eval cases that define correct behavior, then verify the pipeline passes them.

| Card | Scope | Files | TDD gate | Effort |
|------|-------|-------|----------|--------|
| W4-1: Layer 1a component eval | Deterministic eval: intent classifier + validator. 163 cases, 0 LLM calls. | `test_component_quality.py` (new) | `make test-eval-components` passes in <10s | Medium |
| W4-2: Layer 1b planner eval | Single LLM call per case. First-step tool selection accuracy. | `test_planner_quality.py` (new) | `make test-eval-planner` passes | Medium |
| W4-3: Layer 2 ReAct eval + Makefile | Multi-LLM react_loop eval. Add all eval Makefile targets. | `test_react_quality.py` (new), `Makefile` | `make test-eval-all` passes | Heavy |
| W4-4: Frontend tests + Playwright + CI | Component tests (against NEW components), hook tests, Playwright E2E for 6 journeys, CI pipeline gates. | `frontend/tests/`, `e2e/`, `.github/workflows/ci.yml` | `npm test` + `npx playwright test` + CI green | Heavy |

**W4-1, W4-2, W4-3 parallel** (all new files, no overlap). **W4-4 after Wave 3** (tests target final component shapes).
**Gate:** All evals pass. CI pipeline green.

---

## 5. Recommended Approach

### Execution diagram

```
Wave 1: Foundation              [5 cards, all parallel]
  Layout + api split + backend APIs + bug fix
  |
  ├── Wave 2: Interactions      [4 cards, all parallel]
  |     Badges + geo + clarify + nearby
  |
  ├── Wave 3: Landing + Auth    [3 cards, sequential]
  |     Landing → Login → i18n
  |
  └── Wave 4: Eval + Tests + CI [4 cards, parallel]
        Eval layers + Playwright + CI gates
```

**Wave 4 runs in parallel with Waves 2-3** (backend eval has zero frontend overlap).
**Wave 4 card W4-4 (frontend tests + Playwright) starts after Wave 3** (needs final components).

### TDD cadence per card

```
1. Write test/eval that defines expected behavior (RED)
2. Implement the feature (GREEN)
3. Refactor: absorb any related spec work into the same PR (REFACTOR)
4. make check + npm run build
5. Push + PR
```

### Total: 17 cards (was 25, absorbed 9, split W1-5 into a/b)

| Wave | Cards | Parallel? | Duration |
|------|-------|-----------|----------|
| Wave 1 | 6 | All parallel | ~6h |
| Wave 2 | 4 | All parallel | ~4h |
| Wave 3 | 3 | Sequential | ~4h |
| Wave 4 | 4 | 3 parallel + 1 after W3 | ~4h |

### Dropped / Absorbed Cards

| Original Card | Action |
|---------------|--------|
| ux Phase 0b (root cleanup) | Absorbed into W1-1 |
| ux Phase 5c (auto-open) | Absorbed into W1-1 |
| refactor api.ts split | Absorbed into W1-2 |
| bug03 Task 3 (validator) | Absorbed into W1-5 |
| bug03 Task 6 (clarify bubble) | Absorbed into W2-3 |
| refactor CI + test-infra CI | Merged into W4-4 |
| seo-geo-harness (all) | Already LANDED (PR #100) |
| test-infrastructure (all) | Already LANDED (PRs #97-99) |
| refactor Tasks 2-4 | Already LANDED (PRs #94-96) |
