# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## What This Repo Is

Seichijunrei is an anime pilgrimage search and route planning service.

**Implementation status:** Core runtime + Cloudflare deploy path are in place. Active work (and any remaining TODOs) lives in `task_plan.md` and `docs/superpowers/plans/`.

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
make test-eval            # model-backed evals (separate from stable CI)

# Code quality
make lint                 # ruff check + format check
make format               # ruff auto-format + fix
make typecheck            # mypy strict type check
make check                # lint + typecheck + test
```

Notes:
- pytest is configured with `--asyncio-mode=auto`
- stable test gates: `backend/tests/unit` and `backend/tests/integration`
- `backend/tests/eval` depends on external model availability — intentionally separate
- pre-commit hooks run ruff + mypy on every commit

## Architecture

### Pipeline

```
User text
    ↓
ReActPlannerAgent   →  LLM structured output  →  ExecutionPlan
    ↓
ExecutorAgent       →  deterministic tool dispatch  →  PipelineResult
```

No IntentAgent. Intent reasoning is part of the planner's LLM pass.

### Agents

- `backend/agents/models.py` — Shared types: `ToolName`, `PlanStep`, `ExecutionPlan`, `RetrievalRequest`
- `backend/agents/planner_agent.py` — `ReActPlannerAgent`: Pydantic AI agent, `output_type=ExecutionPlan`, `retries=2`
- `backend/agents/executor_agent.py` — Deterministic dispatch for 7 tools; static message templates; no LLM calls
- `backend/agents/retriever.py` — `sql`, `geo`, `hybrid` strategies; write-through on DB miss
- `backend/agents/sql_agent.py` — Structured SQL retrieval; accepts `RetrievalRequest`
- `backend/agents/pipeline.py` — Two lines: `create_plan(text, locale)` → `execute(plan)`

### Tools (ExecutorAgent dispatches these)

| Tool | Handler | Description |
|---|---|---|
| `resolve_anime` | `_execute_resolve_anime` | DB-first title→bangumi_id; API fallback; write-through |
| `search_bangumi` | `_execute_search_bangumi` | Retriever → points by bangumi_id |
| `search_nearby` | `_execute_search_nearby` | Geo retrieval by location + radius |
| `plan_route` | `_execute_plan_route` | Nearest-neighbor route ordering |
| `plan_selected` | `_execute_plan_selected` | Route user-selected point IDs |
| `greet_user` | `_execute_greet_user` | Ephemeral greeting/identity response |
| `answer_question` | `_execute_answer_question` | QA pass-through |

### Self-Evolve via `resolve_anime`

For any anime query the planner emits `resolve_anime` as the first step.
`resolve_anime(title)` → fuzzy-match Supabase `bangumi` table → on miss: query Bangumi.tv API → upsert row → return `bangumi_id`.
DB is source of truth. No hardcoded anime list in code.

### Interfaces

- `backend/interfaces/public_api.py` — Stable facade over `run_pipeline`; session persistence; route history; `ui` field in response; request logging
- `backend/interfaces/http_service.py` — aiohttp service: `/healthz`, `/v1/runtime`, `/v1/feedback`

### Infrastructure

- `backend/infrastructure/supabase/client.py` — asyncpg; tables: `bangumi`, `points`, `feedback`, `request_log`, `api_keys`
- `supabase/migrations/` — DDL migrations (apply in order before each deploy)
- `backend/infrastructure/session/` — in-memory session backend
- `backend/infrastructure/observability/` — OpenTelemetry setup
- `backend/infrastructure/gateways/` — Bangumi.tv (+ `search_by_title`), Anitabi

### Auth

Auth is enforced in the Cloudflare Worker (`worker/worker.js`) before reaching the container.

- Human users: `Authorization: Bearer <supabase_jwt>` (magic-link session)
- Agent/CLI users: `Authorization: Bearer sk_<hex>` (API key — stored as SHA-256 hash in `api_keys` table)
- `/healthz` and static frontend assets: no auth required
- Container trusts `X-User-Id` and `X-User-Type` headers set by the Worker

### Frontend

Three-column layout (light theme — 京吹夏季 palette, KyoAni-inspired):

```
┌─────────┬──────────────────┬──────────────────────┐
│ Sidebar │ Chat Panel 360px │ Result Panel flex-1  │
│ 240px   │ text-only        │ GenerativeUIRenderer │
│ History │ + ◈ anchors      │ (empty: map bg)      │
└─────────┴──────────────────┴──────────────────────┘
```

Key components:
- `frontend/components/layout/AppShell.tsx` — three-column, `activeMessageId` state
- `frontend/components/layout/ResultPanel.tsx` — renders active result via `GenerativeUIRenderer`
- `frontend/components/generative/registry.ts` — `COMPONENT_REGISTRY: Record<string, ComponentRenderer>`
- `frontend/components/generative/GenerativeUIRenderer.tsx` — registry lookup; replaces `IntentRenderer`
- `frontend/components/chat/MessageBubble.tsx` — bot messages: text + `◈` anchor card only
- Mobile: `ResultDrawer` (vaul bottom sheet) activated by `◈` anchor tap

Design tokens (`frontend/app/globals.css`):
- `--color-bg: oklch(98% 0.008 218)` · `--color-primary: oklch(60% 0.148 240)` · `--app-font-display: "Shippori Mincho B1"`
- Light theme — no dark mode toggle, no `@media (prefers-color-scheme)` conditional

### Eval Infrastructure

- `backend/tests/eval/datasets/plan_quality_v1.json` — 50+ cases × 3 locales
- `backend/tests/eval/test_plan_quality.py` — pydantic_evals harness; Iter 3 gate: ≥ baseline + 10pp
- `backend/tools/eval_scorer.py` — batch LLM judge; writes `plan_quality_score` to `request_log`
- `backend/tools/eval_feedback_miner.py` — mines `feedback(rating='bad')` → prompt-improvement suggestions
- `backend/clients/python/seichijunrei_client.py` — sync/async Python client for agent/CLI use

## Typing Rules

- **No `Any`** in source files — zero explicit `Any` across the codebase
- Use `object` at trust boundaries (JSON parsing, external API responses), then narrow with `isinstance()`
- Use `Protocol` types for duck-typing OTel and similar optional dependencies
- Use `cast()` at library boundaries where the real type is known but stubs are imprecise
- Pydantic `BaseModel` subclasses trigger false-positive `explicit-any` from metaclass stubs — suppressed via mypy overrides in `pyproject.toml`

## Deployment

- Container: Python aiohttp service via `Dockerfile` → uploaded to Cloudflare during `wrangler deploy`
- Frontend: Next.js static export (`output: 'export'`) → `frontend/out/` → CF ASSETS binding
- Worker: `worker/worker.js` — routes `/v1/*` to container, static to ASSETS, enforces auth
- Deploy: GitHub Actions `deploy.yml` (or local `npx wrangler@4 deploy`)
- DB migrations: apply `supabase/migrations/` in order before each deploy (see `DEPLOYMENT.md`)

## gstack

Use `/browse` from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /design-shotgun, /design-html, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse, /connect-chrome, /qa, /qa-only, /design-review, /setup-browser-cookies, /setup-deploy, /retro, /investigate, /document-release, /codex, /cso, /autoplan, /plan-devex-review, /devex-review, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn.

If gstack skills aren't working, run `cd ~/.claude/skills/gstack && ./setup` to rebuild.

## Working Expectations

- Prefer updating the current runtime; do not reintroduce alternate stacks
- Keep retrieval deterministic unless a task explicitly changes that rule
- ExecutorAgent must not make LLM calls — use static `_MESSAGES` templates
- Adding a new UI component = register in `frontend/components/generative/registry.ts` only
- Run `make check` before and after any change

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health
