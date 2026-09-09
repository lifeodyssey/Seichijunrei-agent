# Animichi — AGENTS.md

Canonical repo guide for agentic coding tools. Claude Code reaches this via `CLAUDE.md`
(`@AGENTS.md`); the 30+ AGENTS.md-native tools read it directly. Keep it under ~200 lines —
stack-specific rules live in per-package `AGENTS.md` files and in `.claude/rules/` (below).

Animichi is an anime pilgrimage search + route-planning service. **Hybrid microservices**: a
Python PydanticAI agent (FastAPI, Cloudflare container) + TypeScript Cloudflare Workers (catalog +
users) + a TanStack web app (rebuild in progress). Data plane = Neon;
auth = **Neon Auth (Better Auth) integrated in `apps/web`** (SD-31); the edge verifies Neon Auth
JWTs only (AUTH-2 #950 hard cut — Supabase verification deleted); the users worker trusts only the
edge-forwarded identity. **Do not add Supabase-auth or self-verification code**.

## Monorepo layout

- `apps/agent/`        — Python PydanticAI agent (FastAPI container). uv. → `apps/agent/AGENTS.md`
- `workers/catalog/`   — TS Worker: anime catalog API + data platform (ingest/enrich/publish). → `workers/catalog/AGENTS.md`
- `workers/users/`     — LIVE Hono/oRPC user-data Worker over Neon; verifies nothing itself (no `jose`) — it trusts the edge-forwarded identity; 13 `test/*.worker.test.ts` files + CI lane. → `workers/users/AGENTS.md`
- `packages/agent/`    — Platform-independent TS agent domain library (`@animichi/agent`), consumed by edge. Python remains `@animichi/agent-python`. → `packages/agent/AGENTS.md`
- `packages/contract/` — Shared oRPC/zod contract; cross-service source of truth. → `packages/contract/AGENTS.md`
- `packages/eval/`     — Node eval package (W3): reads the Python-exported datasets with `logfire/evals`. → `packages/eval/AGENTS.md`
- `packages/test-postgres/` — Test-only Postgres data plane (image, readiness wait, clean DB, Atlas chain) shared by the catalog spike, the edge agent-db arm and `db-fresh-schema.sh`. → `packages/test-postgres/AGENTS.md`
- `apps/web/`          — TanStack Start SSR app; **the only browser surface** (legacy `frontend/` retired, #537). → `apps/web/AGENTS.md`
- `workers/edge/`      — CF edge worker (`workers/edge/src/entry.ts`): the gateway (auth, `/v1` routing, image/tile proxies; no page fallback — unmatched paths 404) **and**, behind `AGENT_TURN_ROUTE = "edge"`, the TS agent tier itself (`workers/edge/src/agent/`: intake → `AgentSession` DO → Neon settlement) — most of the package's source is now that tier. → `workers/edge/AGENTS.md`
- `workers/migrator/`  — TS Worker that applies the `migrations/neon` Atlas chain (bundled into the Worker) behind GitHub OIDC. → `workers/migrator/AGENTS.md`
- `migrations/neon/`    — Atlas/Neon migrations (moved from `db/migrations`); `supabase/` is an archived historical Supabase migration dir (issue #1000), not a live surface. → `migrations/AGENTS.md`
- `e2e/`               — Playwright browser suite for `apps/web`. → `e2e/AGENTS.md`
- `infra/`             — Pulumi Cloudflare IaC. → `infra/AGENTS.md`

## Package managers

- **pnpm** workspace for all TypeScript (`pnpm-workspace.yaml`). **uv** for Python (in `apps/agent/`).

## Core commands (from repo root)

- `make check`         — lint + typecheck + unit + integration; the DB arm defaults offline. **Run before AND after any change.**
- `make dev-db`        — agent-only Neon Local postgres-wire proxy on `:5432`; not for Workers.
- `make dev-local`     — database + backend + web app, one command (never start services individually). Supabase is no longer required for auth — login is Neon Auth (AUTH-2 #950).
- `make local-login`   — browser magic-link login for local dev.
- `make test` — hermetic Python unit tests. `make test-integration` uses the offline Docker arm by
  default; select live Neon with `TEST_DB=neon`, or a disposable BYO database with
  `TEST_DATABASE_URL` + `TEST_DB_ALLOW_MUTATION=1`.
- `make test-eval` — model-backed Python agent evals; no database by default.
- `make e2e-setup` then `make e2e` — Playwright E2E (details in `docs/testing-strategy.md`).
- `pnpm run test:worker` — edge worker tests. Per-package commands live in that package's `AGENTS.md`.

## Cross-stack guardrails (apply everywhere)

- **1-10-50**: functions ≤10 lines, classes ≤50, files ≤300; ≤2 indent levels (early-return / extract).
- **No `Any`** — Python: `object` + `isinstance()`; TS: no `any`. No `dict[str, object]` — model it.
- **No suppression without user approval** — no `eslint-disable` / `@ts-ignore` / `type: ignore` /
  `noqa` / `pragma: no cover` / `continue-on-error` / `skip`. Fix the code; don't silence the rule.
- **TypeScript gate** — TypeScript 7.0.2 direct + type-aware oxlint/tsgolint with
  `--deny-warnings` across every package. ESLint left the repo with `frontend/` (#537).
- **Coverage floors ratchet UP only** — `apps/agent` ≥87 (`pyproject.toml` `--cov-fail-under`); `apps/web` floors live in `apps/web/vitest.config.ts` (mirrored in `apps/web/AGENTS.md`).
- **Test quality**: mock the clock (no timing-dependent asserts); no conditional logic in tests
  (split them); ≤200 lines per test file; ≤5 mocks per test.
- **No local deploy** (`block-local-deploy`, an owner-local rule — see Harness) — CD only: a push to `main` builds the affected
  release cohort once, deploys those immutable artifacts to staging, then promotes the same
  digests after one GitHub `production` environment approval. There is no manual or tag-triggered
  deploy path. Details → `docs/ops/deployment.md`.

## Commit and PR hygiene

- Historical bloat came from merge-carried branch WIP, PR-per-repair loops, commit-on-agent-stop
  behavior, and no message/title gate. Fix that workflow; a prettier vague subject is not enough.
- A commit is an independently reviewable, reversible outcome — never an agent checkpoint, handoff,
  review reply, formatter pass, or CI retry. Do not commit merely because a sub-agent stopped.
- Keep one issue/card outcome in one PR. Fold related fixes into that PR; do not open another PR for
  its review comments or gate repairs. Before the first push, amend an unpushed commit instead of
  stacking repair commits; after a push, add fixes to the same PR and let GitHub squash-merge it.
- Commit subjects and PR titles use `<type>(<scope>): <short outcome>` (scope optional), imperative
  lowercase after the colon, preferably ≤50 characters and always ≤72. Put `Refs: #…` in the body,
  never PR numbers in the subject. Generic `wip`, `checkpoint`, `fix`, `update`, `changes`, `review`,
  and `polish` subjects are invalid.
- Types: `feat|fix|refactor|perf|test|docs|ci|build|ops|chore|revert`. Scopes:
  `agent|web|chat|catalog|users|auth|edge|contract|db|infra|delivery|eval|e2e|repo|deps`.
- Never add Claude/Anthropic/Codex/OpenAI `Co-Authored-By` trailers or a `Generated with Claude Code`
  footer. Human and Dependabot attribution remains valid.
- `commitlint.config.js` is the machine source of truth for local commit messages and squash-merge
  PR titles: the commit-msg hook (`.pre-commit-config.yaml`) and CI's `commits` job read that one
  file. It pins the type and scope tables above, `header-max-length` 72, and — inherited from
  `@commitlint/config-conventional` — body and footer lines ≤100 characters. Install all hooks with
  `pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push`; never
  bypass them with `--no-verify`. Check a drafted message by hand with `pnpm exec commitlint --edit
  <file>`, or a whole branch with `pnpm exec commitlint --from origin/main` (both need
  `pnpm install`).

## Authoritative docs (read the matching one when doing that work)

- Architecture **why** → `docs/specs/2026-06-13-architecture-adr.md`
- Current **target** for the agent runtime and eval (native Pi harness inside `workers/edge`;
  supersedes SD-4 of the rebuild spec) → `docs/specs/2026-09-09-agent-on-pi-harness-spec.md`
- Web rebuild target (still canonical for `apps/web`) → `docs/specs/2026-07-06-frontend-rebuild-spec.md`
- Live runtime **reference** (both agent tiers + the `AGENT_TURN_ROUTE` flag) → `docs/ARCHITECTURE.md`
- Deploy runbook → `docs/ops/deployment.md`
- **Single Source-of-Truth table + doc-change rules** → `docs/DOCS_POLICY.md` (the one canonical topic→path map)
- Current **campaign tracking** (merged restructure-spec × GOAL; waves P0–P8; ADRs 0003–0005) →
  `docs/specs/2026-08-08-repo-closeout-spec.md`

## Tool routing (repo-specific; global tooling lives in `~/.claude/` — do not repeat it here)

- **Skill-first** — invoke the Skill tool before acting when a request matches: bugs → `/investigate` ·
  ship/PR → `/ship` · qa → `/qa` · review → `/review` · docs → `/document-release` · retro → `/retro` ·
  design system → `/design-consultation` · visual → `/design-review` · architecture → `/plan-eng-review` ·
  quality → `/health` · brainstorm → `/office-hours`. TDD: `/backend-tdd` (Python), `/frontend-tdd` (React).
- **Codex** — delegate code-writing / deep investigation via **`codex:codex-rescue`**; review via
  `/codex:review`; images via `/codex:imagegen`. **Read `.claude/skills/use-codex/SKILL.md` first** —
  short, and skipping it costs whole dispatches. Four facts it exists for: **never run the raw CLI
  concurrently or in a loop** (403/429 is connection contention, not a rate limit — retrying burns
  quota; the owner-local `guard-codex.sh` enforces it and `block-codex-exec-codewrite` blocks raw code edits);
  **Codex cannot commit** — its sandbox refuses every write under `.git`, worktree or clone alike, so
  ask for changes left in the working tree and integrate them into the current semantic outcome;
  **its sandbox has no network**, so build the environment and verify the gates yourself first;
  and **the forwarder returns before Codex finishes**, so arm a `Monitor` keyed on the job log going
  quiet and read the report from `~/.claude/plugins/data/codex-openai-codex/state/*/jobs/*.log`
  rather than the return value. Expect sound judgement and a broken process — inspect and integrate
  its output, then re-run every gate yourself.
- **Web browsing** → `/browse` (gstack). Never `mcp__claude-in-chrome__*`.
- **CodeGraph** — `.codegraph/` is initialized; follow the **global** CodeGraph rules in `~/.claude/CLAUDE.md`
  (spawn an Explore agent for exploration; only lightweight `codegraph_*` lookups in the main session).
- **MCP servers — when to reach for each on this stack** (existence is config; this is the *when*):

  | Server | Use it for |
  |---|---|
  | `supabase-seichijunrei` | Read-only inspection of the **archived** `supabase/` history only (`list_tables`, `get_logs`, `get_advisors`, edge functions) — no mutation-capable ops (`apply_migration`) are listed any more (#1000). Auth is Neon Auth (edge, #950) and the data plane is Neon Postgres. |
  | Neon (`mcp__Neon__*`) | The **data plane** (catalog/user tables, Drizzle). Branch/query Neon. |
  | Cloudflare (`cloudflare-*`) | Workers/Wrangler docs, bindings, builds, observability for the edge/catalog. |
  | context7 | Current library docs for the exact stack (Hono, Drizzle, oRPC, AI SDK, TanStack Start, pydantic-ai). Prefer over memory. |
  | serena | LSP-backed semantic code nav/edits when codegraph isn't enough. |
  | logfire | Observability — the agent and Workers share the Logfire dashboard. |

- **Stack skills — invoke the Skill tool when the task matches** (docs fallback = context7 for any lib without a skill: Hono, oRPC, Drizzle, TanStack Start):

  These are user-scope installations on this machine, not CI dependencies. If a plugin skill is
  missing, install it with `claude plugin install <plugin>@<marketplace>` (for example
  `ai@pydantic-skills`, `logfire@pydantic-skills`, `pulumi@pulumi-agent-skills`,
  `better-auth@better-auth-agent-skills`, `cloudflare@cloudflare`); `neon`, `neon-postgres`,
  `fastapi`, `ai-sdk`, and `atlas` are single-name local/user skills here. `atlas` is a manual
  skill; see atlasgo.io/guides/ai-tools.

  | Skill | Reach for it when |
  |---|---|
  | `ai:building-pydantic-ai-agents` | Writing/altering the PydanticAI agent, tools, `ModelRetry` guards, typed output (`apps/agent`). |
  | `pydantic-ai-harness:pydantic-ai-harness` | CodeMode, ManagedPrompt, capability composition, and harness integration (`apps/agent`). |
  | `logfire:logfire-instrumentation` · `logfire:logfire-query` | Instrumentation / querying observability — the sanctioned OTel path (see F8 in `apps/agent/AGENTS.md`). |
  | `fastapi` | FastAPI service surface, routing, lifespan, dependencies (`apps/agent`). |
  | `cloudflare:workers-best-practices` · `cloudflare:wrangler` · `cloudflare:durable-objects` | Catalog/edge Worker code, `wrangler.toml`, bindings, local `wrangler dev`. |
  | `neon` / `neon-postgres` | Neon data-plane queries, branching, egress tuning. |
  | `pulumi:pulumi-best-practices` · `pulumi:pulumi-component` · `pulumi:pulumi-esc` · `pulumi:pulumi-automation-api` | IaC in `infra/` — Cloudflare R2 / routes / DNS / secrets, stacks, ESC. |
  | `better-auth:create-auth-skill` · `better-auth:better-auth-best-practices` | Auth work as we migrate onto Neon Auth (Better Auth) (`workers/users`, login). |
  | `ai-sdk` | Frontend AI SDK streaming/UI in the TanStack rebuild (`apps/web`). |
  | `atlas` | Schema migrations in `migrations/neon` — diff/lint/apply. |

## Harness (4-role agent system)

Canonical workflow: `docs/workflow.md` (Matt flow × Policy C, per-stage machine-judgeable triggers).
Role definitions live in `.claude/agents/`:
- planner — grilling → to-spec → to-tickets (blocking edges); spec dual-review (Fable + Codex GPT Sol xhigh) before owner sign-off.
- executor — **opencode CLI** via one `opencode serve` instance (model `ds-flash-max` → `luna-max`), brief-driven, never commits.
- reviewer — card-level final review: read the candidate diff vs brief before merge; **Mutation testing is the only valid green-light proof.**
- tester — Playwright Test Agents pipeline (planner/generator/healer, promotion gates) + staging validation with evidence.
**Quality Ratchet**: every AC carries a test-type (`unit`|`integration`|`eval`|`browser`|`api`) and a test in the PR diff (`ac_total == ac_with_test`); Codecov patch ≥95%. Merge requires resolved review threads + acknowledged bot findings. Two kinds of gate, not interchangeable. **Committed** (every contributor, every CI run): the `commitlint` commit-msg hook, the pre-push affected gate (`scripts/local-gates/pre-push-affected.sh`, running the same package scripts as CI's affected matrix), and the native workflow/action tests under `.github/test` plus repository configuration tests under
`test/repo-config` — CI's `commits`, `affected` and `contracts` lanes mirror those three. **Owner-local**: the hookify rules `block-secrets-in-pr`, `block-local-deploy` and `block-codex-exec-codewrite`, which live beside the tracked files in `.claude/` but are gitignored — enabled and blocking on the owner's machine, absent from a fresh clone and from CI. Never cite one of the three as proof that a repository rule is enforced.

## PR 合并前的检查(单一来源)

合并质量的**单一来源**是 `docs/ops/review-gate.md`:native `required_review_thread_resolution`(行级
线程必须 resolve 才能合成)+ `PR Verification`/`Security` 两条 required checks + 全局 hook
`~/.claude/hooks/check-pr-comments.sh`(在 `gh pr merge` 前强制两路评论纪律:线程清零 + qodo/Sonar
顶层发现逐条由人类 ack;还拒绝 bots 尚未发声的抢跑合并)。2026-08-31 起退役:Review Gate 聚合状态、
LLM trusted review 席位、verdict/marker 工件——它们把每次合并耦合到共享模型配额上,配额一空所有 PR
同时红灯且无本地出路。评审纪律(Standards∥Spec、变异红绿证明、fresh-head)保留为 `docs/workflow.md`
stage 5 的流程要求,不再是合并阻塞状态。

## File placement

Never save working files to the repo root. Doc placement + the doc-change checklist → `docs/DOCS_POLICY.md`.

## Agent skills

### Issue tracker

GitHub Issues (`lifeodyssey/animichi`) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five roles map 1:1 to label strings; plus `wayfinder:*` for decision maps. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context monorepo: root `CONTEXT-MAP.md` points at per-package `CONTEXT.md`. System ADRs in `docs/adr/`. See `docs/agents/domain.md`.

Workflow overview (Matt × Policy C): `docs/workflow.md`.
