# 2026-04-09 Architecture Review Synthesis

**Date:** 2026-04-09
**Scope:** Consolidated synthesis of completed 2026-04-09 review reports under `docs/superpowers/reviews/`
**Sources included:**
- `docs/superpowers/reviews/2026-04-09-eng-review-solid-refactor.md`
- `docs/superpowers/reviews/2026-04-09-distill-simplification.md`
- `docs/superpowers/reviews/2026-04-09-design-patterns-review.md`
- `docs/superpowers/reviews/2026-04-09-plan-eng-review-backend.md`
- `docs/superpowers/reviews/2026-04-09-plan-eng-review-frontend.md`

---

## Executive summary

The reports agree on the big picture: the system already has a strong architectural direction, especially on the backend, but both stacks are accumulating complexity in orchestration-heavy modules faster than they are strengthening contracts and safety nets around them.

The backend is structurally sound. Multiple reports independently praise the existing layering, ports/adapters usage, repository decomposition, deterministic executor design, and security posture. The recurring backend problem is not that the architecture is wrong, but that a few central modules are still carrying too many responsibilities, while `db: object` plus repeated `getattr(...)` lookups hide the actual contracts.

The frontend has the opposite profile. The product-facing architecture has good ideas, including a clean generative UI registry, centralized API layer, SSE streaming, and a responsive drawer/slide-over strategy, but the current implementation confidence is low because the highest-churn UI modules are too large, the test surface is extremely thin, and i18n/a11y work is incomplete.

The most important cross-report conclusion is this: the next wave of work should prioritize **confidence-building and boundary tightening**, not feature expansion. The codebase is engineered enough to scale, but only if it now pays down the concentration of logic in a handful of files and closes the biggest test and contract gaps.

### Preserved metrics and scores

| Area | Source metric | Takeaway |
|---|---|---|
| Backend overall | Architecture **A-**, Code Quality **B+**, Test Coverage **B+**, Performance **B**, Security **A-** | Strong base, focused debt |
| Frontend overall | Overall **C+** | Good direction, low execution confidence |
| Frontend quality sub-scores | Architecture **B**, Code Quality **B-**, Test Coverage **F**, Performance **C+**, Accessibility **D+**, i18n **C** | Test and UX hardening are the urgent gaps |
| Backend size | ~80 backend source files, ~10.2K LOC, ~40 test files, ~9.4K LOC | Backend is broadly covered and already invested in testing |
| Frontend size | 48 source files, ~5.2K LOC | Smaller surface, but much weaker quality gates |
| Frontend test reality | 3 test files, 13 tests, ~3/48 files covered (~6%) | Frontend quality risk is disproportional to code size |
| Thick backend files | `fastapi_service.py` 643L, `retriever.py` 551L, `public_api.py` 542L | Same modules show up in every backend review |
| Simplification estimate | Top 3 backend files: 1,736L total, estimated ~85 lines removable without behavior change | Simplification helps, but structure matters more than raw LOC |
| Backend contract smell | ~20 dynamic DB lookup call sites across the main backend files | Hidden contracts are a recurring root cause |
| Frontend architecture smell | `AppShell.tsx` 467L with 11 `useState`, 5 `useEffect`, 8 `useCallback`; `AuthGate.tsx` 466L | Same orchestration concentration pattern as backend |

---

## Cross-report consensus findings

### 1. Oversized orchestration modules are the main recurring root cause

This is the clearest consensus across all reports.

On the backend, the same three files are repeatedly identified as structural hotspots:
- `backend/interfaces/fastapi_service.py`
- `backend/interfaces/public_api.py`
- `backend/agents/retriever.py`

On the frontend, the same pattern appears in:
- `frontend/components/layout/AppShell.tsx`
- `frontend/components/auth/AuthGate.tsx`
- `frontend/components/chat/MessageBubble.tsx`
- `frontend/components/generative/RoutePlannerWizard.tsx`

The shared failure mode is not simply “large files”. It is **too much orchestration, state, policy, and side-effect handling concentrated in the outermost modules**. That slows onboarding, increases merge conflicts, raises regression risk, and makes performance/debugging work harder.

### 2. Contracts at trust boundaries are too implicit

This shows up differently in each stack, but the pattern is the same.

Backend:
- `db: object` plus repeated `getattr(...)` / duck-typing
- direct imports of concrete infrastructure from the agents layer
- raw SQL escaping into `retriever.py`
- private attribute reach-ins like `getattr(runtime_api, "_db", None)`

Frontend:
- multiple `as unknown as` casts at runtime boundaries
- hydration-time casts without validation
- module-level mutable ID state in `useChat`
- mixed sources of truth for locale and UI state

The shared problem is that correctness relies too heavily on convention and caller discipline instead of explicit interfaces or runtime validation.

### 3. Testing quality is uneven, and the weakest area is the one closest to users

The backend review finds real but bounded gaps: repositories, some use cases, geocoding, and deeper SQLAgent coverage.

The frontend review finds a systemic gap: almost the entire interactive surface is effectively untested. This is the most urgent quality imbalance in the whole codebase.

The synthesis view is simple:
- backend needs **targeted gap filling**
- frontend needs **baseline testing infrastructure plus core flow coverage**

### 4. Non-functional requirements are being handled late instead of by default

Multiple reports independently surface issues that are not feature logic bugs, but still user-visible quality problems:
- accessibility gaps
- incomplete i18n
- silent background failures
- lack of error boundaries
- render cascades and avoidable UI jank
- cache/session behavior that can fail quietly

These are not edge polish items anymore. They are now part of core product correctness.

### 5. The architecture is better than the current confidence level suggests

This matters because the reports are not saying “rewrite it”. They are saying:
- keep the backend architecture direction
- stop letting a few files accumulate all the policy
- formalize contracts already implicit in the code
- strengthen the frontend safety net until it matches product criticality

That is a refactor-and-harden roadmap, not a rebuild.

---

## Backend findings

### What is working well

- Layering is broadly correct: interfaces → agents → application → infrastructure → domain.
- Ports/adapters are already in use for Bangumi and Anitabi gateways.
- Repository decomposition inside `backend/infrastructure/supabase/` is a real strength.
- The executor remains deterministic, which multiple reviews explicitly validate as the right design.
- Security posture is strong: auth is enforced at the Worker boundary, SQL is parameterized, and SSRF/CORS protections are present.
- Backend test investment is already meaningful and much stronger than the frontend.

### Recurring backend-only problems

#### 1. `db: object` is the single highest-leverage backend debt item

This is the most repeated backend finding across the SOLID review, design-patterns review, and backend architecture review.

Why it matters:
- hides required contracts
- defeats static checking
- forces runtime duck-typing
- makes infrastructure boundaries blurry
- encourages service-locator style access

Consensus recommendation:
- introduce narrow DB Protocols or Ports per consumer, not one giant catch-all type
- type `RuntimeAPI`, `Retriever`, and `ExecutorAgent` against those ports
- remove repeated `getattr(..., None)` guards from hot paths

#### 2. `retriever.py` is doing two jobs, and maybe three

Independent reports agree that `Retriever` currently mixes:
- strategy selection
- SQL/geo/hybrid execution
- write-through backfill behavior
- metadata enrichment
- persistence details
- even raw SQL in one path

Consensus recommendation:
- keep `Retriever` as orchestrator / strategy dispatch
- extract write-through and enrichment into an application-layer service or use case
- move raw SQL back into repositories
- stop constructing concrete gateways or HTTP clients inside the retriever path

#### 3. `fastapi_service.py` and `public_api.py` are structurally overdue for decomposition

The reports differ on exact targets, but agree on the direction.

`fastapi_service.py` currently mixes too many concerns:
- app factory / lifespan
- routes
- request models
- auth extraction
- exception handlers
- observability middleware
- helper functions

`RuntimeAPI.handle()` inside `public_api.py` currently mixes too many phases:
- session load
- pipeline execution
- response assembly
- persistence side effects
- route persistence
- request logging / telemetry

Consensus recommendation:
- split route concerns by domain and move cross-cutting helpers out of the router file
- extract persistence orchestration out of `RuntimeAPI.handle()`
- keep top-level orchestration visible, but flatten and isolate side-effect-heavy phases

#### 4. Backend risk is now mostly operational and architectural, not algorithmic

The backend reports do not show a broken core architecture. They show a mature system starting to hit “scale of maintenance” issues:
- in-memory session fallback can silently become production behavior if misconfigured
- module-level retrieval cache creates test/loop coupling
- `threading.Lock` in async cache code is an awkward fit
- location resolution can stack sequential fallback latency
- external HTTP client lifecycle is still costlier than needed

This is a good sign overall. The system is past “is this architecture viable?” and into “tighten the mechanics before it grows again.”

### Backend quick wins

- Add startup warning or hard signal when session storage falls back to in-memory.
- Add error counters/metrics around currently swallowed persistence/logging exceptions.
- Move the `UPDATE bangumi SET points_count` SQL into the repository layer.
- Delete dead helper code and low-value duplication found in the simplification review.
- Expand tests for repositories, geocoding, use cases, and SQLAgent branches.

### Backend structural refactors

- Introduce typed DB ports and remove dynamic lookup patterns.
- Decompose `Retriever` into orchestrator + strategy + write-through service.
- Split `fastapi_service.py` into app factory, routers, middleware, and dependencies.
- Extract persistence orchestration from `RuntimeAPI.handle()`.

---

## Frontend findings

### What is working well

- The registry pattern for generative UI components is clean and extensible.
- SSE streaming and centralized API access are good architectural choices.
- The responsive result-display model is thoughtful and product-aware.
- Domain typing generally mirrors backend contracts well.
- The codebase has a clear product/UI direction rather than fragmented experiments.

### Recurring frontend-only problems

#### 1. The frontend’s core interaction layer is concentrated in a few oversized files

This is the frontend equivalent of the backend orchestration problem.

Most repeated hotspots:
- `AppShell.tsx` as the state/orchestration hub
- `AuthGate.tsx` mixing landing page, modal, and behavior concerns
- `MessageBubble.tsx` carrying multiple inline sub-components and rules
- `RoutePlannerWizard.tsx` carrying duplicated UI and too much rendering logic

Consensus recommendation:
- separate page/layout orchestration from reusable interaction pieces
- move inline sub-components into explicit files
- isolate overlay/result routing and route-planning timeline rendering

#### 2. Frontend testing is the single biggest product-quality gap in the review set

This is not a small gap. It is foundational.

The frontend report’s numbers are severe:
- 3 test files total
- 13 tests total
- ~3/48 source files covered
- 27 component files untested
- 5 hooks untested
- no E2E coverage
- no accessibility coverage
- no visual regression coverage

Consensus recommendation:
- first add a component/hook test stack
- then cover the highest-value user flows with E2E tests
- do not wait for large refactors before building the safety net

#### 3. i18n and accessibility are product correctness issues now, not later polish

The frontend report surfaces a broad group of user-visible issues:
- hardcoded Japanese/Chinese/English strings bypassing dictionaries
- flash of Japanese before locale dictionary load for non-ja users
- no skip link
- no `aria-live`/`role="log"` for chat updates
- non-focusable clickable elements in sidebar
- auth modal without focus trap

These are important because they are visible to real users immediately and compound with every new UI surface.

#### 4. Current performance issues mostly come from render topology, not expensive algorithms

The main frontend performance issues are architectural:
- `AppShell` state changes fan out across too much of the tree
- message streaming causes too many re-renders
- map lifecycle is fragile around parent re-renders
- font loading and image sizing cause avoidable rendering/layout costs

Consensus recommendation:
- reduce render fan-out by splitting state responsibilities first
- then memoize stable leaf components
- then clean up asset loading and map lifecycle edges

### Frontend quick wins

- Move all hardcoded strings into locale dictionaries.
- Add skip link, `aria-live`, keyboard-focusable sidebar items, and modal focus trapping.
- Replace hardcoded palette violations (`bg-gray-200`) with design tokens.
- Add width/height attributes to images to reduce CLS.
- Replace module-level ID counter with stable ID generation.
- Remove unused variables and easy duplication in route-planning UI.

### Frontend structural refactors

- Add React component/hook testing infrastructure.
- Add E2E smoke coverage for login, messaging, and route-building.
- Decompose `AppShell` into state, conversation, and overlay/result concerns.
- Decompose `AuthGate` into landing/auth/behavior sub-components.
- Extract shared `TimelineStopList` and MessageBubble sub-components.

---

## Cross-stack findings

### 1. Both stacks rely too much on “this should be fine” boundaries

Backend version:
- duck-typed DB calls
- private attribute reach-ins
- concrete imports across architectural layers

Frontend version:
- trust-me casts
- hydration assumptions without validation
- large shared state hubs

This is the same engineering smell expressed in two ecosystems: hidden contracts.

### 2. Both stacks are strongest in core intent, weaker in operational follow-through

Backend intent is good:
- clear layering
- deterministic executor
- repository extraction

Frontend intent is good:
- registry-driven generative UI
- centralized API layer
- clear chat/result split

But in both stacks, follow-through on correctness mechanisms lags behind:
- explicit contracts
- failure isolation
- robust test coverage
- accessibility/i18n/perf defaults
- clearer observability on best-effort paths

### 3. Both stacks have “outer layer bloat” rather than “core domain confusion”

This is actually good news.

The reviews do **not** say the domain model is incoherent. They say the code closest to transport, orchestration, UI composition, and side effects is carrying too much weight. That means the right move is careful extraction and contract hardening, not architectural reset.

### 4. The fastest path to better velocity is confidence, not novelty

The next increment of engineering leverage does not come from adding more patterns. It comes from making the current patterns explicit and testable.

That means:
- fewer hidden interfaces
- fewer giant orchestrators
- more coverage of user-visible flows
- fewer silent failure modes

---

## Ranked refactor roadmap

| Rank | Initiative | Type | Scope | Impact | Effort | Why this rank |
|---|---|---|---|---|---|---|
| 1 | Build the missing frontend safety net: component/hook tests plus 3 core E2E flows | Structural | Frontend | Very high | Medium | Biggest confidence gap on the most user-visible surface |
| 2 | Replace backend `db: object` usage with narrow typed ports / protocols | Structural | Backend | Very high | Medium | Highest backend leverage, removes a root cause repeated across multiple reports |
| 3 | Decompose `Retriever` and remove write-through/raw-SQL/infrastructure leakage from the agents layer | Structural | Backend | High | Medium-high | Concentrated architectural debt in a growth-critical module |
| 4 | Split `AppShell` and `AuthGate` into smaller orchestration units | Structural | Frontend | High | Medium-high | Reduces regression risk, render fan-out, and change friction in top UI entry points |
| 5 | Fix user-visible frontend correctness gaps: i18n hardcodes, locale flash, skip link, aria-live, focus/keyboard gaps | Quick win | Frontend | High | Small-medium | Immediate user benefit, low dependency on larger refactors |
| 6 | Flatten backend transport/orchestration files: split `fastapi_service.py`, extract persistence orchestration from `RuntimeAPI.handle()` | Structural | Backend | High | Medium | Improves maintainability without changing core product behavior |
| 7 | Add backend operational guardrails: warn on in-memory session fallback, instrument swallowed exceptions, inject cache instead of singleton | Quick win | Backend | Medium-high | Small | Cheap protection against painful production ambiguity |
| 8 | Optimize frontend render paths: memoize message surfaces, stabilize map/image/font behavior | Quick win | Frontend | Medium | Small-medium | Best done after or alongside component decomposition |
| 9 | Fill backend targeted test gaps: repositories, geocoding, use cases, SQLAgent branches | Quick win | Backend | Medium | Small-medium | Completes an otherwise healthy backend test posture |
| 10 | Clean low-risk simplification debt: dead code, duplicated helper patterns, easy LOC reductions | Quick win | Backend | Medium-low | Small | Worth doing, but should not distract from structural wins |

### Quick wins summary

These are high-value items that can land quickly without waiting for deeper restructuring:
- frontend i18n string cleanup and locale-load correctness
- frontend accessibility baseline fixes
- backend session-fallback warning and error counters on swallowed exceptions
- backend repository/geocoding/use-case test additions
- frontend image/font/token cleanup
- dead code and helper cleanup from the simplification review

### Structural refactors summary

These are the changes most likely to improve long-term velocity and defect rate:
- frontend test infrastructure + E2E baseline
- backend DB port/protocol typing
- backend retriever decomposition
- backend service/router/persistence extraction
- frontend AppShell/AuthGate decomposition

---

## Suggested implementation order

### Phase 1: Lock in safety nets first

1. Add frontend component/hook test tooling.
2. Add 3 frontend E2E smoke flows.
3. Fill backend repository/geocoding/use-case test gaps.

Rationale: this creates room to refactor aggressively without guessing.

### Phase 2: Fix the most visible correctness issues

1. Move hardcoded frontend strings to dictionaries.
2. Fix locale flash and basic accessibility gaps.
3. Add backend startup/monitoring guards for session fallback and silent persistence failures.

Rationale: these are low-to-medium effort, immediately user-visible, and reduce production ambiguity.

### Phase 3: Tighten backend contracts

1. Introduce narrow DB protocols/ports.
2. Remove dynamic DB lookup patterns and private attribute reach-ins.
3. Move raw SQL and concrete infrastructure dependencies back behind proper boundaries.

Rationale: this is the cleanest backend root-cause fix and unlocks safer refactoring of the hot modules.

### Phase 4: Split the highest-churn orchestrators

1. Backend: `Retriever`, `fastapi_service.py`, `RuntimeAPI.handle()`.
2. Frontend: `AppShell`, `AuthGate`, then `MessageBubble` and `RoutePlannerWizard`.

Rationale: once tests and contracts exist, these extractions become routine instead of risky.

### Phase 5: Tune performance after structure stabilizes

1. Frontend memoization/render topology.
2. Map lifecycle and asset-loading cleanup.
3. Backend cache lock/session/client lifecycle improvements.
4. Route optimizer scaling guard/documentation.

Rationale: performance work sticks better once the shape of the code is stable.

---

## Risks if deferred

### 1. Feature velocity slows for the wrong reason

If the thick orchestrator files stay as-is, future work will keep piling into the same modules. That means more merge conflicts, more regression fear, and more “touch one thing, retest everything” behavior.

### 2. Frontend regressions will keep escaping

With ~94% of frontend source files untested and no E2E baseline, the UI remains the highest-probability source of user-facing regressions even though its codebase is much smaller than the backend.

### 3. Hidden contracts will keep failing at runtime instead of compile/test time

Backend `getattr(...)` patterns and frontend trust-me casts both turn structural mistakes into runtime surprises. As the system grows, that becomes more expensive to debug.

### 4. User-visible quality debt will compound

Accessibility and i18n debt get more expensive the longer they are allowed to spread. Every new component added before the baseline is fixed increases cleanup cost later.

### 5. Operational ambiguity stays high

If best-effort persistence failures, session-store fallbacks, module-level caches, and missing error boundaries remain under-instrumented, production failures will continue to look like “weird inconsistent behavior” instead of diagnosable faults.

---

## Bottom line

The backend is closer to “tighten and scale” than “rethink architecture”. The frontend is closer to “stabilize and harden” than “add features freely”.

The shared priority is to stop letting convenience substitute for contracts and tests.

If only a few things happen next, they should be:
1. frontend testing baseline
2. backend DB port typing
3. retriever and UI orchestrator decomposition
4. user-visible i18n/a11y correctness fixes
