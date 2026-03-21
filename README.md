# Seichijunrei Agent

Backend runtime for anime pilgrimage search and route planning.

This repository is now a single-track v2 codebase centered on a
**Plan-and-Execute** runtime:

`IntentAgent -> PlannerAgent -> ExecutorAgent -> tools/use cases`

Legacy UI and protocol scaffolding have been removed so the repo reflects what
the code actually does today.

## What Exists Today

- Intent classification with regex fast-path + LLM fallback
- Parameterized SQL retrieval against Supabase/Postgres + PostGIS
- Deterministic retrieval strategy layer with `sql`, `geo`, and `hybrid`
- Retriever-side cache plus DB-miss fallback with write-through persistence
- Executor responses with normalized status, message, notices, and summaries
- Thin public API request/response facade for future external adapters
- `aiohttp` HTTP service exposing `/healthz` and `/v1/runtime`
- Session-aware public API flow with persisted route history
- Dockerized runtime service entrypoint for container deployment
- OpenTelemetry-ready tracing and metrics hooks at the HTTP and runtime layers
- Deterministic planner that maps intent to execution steps
- Sequential executor that runs retrieval and route-planning handlers
- Gateway/use-case layer for Bangumi, Anitabi, translation, and route planning
- Unit test coverage for the core runtime

## Current Architecture

High-level flow:

1. `agents/intent_agent.py`
   Classifies the user request into `search_by_bangumi`, `search_by_location`,
   `plan_route`, `general_qa`, or `unclear`.
2. `agents/planner_agent.py`
   Converts the classified intent into an `ExecutionPlan`.
3. `agents/executor_agent.py`
   Executes the plan step by step and builds normalized final output, including partial and error responses.
4. `agents/retriever.py`
   Chooses `sql`, `geo`, or `hybrid` retrieval deterministically, caches repeated lookups, and can refill Supabase on DB misses.
5. `agents/sql_agent.py`
   Handles structured SQL retrieval for bangumi and route-constrained queries.
6. `application/` + `infrastructure/`
   Provide stable use cases, ports, and gateways for external services.
7. `interfaces/public_api.py`
   Exposes a thin public request/response facade over the runtime, including session persistence and route history.
8. `interfaces/http_service.py`
   Wraps the public facade in a minimal HTTP service suitable for local runs and container deployment.
9. `infrastructure/observability/`
   Initializes OpenTelemetry providers and records spans/metrics for HTTP requests and runtime calls.

Detailed reference: [docs/ARCHITECTURE.md](/Users/lumimamini/Documents/Seichijunrei-agent/docs/ARCHITECTURE.md)

## Development

Install dependencies:

```bash
uv sync --extra dev
```

Run unit tests:

```bash
make test
```

Run all checks:

```bash
make check
```

Run the HTTP service:

```bash
make serve
```

## Environment

The current runtime primarily depends on:

- `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANITABI_API_URL`
- `SERVICE_HOST`
- `SERVICE_PORT`
- `SESSION_STORE_BACKEND`
- `OBSERVABILITY_ENABLED`
- `OBSERVABILITY_EXPORTER_TYPE`
- `OBSERVABILITY_OTLP_ENDPOINT`
- `GEMINI_API_KEY` or provider-specific model credentials when using LLM fallback

See [config/settings.py](/Users/lumimamini/Documents/Seichijunrei-agent/config/settings.py) for the current source of truth.

## Example Usage

```python
from agents.pipeline import run_pipeline
from config.settings import get_settings
from infrastructure.supabase.client import SupabaseClient


async def main() -> None:
    settings = get_settings()
    async with SupabaseClient(settings.supabase_db_url) as db:
        result = await run_pipeline("从京都站出发去吹响的圣地", db)
        print(result.final_output)
```

HTTP request example:

```bash
curl -X POST http://127.0.0.1:8080/v1/runtime \
  -H 'Content-Type: application/json' \
  -d '{"text":"从京都站出发去吹响的圣地"}'
```

## Project Layout

```text
agents/          Core runtime: intent, planning, execution, SQL
application/     Use cases and abstract ports
clients/         External HTTP clients
config/          Environment and runtime configuration
domain/          Core entities and domain errors
infrastructure/  Gateways, Supabase adapter, session backends, MCP servers
interfaces/      Thin public interface facades over the runtime
services/        Shared utilities such as retry/cache/route planner
tests/           Unit and eval coverage
```

## Planning Docs

- [task_plan.md](/Users/lumimamini/Documents/Seichijunrei-agent/task_plan.md)
- [progress.md](/Users/lumimamini/Documents/Seichijunrei-agent/progress.md)
- [findings.md](/Users/lumimamini/Documents/Seichijunrei-agent/findings.md)
