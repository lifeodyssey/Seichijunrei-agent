# Task Plan

## Goal

Ship a single v2 backend runtime for anime pilgrimage planning based on
Pydantic AI, Supabase, and a Plan-and-Execute execution model.

## Current Phase

Phase 5 — Platform hardening

## Phases

### Phase 1 — Foundation

- [x] STORY 1.1: Supabase client and schema foundation
- [x] STORY 1.2: IntentAgent with regex fast-path and LLM fallback
- [x] STORY 1.3: SQLAgent with parameterized retrieval
- [x] STORY 1.4: PlannerAgent + ExecutorAgent core runtime
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
- [ ] STORY 5.3: End-to-end acceptance and baseline comparison
- Status: pending

## Key Decisions

- Runtime orchestration stays `Intent -> Plan -> Execute`
- Retrieval stays deterministic and structured-first
- UI/protocol layers are deferred until the runtime is stable
- Any future interface must wrap the runtime, not replace it

## Next Story

`STORY 5.3: End-to-end acceptance and baseline comparison`
