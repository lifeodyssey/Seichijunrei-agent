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

- bangumi-id lookup
- location lookup with PostGIS
- route point fetch for planning

Next expansion:

- `sql`
- `geo`
- `hybrid`

These strategies should plug into the executor as capabilities, not as a second
agent hierarchy.

## What Was Removed

- legacy architecture narrative
- legacy interface protocol and renderer layer
- legacy interface server prototype
- Separate stage-workflow step-agent path

## Open Question

How much of the retriever should remain deterministic policy versus LLM-chosen
strategy selection inside the executor?
