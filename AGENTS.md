# AGENTS.md

This file provides repo-wide guidance for agentic coding tools such as Codex, Claude Code, and Cursor.

Last updated: 2026-04-15

## Source Of Truth

- Runtime entry path: `backend/interfaces/fastapi_service.py` → `backend/interfaces/public_api.py` → `backend/agents/pipeline.py`
- Shared plan + tool types: `backend/agents/models.py`
- Frontend tokens: `frontend/app/globals.css`
- Deployment wiring (Worker + Containers + assets): `wrangler.toml` + `docs/ops/deployment.md`

Canonical docs (keep these accurate; avoid duplicating architecture narratives elsewhere):

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ops/deployment.md`
- `CLAUDE.md`
- `frontend/AGENTS.md` (frontend-only constraints)

## Guardrails

- Orchestration stays `ReActPlannerAgent → ExecutorAgent`; do not reintroduce an IntentAgent split.
- `ExecutorAgent` must remain deterministic (no LLM calls during execution). If a request would violate this constraint, explain why and ask the user to re-scope.
- Auth is enforced at the Cloudflare Worker edge (`worker/worker.js`); the container trusts forwarded headers.
- Frontend is a Next.js static export (`output: "export"`); avoid server-only Next.js features.
- **No `Any`** in Python source — use `object` + `isinstance()` narrowing at trust boundaries.
- Pre-commit hooks enforce ruff lint/format + mypy on every commit.

## Commands

```bash
# Setup
make dev

# Run backend locally
make serve

# Tests + checks
make test
make test-integration
make test-all
make check              # lint + typecheck + test

# Code quality
make lint               # ruff check + format check
make format             # ruff auto-format + fix
make typecheck          # mypy strict type check
```

Frontend (local dev):

```bash
cd frontend
npm ci
cp .env.local.example .env.local
npm run dev
```

## Directory Structure

```
backend/              # Python runtime
  agents/             # AI agents (planner, executor, retriever)
  application/        # Use cases + ports
  clients/            # HTTP clients (anitabi, bangumi)
  config/             # Settings
  domain/             # Entities, value objects, LLM schemas
  infrastructure/     # External adapters (DB, observability, gateways)
  interfaces/         # API surface (http_service, public_api)
  services/           # Cross-cutting (cache, retry)
  utils/              # Logger
  tests/              # unit, integration, eval
frontend/             # Next.js static export
supabase/migrations/  # DDL (Data Definition Language) migrations (timestamp-ordered)
worker/worker.js         # Cloudflare Worker (auth + routing)
```
