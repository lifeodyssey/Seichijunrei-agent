# V2 Findings

## Chosen Runtime

The repository converges on a two-step Plan-and-Execute model:

`ReActPlannerAgent -> ExecutorAgent`

`ReActPlannerAgent` produces a structured `ExecutionPlan` (Pydantic AI, `output_type=ExecutionPlan`).
`ExecutorAgent` dispatches it deterministically — no LLM calls during execution.
Intent reasoning is fused into the planner's LLM pass; there is no separate `IntentAgent`.

## Why This Shape

- Planning should stay explicit, typed, and deterministic
- Execution should call handlers and tools, not hide orchestration in prompts
- Structured retrieval fits the current data and product scope better than a fuzzier policy layer
- Eliminating a dedicated intent-classification step reduces latency and simplifies the call graph

## Retrieval Direction

Current baseline:

- Deterministic retriever layer with `sql`, `geo`, and `hybrid` strategies
- PostGIS-backed geo search + structured SQL retrieval (parameterized only)
- DB-miss fallback flow (external source → write-through to Supabase) where appropriate
- Optional `force_refresh` to bypass cached reads when freshness matters

Strategy selection stays deterministic policy. The planner may choose which *tool*
to call, but the retriever itself should not become a second LLM-driven agent hierarchy.

## What Was Removed

- legacy architecture narrative
- legacy interface protocol and renderer layer
- legacy interface server prototype
- Separate stage-workflow step-agent path

## Open Question

How far should "freshness" go (per-tool cache TTLs, user-controlled refresh) before
it becomes a product UX surface instead of a runtime concern?
