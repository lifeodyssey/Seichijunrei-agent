# Iteration Plan: Post-Review Sprint Roadmap

**Created:** 2026-04-08
**Source specs:** 6 design specs covering 50+ tasks
**Status:** Ready for execution

## Overview

After 18 PRs merged, an architecture review, user journey review, and production QA, we have 35 findings in issue #60 and 6 specs. This plan sequences everything into 6 iterations with clear dependencies and parallelism.

### Critical Path

```
Iter 6 (bugfix must-fix)
    ↓ unblocks real users
Iter 7 (bugfix should-fix + test infra foundation)
    ↓ testcontainers + eval expansion ready
Iter 8 (agent architecture v2 + eval-driven dev)
    ↓ result_validator, retry, streaming thoughts
Iter 9 (frontend redesign + SEO/GEO)
    ↓ independent track, polish + discoverability
Iter 10 (bugfix nice-to-have + cleanup)
    ↓ final polish
Iter 11 (E2E + production validation)
```

### Spec-to-Iteration Mapping

| Spec | Tasks | Iterations |
|------|-------|------------|
| Production bugfix (20 tasks) | T01-T19 | 6, 7, 10 |
| Test infrastructure | 7 tasks | 7, 8 |
| Agent architecture v2 | 4 phases | 8 |
| Frontend redesign | 6 tasks | 9 |
| SEO/GEO | 6 tasks | 9 |
| QA bugfix iteration (original) | superseded | — |

---

## Iter 6: Must-Fix Bugfix Sprint

**Goal:** Unblock new users, fix pipeline crashes, fix blank states.
**Duration estimate (CC):** ~45 min
**Parallelism:** 4 worktree agents (different files)

### Tasks

| ID | Task | Files | Agent? |
|----|------|-------|--------|
| T01 | Waitlist auto-approval | `AuthGate.tsx` | agent-1 |
| T02 | ReAct retry mechanism (continue not return) | `pipeline.py`, `planner_agent.py` | agent-2 |
| T04 | Blank loading state (ThinkingProcess) | `ThinkingProcess.tsx`, `MessageBubble.tsx` | agent-3 |
| T05 | Session hydration JSON.parse + error handling | `api.ts`, `AppShell.tsx` | agent-4 |

### Dependencies

- None (all touch different files)

### Agent Prompts

**Agent-1 (T01 — Waitlist):**

- Remove waitlist gate from AuthGate.tsx login flow (lines 101-108)
- Keep waitlist table insert for analytics, remove status check
- Remove tab switcher UI (single auth flow: email → magic link)
- AC: new email gets magic link immediately, no "pending review" error

**Agent-2 (T02 — ReAct Retry):**

- Replace `return` with `continue` in pipeline.py:232-239
- Add `failure_count` tracker, max 2 consecutive failures → hard stop
- Feed failure observation back to planner as history entry
- Add failure recovery instructions to REACT_SYSTEM_PROMPT in planner_agent.py
- AC: step failure → planner sees it → recovers → final result correct

**Agent-3 (T04 — Loading State):**

- In ThinkingProcess.tsx, when `isStreaming && steps.length === 0`, show "Thinking..." pulse
- Add i18n key `chat.thinking` to all 3 locale dictionaries
- AC: no blank bubble, pulse transitions to steps when first step arrives

**Agent-4 (T05 — Session Hydration):**

- In api.ts, parse response_data: `typeof m.response_data === 'string' ? JSON.parse(m.response_data) : m.response_data`
- In AppShell.tsx hydration useEffect: add sessionId to deps, add console.error in catch
- Handle null/undefined response_data gracefully (text-only message)
- AC: clicking sidebar conversation loads messages with full result panel data

### Verification
```bash
make check                    # backend lint + type + unit
cd frontend && npm run build  # static export
```
Manual: new user signup, step failure recovery, loading state, session restore

### Merge Strategy

- Create 4 branches, 4 PRs
- Wait 10 min for CodeRabbit/Qodo comments
- Fix all review feedback (never accept as-is)
- Merge to main, CI auto-deploys

---

## Iter 7: Should-Fix + Test Infrastructure Foundation

**Goal:** Fix remaining user-facing bugs. Set up testcontainer base + migrate integration tests.
**Duration estimate (CC):** ~60 min
**Parallelism:** 7 worktree agents
**Depends on:** Iter 6 merged (T02 before T06, T01 before T11/T12, T05 before T10)

### Tasks — Bugfix (from production-bugfix-design.md)

| ID | Task | Files | Agent? |
|----|------|-------|--------|
| T06 | Route intent inference + dedup | `pipeline.py` (after T02) | agent-1 |
| T09 | Mobile sidebar CSS conflict | `Sidebar.tsx`, `AppShell.tsx` | agent-2 |
| T10 | Result panel auto-open | `AppShell.tsx` (after T05) | agent-3 |
| T12 | Login button visible on mobile | `AuthGate.tsx` (after T01) | agent-3 |
| T13 | Remove language switchers | `ChatHeader.tsx`, `Sidebar.tsx` | agent-4 |
| T14 | Conversation error handling | `useConversationHistory.ts` | agent-4 |

### Tasks — Test Infrastructure (from test-infrastructure-design.md)

| ID | Task | Files | Agent? |
|----|------|-------|--------|
| TI-1 | Testcontainer conftest + seed data | `conftest_db.py`, `seed.sql`, `pyproject.toml` | agent-5 |
| TI-2 | Migrate integration tests to testcontainer | `test_runtime_acceptance.py`, `test_api_contract.py` | agent-6 |
| TI-3 | Migrate eval to testcontainer | `test_plan_quality.py` | agent-7 |

### Agent Grouping

- Agent-1: T06 (route intent + dedup guards in pipeline.py)
- Agent-2: T09 (mobile sidebar variant prop)
- Agent-3: T10 + T12 (both in AppShell/AuthGate area, small changes)
- Agent-4: T13 + T14 (both sidebar/header cleanup)
- Agent-5: TI-1 (testcontainer setup, fresh files)
- Agent-6: TI-2 (migrate integration tests)
- Agent-7: TI-3 (migrate eval tests)

### Merge Order

1. First wave: agent-2, agent-4, agent-5 (no dependencies on Iter 6 specifics)
2. Second wave: agent-1 (needs T02), agent-3 (needs T01+T05), agent-6 (needs TI-1), agent-7 (needs TI-1)

---

## Iter 8: Agent Architecture v2 + Eval Expansion

**Goal:** Replace deterministic guards with result_validator. Expand eval to 160 cases. Eval-driven development.
**Duration estimate (CC):** ~90 min
**Depends on:** Iter 7 merged (testcontainer eval working, T06 intent fix stable)

### Phase 1 — Foundation (no behavior change)

| ID | Task | Files |
|----|------|-------|
| AA-1 | Intent classifier (regex + keyword) | `backend/agents/intent_classifier.py` (new) |
| AA-2 | Step dependency graph | `backend/agents/models.py` |
| AA-3 | result_validator alongside existing guards | `backend/agents/planner_agent.py` |
| AA-4 | failure_count + continue in react_loop | `backend/agents/pipeline.py` (done in T02, verify) |

### Phase 2 — Cutover

| ID | Task | Files |
|----|------|-------|
| AA-5 | Remove all 3 deterministic guards | `backend/agents/pipeline.py` |
| AA-6 | Verify result_validator catches all guard cases | eval run |

### Phase 3 — Eval Expansion

| ID | Task | Files |
|----|------|-------|
| TI-4 | Generate 111 new eval cases (49 → 160) | `plan_quality_v1.json` |
| AA-7 | Run 160 eval cases, gate: score >= baseline | eval run |
| AA-8 | Add failure recovery + premature done eval cases | `plan_quality_v1.json` |

### Phase 4 — User Visibility

| ID | Task | Files |
|----|------|-------|
| AA-9 | Streaming thought display | `ThinkingProcess.tsx` (rewrite) |
| AA-10 | SSE event format: add thought field | `pipeline.py`, `fastapi_service.py` |
| AA-11 | MessageBubble thoughts above tool steps | `MessageBubble.tsx` |

### Execution Strategy

**Eval-driven:** Every code change runs `make test-eval` before and after. Gate: score >= baseline for all evaluators.

**Phase 1+2 sequential:** Foundation first, then cutover. Cannot parallelize (same files).

**Phase 3 parallel:** 10 agents generate eval cases by category (dispatch from TI-4 in test-infrastructure-design.md).

**Phase 4 parallel:** Frontend (AA-9, AA-11) and backend (AA-10) can run simultaneously.

---

## Iter 9: Frontend Redesign + SEO/GEO

**Goal:** Landing page converts, mobile-first design, discoverability in search + AI.
**Duration estimate (CC):** ~60 min
**Depends on:** Iter 6 merged (AuthGate changes must be stable). Independent of Iter 8.

### Track A — Frontend Redesign (from frontend-redesign-design.md)

| ID | Task | Files | Agent? |
|----|------|-------|--------|
| FR-1 | Landing page map hero | `AuthGate.tsx` (rewrite) | agent-1 |
| FR-2 | Mobile layout (3 screens) | `AppShell.tsx`, `ResultDrawer.tsx` | agent-2 |
| FR-3 | Sidebar redesign (timestamps, counts) | `Sidebar.tsx` | agent-3 |
| FR-4 | Anchor card redesign (pin icon) | `MessageBubble.tsx` | agent-3 |
| FR-5 | Scroll-reveal animations | `globals.css`, intersection observer | agent-1 |
| FR-6 | Desktop app polish | Various layout components | agent-2 |

### Track B — SEO/GEO (from seo-geo-design.md)

| ID | Task | Files | Agent? |
|----|------|-------|--------|
| SEO-1 | Sitemap + robots.txt | `next.config.ts`, `public/` | agent-4 |
| SEO-2 | JSON-LD structured data | `layout.tsx` | agent-4 |
| SEO-3 | og:image generation | `public/og-image.png` or dynamic | agent-5 |
| SEO-4 | hreflang tags | `layout.tsx` | agent-4 |
| SEO-5 | Meta tags per locale | `layout.tsx` | agent-4 |
| SEO-6 | AI visibility content strategy | docs only (no code) | agent-5 |

### Parallelism

- Track A and B are fully independent (different files)
- Within Track A: FR-1 and FR-2 touch different files, can parallelize
- Within Track B: SEO-1 through SEO-5 mostly same file (layout.tsx), should be one agent

---

## Iter 10: Nice-to-Have Bugfixes + Polish

**Goal:** Remaining production polish items.
**Duration estimate (CC):** ~30 min
**Depends on:** Iter 7+ merged

### Tasks (from production-bugfix-design.md)

| ID | Task | Files |
|----|------|-------|
| T03 | Spot detail view | `PilgrimageGrid.tsx`, `registry.ts` |
| T07 | Pacing selector wire-up | `RoutePlannerWizard.tsx` |
| T08 | Route timeline i18n | `RoutePlannerWizard.tsx` (with T07) |
| T11 | Landing chat preserve query | `AuthGate.tsx` |
| T15 | Session delete (full stack) | backend + frontend |
| T16 | Follow-up suggestions | `PilgrimageGrid.tsx`, `RoutePlannerWizard.tsx` |
| T17 | Landing page real photos | `AuthGate.tsx` |
| T18 | Google Maps export fallback | `RoutePlannerWizard.tsx` |
| T19 | Route history clickable | `Sidebar.tsx` |

### Grouping

- Agent-1: T03 (spot detail view, largest change)
- Agent-2: T07 + T08 (pacing + i18n, same file)
- Agent-3: T15 (session delete, full stack)
- Agent-4: T11 + T17 (AuthGate changes)
- Agent-5: T16 + T18 + T19 (small follow-up UI changes)

---

## Iter 11: E2E + Production Validation

**Goal:** Playwright E2E covering 4 flows. Frontend component tests. CI pipeline updated.
**Duration estimate (CC):** ~45 min
**Depends on:** All previous iterations merged

### Tasks (from test-infrastructure-design.md)

| ID | Task | Files |
|----|------|-------|
| TI-5 | Playwright E2E setup + 4 flows | `e2e/` directory |
| TI-6 | Frontend component tests (Vitest) | `frontend/tests/` |
| TI-7 | CI pipeline update | `.github/workflows/ci.yml` |

### E2E Flows

1. Auth flow: magic link → session → sidebar history
2. Search flow: anime name → results grid → spot detail
3. Route planning: select spots → plan → route visualization
4. Conversation: send → new chat → click old → history restored

### CI Pipeline Additions

- Unit tests (existing)
- Integration tests with Docker postgres service
- Eval gate (gemini-2.5-pro + testcontainer)
- Frontend component tests (vitest)
- E2E local (Playwright against dev server)
- Post-deploy E2E against production URL

---

## Housekeeping

### Before Starting
```bash
# Clean 28 stale worktrees from previous sessions
git worktree prune
rm -rf .claude/worktrees/agent-*
rm -rf .worktrees/*

# Verify clean state
git worktree list
```

### Per-Iteration Rules

1. Rebase all worktree branches from main before starting
2. Run `ruff format` before every commit
3. Wait 10 min for CodeRabbit/Qodo comments after PR creation
4. Fix all review feedback (never accept as-is, never add type: ignore)
5. No backward compatibility shims, just update callers
6. `make check` passes before and after each merge to main

### Per-PR Quality Gate
```bash
# Backend
uv run ruff check backend/ --fix
uv run ruff format backend/
uv run mypy backend/ --strict
uv run pytest backend/tests/unit -x -q

# Frontend
cd frontend && npm run build
```

---

## Summary Table

| Iteration | Focus | Tasks | Agents | Depends On |
|-----------|-------|-------|--------|------------|
| **6** | Must-fix bugs | 4 | 4 parallel | — |
| **7** | Should-fix + test infra | 9 | 7 parallel | Iter 6 |
| **8** | Agent arch v2 + eval | 11 | sequential + parallel | Iter 7 |
| **9** | Frontend + SEO/GEO | 12 | 5 parallel | Iter 6 |
| **10** | Nice-to-have bugs | 9 | 5 parallel | Iter 7+ |
| **11** | E2E + CI | 3 | 3 parallel | All |
| **Total** | | **48** | | |

## Open Questions

1. Should Iter 9 (frontend redesign) start after Iter 6 or wait for Iter 7? AuthGate changes in T01 affect FR-1.
2. Should Iter 8 Phase 3 (eval expansion) use gemini-2.5-pro or local qwen3.5-9b for case generation?
3. Storybook for frontend components: add to Iter 11 or defer?
