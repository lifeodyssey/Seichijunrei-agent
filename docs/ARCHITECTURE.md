# V2 Architecture

## Overview

The repository now targets one runtime model only:

`IntentAgent -> PlannerAgent -> ExecutorAgent`

Everything else hangs off that path as deterministic handlers, use cases, or
infrastructure adapters.

The codebase does **not** currently maintain a separate UI workflow layer or a
second orchestration stack.

The deployable entry path is now:

`HTTP service -> RuntimeAPI -> run_pipeline -> Intent -> Planner -> Executor`

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
- Normalizes final response status and message shape
- Still formats a response when retrieval or route execution fails partway through

### `agents/retriever.py`

- Selects retrieval strategy deterministically
- Supports `sql`, `geo`, and `hybrid`
- Caches successful retrieval results for repeated identical queries
- On bangumi DB misses, can fetch points from external sources and write them through to Supabase
- Keeps strategy policy outside the executor step loop

### `agents/sql_agent.py`

- Owns SQL generation/execution for structured retrieval
- Uses parameterized queries only
- Supports bangumi, location, and route-fetch intents

### `application/`

- Stable use cases and port interfaces
- Keeps external clients out of orchestration code

### `interfaces/public_api.py`

- Wraps `run_pipeline` behind a stable request/response contract
- Maps internal exceptions into public-facing error payloads
- Optionally exposes debug details without forcing callers to depend on runtime dataclasses
- Persists session state via the configured session store
- Records route history and mirrors route saves into Supabase when available

### `interfaces/http_service.py`

- Wraps `RuntimeAPI` in a minimal `aiohttp` service
- Exposes `/healthz` for container health probes
- Exposes `/v1/runtime` as the deployable backend endpoint
- Owns service startup and shutdown for Supabase and session-store resources

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
4. `ExecutorAgent` runs `Retriever`, which selects `sql` or `hybrid`
5. On a bangumi DB miss, `Retriever` can backfill from Anitabi and persist the results
6. Final payload is returned as structured output

### Plan Route

1. User text enters `run_pipeline`
2. `IntentAgent` extracts bangumi id and optional origin
3. `PlannerAgent` emits `query_db -> plan_route -> format_response`
4. `ExecutorAgent` uses `Retriever` to fetch points, then applies route ordering and formatting

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
- frontend rendering systems such as A2UI or generative UI

If these return later, they should be reintroduced as thin adapters around the
existing runtime rather than as a competing architecture.

## Next Major Work

- Observability and end-to-end validation
