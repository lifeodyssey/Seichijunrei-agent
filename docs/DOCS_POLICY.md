# Documentation Policy

## Principle

Keep one architecture story and one task board.

Code and tests are the primary source of truth. Documentation should describe
stable boundaries, current entry points, and active plans only.

## Canonical Docs

| Document | Purpose |
|----------|---------|
| `README.md` | Repo entry point and current usage |
| `AGENTS.md` | Canonical root guide — identity, monorepo layout, cross-stack guardrails, tool routing |
| `CLAUDE.md` | Claude Code pointer (`@AGENTS.md`) — same content as `AGENTS.md` |
| `apps/agent/AGENTS.md` | Python agent (PydanticAI / FastAPI) conventions |
| `workers/catalog/AGENTS.md` | Catalog Worker (Hono / oRPC / Drizzle) + data-platform conventions |
| `workers/users/AGENTS.md` | Live user-domain Worker (Hono / oRPC / Drizzle) conventions |
| `packages/agent/AGENTS.md` | Platform-independent TypeScript agent domain library conventions |
| `packages/contract/AGENTS.md` | Cross-service oRPC/Zod contract conventions |
| `apps/web/AGENTS.md` | TanStack Start rebuild conventions |
| `migrations/AGENTS.md` · `e2e/AGENTS.md` · `infra/AGENTS.md` | Atlas migrations, browser tests, and IaC conventions |
| `.claude/rules/*.md` | Path-scoped rules loaded only for matching files |
| `docs/ARCHITECTURE.md` | Live runtime reference — both agent tiers and the flag between them |
| `docs/ops/deployment.md` | Deployment runbook |
| `docs/ops/secrets.md` | What each repository secret is for, who consumes it, and rotation impact |
| `docs/iterations/README.md` | Main task tracker / session log / findings — pointer into the live iteration (no hardcoded `iterN`) |

## Docs Tree Map (W1)

Sole navigation for `docs/` — no docs-level README. Paths on the post-reorg layout (#908 W1).

| Path | Holds | Write policy |
|---|---|---|
| `docs/specs/` | Active, non-superseded design specs (ADRs live flat) | Superseded → `docs/archive/specs/` (one-way) |
| `docs/adr/` | Registered ADRs 0001–0006 (canonical) | Amend via a new ADR |
| `docs/ops/` | Live runbooks (deployment, hardening, maintenance, …) | Update in place |
| `docs/iterations/` | Active iteration artifacts + `README.md` pointer | Per-iteration dirs |
| `docs/archive/` | `specs/` · `plans/` · `reviews/` · `design-sync/` · `mockups-demo/` · `landing-hero/` · `review-boards/` | Read-only history |
| `docs/design/` | Live design guidance (tokens, mascot, prompts) | Update in place |
| `docs/api-reference/` · `docs/agents/` | External API refs · agent guides | Update in place |

## Rules

1. Do not keep legacy and current architecture docs side by side.
2. Do not add separate roadmap files when the live iteration (see `docs/iterations/README.md`) already tracks the work.
3. If a subsystem is removed from the codebase, remove its docs in the same change.
4. Prefer linking to code paths over hardcoding volatile counts.
5. Planning docs may contain process detail; README and architecture docs should not.
6. Put operational docs under `docs/ops/` and iteration artifacts under `docs/iterations/`.
7. Docs images >1MB: never commit. Upload to the private R2 bucket and link through the edge
   `/img` proxy (`workers/edge/src/proxy/image-proxy.ts` — upstreams `image.anitabi.cn` today; R2-backed
   serving is a listed edge extension). Legacy >1MB assets under `docs/archive/` are W6 strip candidates.

## Agent-docs Network

- `AGENTS.md` is canonical in each documented directory; root routes to the deeper package guide.
- Every package `AGENTS.md` has a sibling `CLAUDE.md` containing exactly `@AGENTS.md` plus newline
  (11 bytes). Never duplicate the guide into the pointer file.
- Package guides cover: identity/ownership, grounded commands, conventions, key entrypoints, and
  real pitfalls. Keep root near 200 lines and package files near 120.
- `.claude/rules/*.md` are path-scoped policy overlays, not substitutes for package guides. Their
  YAML `paths` frontmatter must match the files whose behavior they govern.

## Single Sources Of Truth

The one canonical topic→source map for this repo. Root `AGENTS.md` links here instead of keeping a
second copy — two tables drift (the exact failure the Review Check below warns against). Paths are on
the current monorepo layout; `backend/…` and `worker/worker.js` are pre-monorepo/pre-rename and gone.

| Topic | Current source of truth | Notes / was |
|---|---|---|
| **Why** the architecture is shaped this way | `docs/specs/2026-06-13-architecture-adr.md` | Foundational ADR; its "全 TS on Workers" decision was later refined by the rebuild spec below |
| **Current target** architecture (agent runtime and eval) | `docs/specs/2026-09-09-agent-on-pi-harness-spec.md` | Native Pi harness and Cloudflare Agents inside `workers/edge`, Neon business authority and native Logfire evals. The 2026-09-01 spec retains its unmodified functional-parity criteria only where not superseded. **Supersedes SD-4 of `docs/specs/2026-07-06-frontend-rebuild-spec.md`**; that spec remains canonical for the web rebuild |
| Live runtime reference (both agent tiers) | `docs/ARCHITECTURE.md` | Container tier by default (`apps/agent/…/animichi_runner.py`), edge tier behind `AGENT_TURN_ROUTE = "edge"` (`workers/edge/src/agent/`, staging today) |
| Agent entry | `apps/agent/src/animichi/interfaces/fastapi_service.py` → `public_api.py` → `agents/animichi_runner.py` | was `backend/interfaces/…` |
| Agent shared types | `apps/agent/src/animichi/agents/models.py`, `…/agent_result.py` | was `backend/agents/…` |
| Agent tools | `apps/agent/src/animichi/agents/animichi_tools.py` + `web_tools.py` | Typed `TOOLS` lists injected by `build_animichi_agent()` |
| Catalog service (TS) + data platform | `workers/catalog/src/` — `ingest/` · `enrich/` · `publish/` · `api/` · `router.ts` | realizes the ADR's ingest→enrich→publish |
| Cross-service contract (zod = SoT) | `packages/contract/src/` (`models.ts`, `contract.ts`, `errors.ts`) + `packages/contract/README.md` | error registry + parity guard live here |
| User-domain service | `workers/users/` + `workers/users/AGENTS.md` | Live Hono/oRPC service over Neon, `/v1/users/*`; no token verification of its own — it trusts the edge-forwarded identity (AUTH-2 #950) |
| Edge worker / auth / routing | `workers/edge/src/entry.ts` (+ `src/app.ts`, `src/identity/auth.ts`) | was `worker/worker.js`, then `worker/` (iter6 C2) |
| Deploy wiring | `workers/edge/wrangler.toml` + `workers/edge/src/entry.ts` + `docs/ops/deployment.md` | deployment.md = canonical runbook |
| DB — catalog/user data (data plane) | **Neon Postgres** (Drizzle raw-SQL query-only over neon-http); Atlas migrations in `migrations/neon/` | data plane; no Hyperdrive; the legacy `supabase/migrations/` tree is archived/historical (issue #1000) |
| DB — auth | **Neon Auth (Better Auth)** integrated in `apps/web`; the edge verifies Neon JWKS only (AUTH-2 #950) | `docs/ops/auth-migration-neon.md` runbook |
| Web app (the only browser surface) | `apps/web/` + `apps/web/AGENTS.md` (TanStack Start) | Legacy `frontend/` retired in #537; spec `2026-07-06-frontend-rebuild-spec.md` |
| Design tokens / system | `apps/web/` (animal-island-ui-tailwind); ref `docs/design/animal-island-ref/` | |
| Eval | `apps/agent/src/animichi/tests/eval/` (Python) | |
| Testing strategy | `docs/testing-strategy.md` | |
| Deployment ops | `docs/ops/deployment.md`, `docs/ops/cloudflare-hardening.md` | |
| Secrets architecture / worker secrets | `docs/adr/0003-secrets-architecture.md` | CF Secrets Store + Neon-hosted role passwords + Pulumi `neon.Role`; supersedes the ESC-first plan of #674 |
| CI/CD principle + identity boundary | `docs/adr/0006-platform-over-handwritten-ci.md` | platform/official action over hand-written; the §二 rejected alternatives; the three OIDC audiences (Pulumi Cloud, migrator, staging = none) |
| Local development gates | `docs/ops/local-gates.md` + `.pre-commit-config.yaml` | changed-file routing (`--staged` pre-commit / merge-base pre-push); `commitlint.config.js` as the one commit-msg/PR-title validator; the pre-push gate `scripts/local-gates/pre-push-affected.sh` (packages + three buckets + a fail-closed whitelist); CI and CD route by pnpm's `--filter "...[<ref>]"`, which pre-push cannot use (pnpm/pnpm#12626); `make check-full` is the manual everything-run; browser e2e/live-Neon/evals/deploys stay in CI |
| Review gate (merge quality enforcement) | `docs/ops/review-gate.md` | native thread resolution + required checks + the two-way comment hook; the LLM status machinery retired 2026-08-31 |
| Close-out campaign (2026-08) | `docs/specs/2026-08-08-repo-closeout-spec.md` | ADRs 0004/0005; merges restructure-spec × GOAL; waves P0–P8 |
| Repo-wide audit findings (latest) | `docs/specs/2026-09-05-repo-smell-audit.md` | Seven-report smell audit; §4 is the still-open ledger of its predecessor `docs/specs/2026-08-26-system-health-audit.md`, §7 the campaign split |
| Neon backup / RPO / bad-migration recovery | `docs/ops/neon-backup-rpo.md` | N5 (#860); PITR + HITL checklist; pairs with `migrations.md` |
| Iteration specs (live) | `docs/specs/` — 平层只放非 superseded spec(不维护名单;以 superseded 标注与 archive 位为准) | superseded spec 一律入 `docs/archive/specs/`(只进不出,iter6 A6/#640) |
| Iteration plans | 当前 iteration 的计划在 `docs/iterations/<iterN>/`;历史执行 plan 全部在 `docs/archive/plans/` | 平层不再新增 plan(iter6 A6/#640) |
| Iteration progress/handoff | `docs/iterations/<iterN>/`(progress、task_plan、handoff、status) | 根目录禁放(File Placement 规则) |

## Review Check

Before merging documentation changes:

- Is the doc still true after this patch?
- Does it duplicate another file?
- Does it describe code that no longer exists?
- Does it introduce a second architecture narrative?
