<div align="center">

# 聖地巡礼 Seichijunrei

**AI-powered pilgrimage search and route planning for anime sacred sites**

[![CI](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml)
[![Deploy](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/deploy.yml/badge.svg)](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/deploy.yml)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)](https://www.python.org)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg)](https://developers.cloudflare.com/workers/)

[**Try it live**](https://seichijunrei.zhenjia.org) | [Architecture](docs/ARCHITECTURE.md) | [Deployment](DEPLOYMENT.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

Tell the agent an anime title or a location in natural language. It finds real-world pilgrimage spots, shows them on a map, and plans a walking route — all in one conversational turn.

## How It Works

```
User text  →  ReActPlannerAgent (LLM → structured ExecutionPlan)
                        ↓
               ExecutorAgent (deterministic tool dispatch)
                 ├── resolve_anime  → DB-first title lookup; Bangumi.tv API on miss
                 ├── search_bangumi → parameterized SQL → Supabase points
                 ├── search_nearby  → PostGIS geo retrieval
                 ├── plan_route     → nearest-neighbor route ordering
                 └── answer_question → static FAQ
```

The planner is the only LLM call. The executor is fully deterministic — no LLM during execution.

`resolve_anime` is self-evolving: on first query for an unknown title it fetches metadata from Bangumi.tv, upserts it into the database, and all future queries hit the local DB.

## Features

- **Conversational search** — ask in Japanese, English, or Chinese; the planner handles intent
- **Self-evolving anime catalog** — DB-first with Bangumi.tv API write-through on miss
- **Geo retrieval** — find pilgrimage spots near any coordinate or station name
- **Route planning** — nearest-neighbor ordering with optional user-selected points
- **Generative UI** — three-column layout with chat panel + interactive result panel
- **Edge auth** — JWT (magic-link) and API key auth enforced at Cloudflare Worker
- **Eval harness** — 50+ plan-quality cases across 3 locales via pydantic_evals

## Quick Start

```bash
# Install Python dependencies
uv sync --extra dev

# Run the service locally
make serve

# Run tests
make test              # unit tests
make test-integration  # stable acceptance tests
make test-all          # unit + integration
make test-eval         # model-backed evals (needs LLM access)
make check             # lint + typecheck + test
```

## Database Migrations

Uses the Supabase CLI for all schema changes:

```bash
make db-list           # list applied migrations
make db-push-dry       # dry-run migration
make db-push           # apply migrations
make db-diff NAME=x    # generate diff from local changes
```

Apply migrations in a dedicated deploy step, not at application startup.

## Environment

**Required:**
| Variable | Purpose |
|---|---|
| `SUPABASE_DB_URL` | Postgres connection string |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase auth |
| `SUPABASE_ANON_KEY` | JWT validation at Worker edge |
| `ANITABI_API_URL` | Anitabi pilgrimage data API |
| `GEMINI_API_KEY` | LLM for planner agent |

**Optional:** `SERVICE_HOST`, `SERVICE_PORT`, `OBSERVABILITY_*`, `DEFAULT_AGENT_MODEL`

See [`config/settings.py`](config/settings.py) for full reference and [`.env.example`](.env.example) for defaults.

## Example Usage

**Python (direct):**
```python
from agents.pipeline import run_pipeline
from infrastructure.supabase.client import SupabaseClient

async def main() -> None:
    async with SupabaseClient(db_url) as db:
        result = await run_pipeline("吹響ユーフォニアムの聖地", db, locale="ja")
        print(result.message)
```

**HTTP (API key):**
```bash
curl -X POST https://seichijunrei.zhenjia.org/v1/runtime \
  -H 'Authorization: Bearer sk_your_key_here' \
  -H 'Content-Type: application/json' \
  -d '{"text":"吹響の聖地","locale":"ja"}'
```

**Python client:**
```python
from clients.python.seichijunrei_client import SeichijunreiClient

client = SeichijunreiClient(api_key="sk_your_key_here")
result = client.search("Hibike Euphonium locations", locale="en")
```

## Project Layout

```text
agents/          Planner, executor, retriever, SQL agent, shared models
application/     Use cases and abstract ports
clients/         Python sync/async client for agent/CLI use
config/          Environment and runtime configuration
domain/          Core entities and domain errors
frontend/        Next.js static-export frontend (three-column light theme)
infrastructure/  Supabase client, gateways, session, observability
interfaces/      Public API facade + aiohttp HTTP service
worker/          Cloudflare Worker (auth middleware + asset routing)
tests/           Unit, integration, and eval test suites
tools/           Eval CLI: scorer, feedback miner
```

## Docs

- [Architecture](docs/ARCHITECTURE.md) — full system design reference
- [Deployment](DEPLOYMENT.md) — Cloudflare Workers + Containers deploy guide
- [Implementation plans](docs/superpowers/plans/) — iteration history (Iter 0-3 + Auth)
- [Design spec](docs/superpowers/specs/) — product specification
