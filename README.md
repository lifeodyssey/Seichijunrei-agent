<div align="center">

# 聖地巡礼 Seichijunrei

**AI-powered pilgrimage search and route planning for anime sacred sites**

[![CI](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/lifeodyssey/Seichijunrei-agent/actions/workflows/ci.yml?query=branch%3Amain)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-3776ab.svg)](https://www.python.org)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000.svg?logo=nextdotjs)](https://nextjs.org)
[![Cloudflare Workers](https://img.shields.io/badge/deploy-Cloudflare_Workers-f38020.svg?logo=cloudflare)](https://developers.cloudflare.com/workers/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e.svg?logo=supabase)](https://supabase.com)
[![GitHub last commit](https://img.shields.io/github/last-commit/lifeodyssey/Seichijunrei-agent)](https://github.com/lifeodyssey/Seichijunrei-agent/commits/main)
[![GitHub stars](https://img.shields.io/github/stars/lifeodyssey/Seichijunrei-agent?style=flat)](https://github.com/lifeodyssey/Seichijunrei-agent)

[**Try it live**](https://seichijunrei.zhenjia.org) | [Architecture](docs/ARCHITECTURE.md) | [Deployment](docs/ops/deployment.md)

[English](README.md) | [日本語](README.ja.md) | [中文](README.zh.md)

</div>

---

Tell the agent an anime title or a location in natural language. It finds real-world pilgrimage spots, shows them on a map, and plans a walking route — all in one conversational turn.

## How It Works

```
User text  →  PydanticAI Agent (pilgrimage_agent)
                 ├── resolve_anime  → DB-first title lookup; Bangumi.tv API on miss
                 ├── search_bangumi → parameterized SQL → Supabase points
                 ├── search_nearby  → PostGIS geo retrieval
                 ├── plan_route     → nearest-neighbor route ordering
                 └── answer_question → QA pass-through
              → AgentResult (typed output + tool call records)
```

A single PydanticAI agent handles planning and tool dispatch. Tools use `ModelRetry` guards to reject invalid parameters, and an `output_validator` rejects fabricated responses. Selected-point routes bypass the agent entirely.

`resolve_anime` is self-evolving: on first query for an unknown title it fetches metadata from Bangumi.tv, upserts it into the database, and all future queries hit the local DB.

## Features

- **Conversational search** — ask in Japanese, English, or Chinese; the agent handles intent
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

See [`backend/config/settings.py`](backend/config/settings.py) for full reference and [`.env.example`](.env.example) for defaults.

## Example Usage

**Python (direct):**
```python
from backend.agents.pilgrimage_runner import run_pilgrimage_agent
from backend.infrastructure.supabase.client import SupabaseClient

async def main() -> None:
    async with SupabaseClient(db_url) as db:
        result = await run_pilgrimage_agent("吹響ユーフォニアムの聖地", db, locale="ja")
        print(result.output)
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
from backend.clients.python.seichijunrei_client import SeichijunreiClient

client = SeichijunreiClient(api_key="sk_your_key_here")
result = client.search("Hibike Euphonium locations", locale="en")
```

## Repository Map

- `backend/` — Python runtime: agents, interfaces, infrastructure, tests, and tools
- `frontend/` — Next.js static-export frontend and UI components
- `worker/` — Cloudflare Worker entrypoint for auth and request routing
- `supabase/` — schema migrations and Supabase project assets
- `docs/` — architecture, ops runbooks, iteration artifacts, and implementation plans
- `Dockerfile`, `Makefile`, `pyproject.toml`, `wrangler.toml`, `package.json` — root runtime and tooling entrypoints that stay at the repository root

## Docs

- [Architecture](docs/ARCHITECTURE.md) — full system design reference
- [Deployment](docs/ops/deployment.md) — Cloudflare Workers + Containers deploy guide
- [Ops docs](docs/ops/README.md) — operational runbooks and environment procedures
- [Iteration artifacts](docs/iterations/README.md) — task plans, progress logs, and findings by iteration
- [Implementation plans](docs/superpowers/plans/) — implementation plans kept in place for execution history
- [Design spec](docs/superpowers/specs/) — product specification
