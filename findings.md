# V2 Findings

## Chosen Runtime

The repository now converges on one execution model:

`IntentAgent -> PlannerAgent -> ExecutorAgent`

This is the simplest shape that matches the implemented code and keeps the
retrieval and route-planning logic inspectable.

## Why This Shape

- Intent classification is a separate concern from execution
- Planning should stay explicit, typed, and deterministic
- Execution should call handlers and tools, not hide orchestration in prompts
- Structured retrieval fits the current data and product scope better than a fuzzier policy layer

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
