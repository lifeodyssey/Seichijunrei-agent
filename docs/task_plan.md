# Task Plan

## Goal

Ship a single v2 backend runtime for anime pilgrimage planning based on
Pydantic AI, Supabase, and a Plan-and-Execute execution model.

## Current Phase

Documentation & repo hygiene (2026-04-03)

## Phases

### Phase 1 — Foundation

- [x] STORY 1.1: Supabase client and schema foundation
- [x] STORY 1.2: ReActPlannerAgent structured plan output (Pydantic AI)
- [x] STORY 1.3: Deterministic ExecutorAgent tool dispatch + static templates
- Status: done

### Phase 2 — Convergence Cleanup

- [x] STORY 2.1: Remove legacy interface branches and converge docs to v2
- Status: done

### Phase 3 — Retrieval And Execution

- [x] STORY 3.1: Deterministic retriever with `sql`, `geo`, and `hybrid` strategies
- [x] STORY 3.2: Write-through cache and DB-miss fallback flow
- [x] STORY 3.3: Richer executor handler surface on top of retriever output
- Status: done

### Phase 4 — Public Interface

- [x] STORY 4.1: Add a thin public API surface over `run_pipeline`
- [x] STORY 4.2: Session persistence and route history
- Status: done

### Phase 5 — Platform

- [x] STORY 5.1: Cloudflare/Container deployment path
- [x] STORY 5.2: OpenTelemetry tracing and metrics
- [x] STORY 5.3: End-to-end acceptance and baseline comparison
- Status: done

### Phase 6 — Memory + Streaming

- [x] STORY 6.1: Session-aware context injection into planner prompt
- [x] STORY 6.2: Route origin support (planner + executor)
- [x] STORY 6.3: `POST /v1/runtime/stream` SSE endpoint + frontend client
- [x] STORY 6.4: Session compaction (LLM-backed, best-effort)
- Status: done

### Phase 7 — Persistence + UX

- [x] STORY 7.1: User memory persistence (Supabase `user_memory`)
- [x] STORY 7.2: Onboarding greeting flow (`greet_user`)
- [x] STORY 7.3: Selected-point routing without planner pass (`plan_selected`)
- [x] STORY 7.4: Frontend UX polish (loading, onboarding prompts, sidebar titles)
- Status: done

## Key Decisions

- Runtime orchestration is `ReActPlannerAgent -> ExecutorAgent` (no separate IntentAgent)
- Retrieval stays deterministic and structured-first
- UI/protocol layers are deferred until the runtime is stable
- Any future interface must wrap the runtime, not replace it

## Next Story

No active story queued (keep docs in sync with code changes)
