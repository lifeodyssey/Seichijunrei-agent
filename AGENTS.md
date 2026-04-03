# AGENTS.md

This file provides repo-wide guidance for agentic coding tools (Codex, Claude Code, Cursor, etc.).

## Source Of Truth

- Runtime entry path: `interfaces/http_service.py` → `interfaces/public_api.py` → `agents/pipeline.py`
- Shared plan + tool types: `agents/models.py`
- Frontend tokens: `frontend/app/globals.css`
- Deployment wiring (Worker + Containers + assets): `wrangler.toml` + `DEPLOYMENT.md`

Canonical docs (keep these accurate; avoid duplicating architecture narratives elsewhere):

- `README.md`
- `docs/ARCHITECTURE.md`
- `DEPLOYMENT.md`
- `CLAUDE.md`
- `frontend/AGENTS.md` (frontend-only constraints)

## Guardrails

- Orchestration stays `ReActPlannerAgent → ExecutorAgent`; do not reintroduce an IntentAgent split.
- `ExecutorAgent` must remain deterministic (no LLM calls during execution).
- Auth is enforced at the Cloudflare Worker edge (`src/worker.js`); the container trusts forwarded headers.
- Frontend is a Next.js static export (`output: "export"`); avoid server-only Next.js features.

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
make check
```

Frontend (local dev):

```bash
cd frontend
npm ci
cp .env.local.example .env.local
npm run dev
```
