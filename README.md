# Seichijunrei Agent

Anime pilgrimage search and route planning service.

**Plan-and-Execute runtime:**

`ReActPlannerAgent -> ExecutorAgent -> tools/use cases`

**Implementation status:** Iter 0.5–3 are in progress. See `docs/superpowers/plans/` for task-by-task steps.

## What This Builds

- LLM-driven `ReActPlannerAgent` with Pydantic AI structured `ExecutionPlan` output
- `resolve_anime` self-evolving anime catalog — DB-first, Bangumi.tv API on miss, write-through
- Parameterized SQL + geo retrieval against Supabase/Postgres + PostGIS
- Deterministic `ExecutorAgent` — no LLM calls during execution; static message templates
- Always-dark three-column frontend with Generative UI registry (chat + result panel)
- JWT + API key auth enforced at Cloudflare Worker edge
- `aiohttp` HTTP service: `/healthz`, `/v1/runtime`, `/v1/feedback`
- Session-aware public API with persisted route history
- OpenTelemetry tracing and metrics at HTTP and runtime layers
- pydantic_evals harness with 50+ plan-quality cases × 3 locales

## Architecture

```
ReActPlannerAgent (LLM → ExecutionPlan)
    ↓
ExecutorAgent (deterministic tool dispatch)
    ├── resolve_anime  → DB-first title lookup; Bangumi.tv on miss
    ├── search_bangumi → Retriever → Supabase points
    ├── search_nearby  → Geo retrieval
    ├── plan_route     → Nearest-neighbor sort
    └── answer_question → Static FAQ
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full detail.

## Development

Install dependencies:

```bash
uv sync --extra dev
```

```bash
make test              # unit tests
make test-integration  # stable acceptance tests
make test-all          # unit + integration
make test-eval         # model-backed evals (needs LLM access)
make check             # lint + format + type check
make serve             # run HTTP service locally
```

## Environment

Required:

- `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY` (used by CF Worker for JWT validation)
- `ANITABI_API_URL`
- `GEMINI_API_KEY` or `DEFAULT_AGENT_MODEL` pointing to another provider

Optional: `SERVICE_HOST`, `SERVICE_PORT`, `SESSION_STORE_BACKEND`, `OBSERVABILITY_*`, `REDIS_*`

See [config/settings.py](config/settings.py) for the full source of truth and [`.env.example`](.env.example) for defaults.

## Example Usage

Python (direct):
```python
from agents.pipeline import run_pipeline
from infrastructure.supabase.client import SupabaseClient

async def main() -> None:
    async with SupabaseClient(db_url) as db:
        result = await run_pipeline("吹響ユーフォニアムの聖地", db, locale="ja")
        print(result.message)
```

HTTP (with API key):
```bash
curl -X POST https://seichijunrei.dev/v1/runtime \
  -H 'Authorization: Bearer sk_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{"text":"吹響の聖地","locale":"ja"}'
```

Python client (for agents/CLI):
```python
from clients.python.seichijunrei_client import SeichijunreiClient

client = SeichijunreiClient(api_key="sk_your_key_here")
result = client.search("Hibike Euphonium locations", locale="en")
```

## Project Layout

```text
agents/          Core runtime: planner, executor, retriever, SQL, models
application/     Use cases and abstract ports
clients/         Python sync/async client for agent/CLI use
config/          Environment and runtime configuration
domain/          Core entities and domain errors
frontend/        Next.js static-export frontend (three-column, always dark)
infrastructure/  Supabase client, gateways, session backends, observability
interfaces/      Public API facade + aiohttp HTTP service
src/             Cloudflare Worker (auth middleware + asset routing)
tests/           Unit, integration, and eval coverage
tools/           Eval CLI tools: eval_scorer.py, eval_feedback_miner.py
```

## Docs

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — full architecture reference
- [docs/superpowers/plans/](docs/superpowers/plans/) — implementation plans (Iter 0–3 + Auth)
- [docs/superpowers/specs/](docs/superpowers/specs/) — design spec
