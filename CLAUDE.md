# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## What This Repo Is

Seichijunrei is a backend runtime for anime pilgrimage search and route
planning.

The repository is now a single-track v2 codebase centered on:

`IntentAgent -> PlannerAgent -> ExecutorAgent`

The runtime sits behind a thin public API and a thin HTTP service. Legacy ADK,
A2A, and A2UI architecture are not part of the current codebase.

## Current Commands

```bash
# Setup
make dev

# Runtime
make serve

# Tests
make test                 # unit tests
make test-integration     # stable integration acceptance tests
make test-all             # unit + integration
make test-eval            # model-backed evals, separate from stable CI tests

# Code quality
make lint
make format
make check
```

Notes:
- `pytest` is configured with `--asyncio-mode=auto`
- stable test gates are `tests/unit` and `tests/integration`
- `tests/eval` is intentionally separate because it can depend on external model
  availability

## Current Architecture

### Agents

- `agents/intent_agent.py`
  Regex fast-path classification first, then LLM fallback.
- `agents/planner_agent.py`
  Deterministic intent-to-plan mapping.
- `agents/executor_agent.py`
  Sequential plan execution and normalized final response shaping.
- `agents/retriever.py`
  Deterministic retrieval policy: `sql`, `geo`, `hybrid`.
- `agents/sql_agent.py`
  Parameterized SQL generation/execution for Supabase/PostGIS.
- `agents/pipeline.py`
  Main runtime entry: classify -> plan -> execute.

### Interfaces

- `interfaces/public_api.py`
  Stable request/response facade over `run_pipeline`, with session persistence
  and route history.
- `interfaces/http_service.py`
  `aiohttp` service exposing `GET /healthz` and `POST /v1/runtime`.

### Infrastructure

- `infrastructure/supabase/client.py`
  Direct `asyncpg` access for structured PostGIS queries and write-through
  persistence.
- `infrastructure/session/`
  `memory`, `redis`, and `firestore` session stores.
- `infrastructure/observability/`
  OpenTelemetry setup plus runtime/http instrumentation helpers.
- `infrastructure/gateways/`
  Bangumi, Anitabi, route-planner, and translation adapters.

### Application

- `application/use_cases/`
  Use-case layer for point fetch, subject lookup, route planning, and other
  orchestrated operations.
- `application/ports/`
  Protocol boundaries for external integrations.

## Data / Retrieval Notes

- Database is Supabase PostgreSQL with PostGIS
- The current runtime does **not** use semantic/vector retrieval
- Retrieval is structured-first and deterministic
- On selected DB misses, retriever fallback can fetch from external sources and
  write through to Supabase

## Deployment Notes

- Local and container entrypoint is the same HTTP backend service
- `Dockerfile` packages the runtime service
- Cloudflare deployment is treated as a container-hosting path around the same
  HTTP service, not as a separate orchestration architecture

## Observability

- Request-level HTTP spans/metrics are emitted in `interfaces/http_service.py`
- Runtime-level spans/metrics are emitted in `interfaces/public_api.py`
- Observability is controlled via settings such as:
  - `OBSERVABILITY_ENABLED`
  - `OBSERVABILITY_EXPORTER_TYPE`
  - `OBSERVABILITY_OTLP_ENDPOINT`

## Acceptance / Baseline

- Stable acceptance coverage lives in `tests/integration/`
- The frozen runtime baseline is:
  `tests/integration/cases/runtime_acceptance_baseline.json`
- This baseline checks the same scenarios through both `run_pipeline` and the
  public API facade

## Working Expectations

- Prefer updating the current v2 runtime instead of reintroducing alternate
  interface stacks
- Keep retrieval deterministic unless a task explicitly changes that rule
- Preserve the simple frontend/backend split described in the current docs
