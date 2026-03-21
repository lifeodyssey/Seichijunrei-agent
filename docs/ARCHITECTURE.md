# V2 Architecture

## Overview

The repository now targets one runtime model only:

`IntentAgent -> PlannerAgent -> ExecutorAgent`

Everything else hangs off that path as deterministic handlers, use cases, or
infrastructure adapters.

The codebase does **not** currently maintain a separate UI workflow layer or a
second orchestration stack.

## Runtime Components

### `agents/intent_agent.py`

- Fast-path regex classification for common Chinese/Japanese queries
- LLM fallback for ambiguous inputs
- Produces `IntentOutput`

### `agents/planner_agent.py`

- Converts `IntentOutput` into `ExecutionPlan`
- Keeps planning explicit and inspectable
- Avoids hidden orchestration logic in handlers

### `agents/executor_agent.py`

- Executes plan steps sequentially
- Passes successful step output forward as context
- Produces `PipelineResult`

### `agents/sql_agent.py`

- Owns SQL generation/execution for structured retrieval
- Uses parameterized queries only
- Supports bangumi, location, and route-fetch intents

### `application/`

- Stable use cases and port interfaces
- Keeps external clients out of orchestration code

### `infrastructure/`

- Supabase client
- Gateway adapters
- Optional session backends
- MCP server implementations

## Data Flow

### Search by Bangumi

1. User text enters `run_pipeline`
2. `IntentAgent` extracts bangumi id and optional episode/location
3. `PlannerAgent` emits `query_db -> format_response`
4. `ExecutorAgent` runs `SQLAgent`
5. Final payload is returned as structured output

### Plan Route

1. User text enters `run_pipeline`
2. `IntentAgent` extracts bangumi id and optional origin
3. `PlannerAgent` emits `query_db -> plan_route -> format_response`
4. `ExecutorAgent` fetches points, applies route ordering, and formats output

## Design Rules

- One orchestration path
- Deterministic planning
- Structured outputs between runtime stages
- Gateway/use-case boundaries around external services
- No parallel architecture narrative in docs

## What Is Intentionally Not In Scope

- legacy interface-specific protocol layers
- secondary workflow stacks
- presentation-specific orchestration code
- Separate stage-workflow agent stacks

If these return later, they should be reintroduced as thin adapters around the
existing runtime rather than as a competing architecture.

## Next Major Work

- Agentic retriever strategies
- Better executor handler composition
- Public API/interface surface on top of the runtime
- Deployment hardening and observability
