# Documentation Policy

## Principle

Keep one architecture story and one task board.

Code and tests are the primary source of truth. Documentation should describe
stable boundaries, current entry points, and active plans only.

## Canonical Docs

| Document | Purpose |
|----------|---------|
| `README.md` | Repo entry point and current usage |
| `AGENTS.md` | Repo-wide guardrails for agentic coding tools |
| `CLAUDE.md` | Agent guide for this repo (architecture + constraints) |
| `docs/ARCHITECTURE.md` | Current v2 runtime architecture |
| `DEPLOYMENT.md` | Intended deployment shape for v2 |
| `task_plan.md` | Main task tracker |
| `progress.md` | Session log |
| `findings.md` | Current design findings and rationale |
| `frontend/AGENTS.md` | Frontend-specific agent rules (Next.js static export) |

## Rules

1. Do not keep legacy and current architecture docs side by side.
2. Do not add separate roadmap files when `task_plan.md` already tracks the work.
3. If a subsystem is removed from the codebase, remove its docs in the same change.
4. Prefer linking to code paths over hardcoding volatile counts.
5. Planning docs may contain process detail; README and architecture docs should not.

## Single Sources Of Truth

| Topic | Source |
|-------|--------|
| Runtime entry path | `agents/pipeline.py` |
| Shared types (Plan, Step, RetrievalRequest) | `agents/models.py` |
| Planner behavior | `agents/planner_agent.py` |
| Execution behavior | `agents/executor_agent.py` |
| SQL retrieval | `agents/sql_agent.py` |
| Configuration | `config/settings.py` |
| Auth middleware | `src/worker.js` |
| DB schema | `supabase/migrations/` |
| Frontend component registry | `frontend/components/generative/registry.ts` |
| Design tokens | `frontend/app/globals.css` |

## Review Check

Before merging documentation changes:

- Is the doc still true after this patch?
- Does it duplicate another file?
- Does it describe code that no longer exists?
- Does it introduce a second architecture narrative?
