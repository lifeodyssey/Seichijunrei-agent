# CLAUDE.md

This file provides guidance to Claude Code and other agentic tools working in this repository.

## What This Repo Is

Seichijunrei is an anime pilgrimage search and route planning service.

Implementation status: Core runtime + Cloudflare deploy path in place. ReAct agent v2 deployed.

## Source Of Truth

- Runtime entry: `backend/interfaces/fastapi_service.py` → `public_api.py` → `agents/pipeline.py`
- Shared types: `backend/agents/models.py`
- Frontend tokens: `frontend/app/globals.css`
- Deploy wiring: `wrangler.toml` + `worker/worker.js`
- Frontend conventions: `frontend/AGENTS.md`
- Detailed architecture: `docs/ARCHITECTURE.md`
- Deployment ops: `docs/ops/deployment.md`
- Testing strategy: `docs/testing-strategy.md`

## Directory Structure

```
backend/              # Python runtime
  agents/             # AI agents (planner, executor, retriever)
  domain/             # Entities, value objects, LLM schemas
  infrastructure/     # External adapters (DB, observability, gateways)
  interfaces/         # API surface (fastapi_service, public_api)
  tests/              # unit, integration, eval
frontend/             # Next.js static export
supabase/migrations/  # DDL migrations (timestamp-ordered)
worker/worker.js      # Cloudflare Worker (auth + routing)
```

## Commands

```bash
make dev              # setup
make serve            # backend :8080 + frontend :3000
make test             # unit tests
make test-integration # integration tests
make test-all         # unit + integration
make test-eval        # model-backed evals (separate)
make lint             # ruff check + format check
make format           # ruff auto-format + fix
make typecheck        # mypy strict
make check            # lint + typecheck + test
```

Frontend: `cd frontend && npm ci && npm run dev`

Notes:
- pytest: `--asyncio-mode=auto`
- pre-commit hooks: ruff + mypy on every commit

## Architecture

```
User text → ReActPlannerAgent (LLM → ExecutionPlan) → ExecutorAgent (deterministic → PipelineResult)
```

No IntentAgent. See `docs/ARCHITECTURE.md` for full details.

### Tools (ExecutorAgent dispatches)

| Tool | Description |
|---|---|
| `resolve_anime` | DB-first title→bangumi_id; API fallback; write-through |
| `search_bangumi` | Retriever → points by bangumi_id |
| `search_nearby` | Geo retrieval by location + radius |
| `plan_route` | Nearest-neighbor route ordering |
| `plan_selected` | Route user-selected point IDs |
| `greet_user` | Ephemeral greeting/identity response |
| `answer_question` | QA pass-through |
| `clarify` | Disambiguation when query is ambiguous |

## Guardrails

- Orchestration: `ReActPlannerAgent → ExecutorAgent` only; no IntentAgent split
- ExecutorAgent: deterministic, no LLM calls — use static `_MESSAGES` templates
- Auth: enforced at Cloudflare Worker edge; container trusts forwarded headers
- Frontend: Next.js static export (`output: "export"`); no server-only features
- No `Any` in Python — use `object` + `isinstance()` at trust boundaries
- New UI component = register in `frontend/components/generative/registry.ts` only
- Run `make check` before and after any change
- **No suppression without user approval.** Never add `eslint-disable`, `@ts-ignore`, `type: ignore`, `noqa`, `pragma: no cover`, `continue-on-error`, `skip`, or any other linting/type-checking suppression without explicit user confirmation. If a rule fires, fix the code instead.
- **Coverage thresholds may only be ratcheted UP, never lowered.** Current floors:
  - Frontend (vitest.config.ts): lines≥71%, statements≥68%, functions≥61%, branches≥58%
  - Backend (pytest.ini): ≥80%
  - When adding code that increases coverage, update the thresholds to the new floor

## Deployment

**Tag-based deploy:** push to main triggers CI (lint + test) but NOT deploy.
Deploy is triggered only by pushing a version tag.

```bash
git tag v1.x.x && git push origin v1.x.x  # triggers deploy
```

Flow: CI green → Tester validates on main → Tester tags → CI deploys to production.

- Container: FastAPI via Dockerfile → Cloudflare container
- Frontend: static export → `frontend/out/` → CF ASSETS binding
- Worker: routes `/v1/*` to container, static to ASSETS
- DB migrations: applied during deploy step

## Test Environment

Local testing uses `supabase start` (full Supabase via Docker: Postgres + PostGIS + GoTrue + PostgREST):

```bash
supabase start                    # starts all Supabase services locally
# Outputs: API URL (localhost:54321), anon key, service_role key, DB URL (localhost:54322)
# Migrations from supabase/migrations/ are applied automatically

# Backend — connect to local Supabase:
export SUPABASE_URL=http://localhost:54321
export SUPABASE_DB_URL=postgresql://postgres:postgres@localhost:54322/postgres
make serve

# Frontend — set local Supabase in .env.local:
# NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
cd frontend && npm run dev

supabase stop                     # cleanup
```

## Code Quality Standards

### 1-10-50 Rule
- Functions: max 10 lines. Classes: max 50 lines. Files: max 300 lines.
- Indentation: max 2 levels. Flatten with early return or extract.

### Type Safety
- No `dict[str, object]` — use dataclass or Pydantic model
- No `assert` for runtime validation — use `if not x: raise ValueError(...)`
- No bare `str` for IDs/statuses — use NewType, Literal, or Enum
- No `Any` — use `object` + `isinstance()` narrowing; Protocol for duck-typing, `cast()` at library boundaries (details: @docs/typing-rules.md)

### Design Tokens
- See `frontend/AGENTS.md` for full token list and component conventions
- No `bg-white` → `bg-[var(--color-bg)]`; no `bg-gray-*` → `bg-[var(--color-muted)]`
- No hardcoded Tailwind palette colors — use CSS variables from globals.css

### Test Quality
- No timing-dependent assertions — mock the clock
- No conditional logic in tests — split into separate tests
- Max 200 lines per test file. Max 5 mocks per test.

### TDD
- Backend: invoke `/backend-tdd` before writing Python code
- Frontend: invoke `/frontend-tdd` before writing React/TypeScript code

## Harness Engineering System

4-role agent harness. Definitions in `.claude/agents/`. Orchestration via `/iteration-planning` and `/iteration-execution`.

### Roles

| Role | Can do | Cannot do |
|---|---|---|
| Planner | Read code, write specs | Write code, create PRs |
| Executor | Write code + tests in worktree, create PR | Merge PRs, modify outside scope |
| Reviewer | Read diffs, run evals, approve/reject | Write code, merge PRs |
| Tester | Test running app, write E2E/API tests, tag for deploy | Read source code, edit production code |

### Workflow

```
Planner → spec (docs/superpowers/specs/)
  ↓
Coordinator → cards + wave graph (docs/superpowers/plans/)
  ↓
Per wave (parallel within wave, sequential across waves):
  Executor (worktree) → PR
  Reviewer → approve/request_changes
  Merge → rebase remaining PRs → next wave
  ↓
After all waves:
  Coordinator → pull main → supabase start → make serve → npm run dev → wait healthz
  Tester → test all ACs against running app (localhost:8080 + localhost:3000)
  All pass → Tester: git tag vX.Y.Z → push → CI deploys
  Coordinator → supabase stop → kill serve
```

### Agent Dispatch

- Executor: `subagent_type="executor"`, `model="sonnet"`, `isolation="worktree"`
- Reviewer: `subagent_type="reviewer"` (Read/Grep/Bash, no Write/Edit)
- Tester: `subagent_type="tester"` (Bash/Read/Write/Skill/WebFetch)
- In worktrees: `uv tool run ruff format` (not `uv run ruff format`)
- Reviewer: Codecov patch >= 95% (P1 if below, unless doc-only)

### Quality Ratchet

Every AC: test type annotation (unit|integration|eval|browser|api) + test in PR diff.
Reviewer verifies: `ac_total == ac_with_test`.

### Hook

`.claude/hookify.block-secrets-in-pr.local.md` — blocks gh pr comment/review containing secrets.

## File Placement

- Runtime: repo root or `backend/interfaces/`
- Docs: `docs/ops/` (ops), `docs/superpowers/plans/` (cards), `docs/superpowers/specs/` (specs)
- NEVER save working files to root folder

## gstack

Use `/browse` for all web browsing. Never use `mcp__claude-in-chrome__*` tools.
If broken: `cd ~/.claude/skills/gstack && ./setup`

## Skill Routing

IMPORTANT: When request matches a skill, invoke via Skill tool FIRST.

- Bugs, errors → /investigate
- Ship, deploy, PR → /ship
- QA, test → /qa
- Code review → /review
- Docs after ship → /document-release
- Retro → /retro
- Design system → /design-consultation
- Visual audit → /design-review
- Architecture → /plan-eng-review
- Code quality → /health
- Brainstorming → /office-hours
