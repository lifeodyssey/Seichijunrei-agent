# apps/agent — AGENTS.md

The pnpm workspace identity is `@animichi/agent-python`. TypeScript domain functions live in
`packages/agent` (`@animichi/agent`); this Python runtime remains at this path until W4 retirement.

Python PydanticAI agent, FastAPI, deployed as a Cloudflare container. **Read-only consumer of the
catalog** — it never calls external anime APIs in the request path and never writes catalog data
(the catalog Worker owns ingestion). Root guide: `../../AGENTS.md`.

## Commands (run from repo root; the make targets `cd apps/agent`)

- `make test` (pytest `--asyncio-mode=auto`) · `make test-integration` · `make typecheck` (mypy strict) ·
  `make lint` (ruff). Pre-commit runs ruff + mypy on every commit.
- `make test-eval` — official model-backed runner plus translation eval. The pytest eval entry is a
  transition alias sharing the same report/gate path, not the primary interface.
- `package.json` carries the lane scripts every workspace package now exposes (#1358):
  `pnpm --filter @animichi/agent-python lint` / `typecheck` shell straight to the root `make lint` /
  `make typecheck`, so those targets stay the one definition of the Python gate set, and `test` /
  `test:integration` stay the `uv run pytest` entries. The pnpm lanes never add a second
  definition — change the Makefile, not the manifest.
- Directly: `cd apps/agent && uv run pytest src/animichi/tests/unit/`. Seed data: `src/animichi/tests/fixtures/seed.sql`.
- The zod wire-contract tests (`src/animichi/tests/unit/test_chat_wire_contract.py`, 12 parametrized cases) spawn
  `node --import tsx chat-wire-parser.ts`; they need the workspace TS toolchain, so run `pnpm install`
  once (tsx is a declared devDependency of this package). CI's `agent` job installs the workspace
  before it runs `make check`.
- In a worktree, format with `uv tool run ruff format` (not `uv run …`).

## Runtime call-path

User text → `RuntimeAPI.handle()` → `run_animichi_agent()` → `animichi_agent.run()` → tools →
`AgentResult` → `agent_result_to_response()` → `PublicAPIResponse`. Point and candidate selections
bypass the model through `execute_selected_route()`, `execute_multi_selection()`, or
`execute_place_selection()`.

- Entry: `src/animichi/interfaces/fastapi_service.py` → `public_api.py` → `src/animichi/agents/animichi_runner.py`.
- Agent constructor: `build_animichi_agent()`; PydanticAI name: `animichi`.
- Shared types: `src/animichi/agents/models.py`, `src/animichi/agents/agent_result.py`.

## PydanticAI 2.9.1 composition

- Tools are constructor-injected from typed `TOOLS` lists in `animichi_tools.py` / `web_tools.py`.
  Registration no longer depends on import order.
- The `on.run_error` hook records telemetry and re-raises. Session/locale state is serialized by
  `trusted_session_context()` instead of the pre-redesign `before_model_request` hook.
- `web_search` + `translate_anime_title` are regular constructor-injected tools; the pre-redesign
  keyword `ToolSearch` deferral and `ANIMICHI_MODERN_COMPOSITION` rollback switch are retired.
- The ManagedPrompt remote extension point has been removed. Production instructions always use
  the checked-in local `_INSTRUCTIONS` plus current-turn language and datetime context.

## Tools and outputs

Four catalog data tools live in `src/animichi/agents/animichi_tools.py`; two web-facing tools live in
`src/animichi/agents/web_tools.py`. Catalog tools return discriminated outcomes and record current-turn
provenance. They never ingest data or call anime APIs directly.

| Tool | Description |
|---|---|
| `resolve_anime` | Resolve a title through the catalog Worker into a typed match/clarify outcome |
| `search_bangumi` | Fetch published points for an explicit `bangumi_id` |
| `search_nearby` | Resolve a place and fetch published nearby points through the catalog Worker |
| `plan_route` | Ask the catalog Worker to route one explicit search-result reference |
| `web_search` | Attributed web research for QA and title enrichment only |
| `translate_anime_title` | Resolve or translate an anime title without adding pilgrimage data |

The model emits exactly one of five typed outputs: `ClarifyResponseModel`, `SearchResponseModel`,
`RouteResponseModel`, `GreetingResponseModel`, or `QAResponseModel`. The runner alone may produce
`PartialResponseModel` and `BlockedResponseModel`; neither is part of the model `output_type`.

## Trust boundary

- Single PydanticAI agent (`animichi_agent`) with five typed model outputs; deterministic selection
  paths bypass it.
- Pydantic tool schemas constrain model arguments; `output_validator` rejects fabricated output or
  provenance that was not produced by the current turn.
- The container trusts auth headers forwarded by the edge worker (`workers/edge/`); it does not re-authenticate.
- Injection defense (SD-19): tool/envelope text is **untrusted** — never show an upstream `message` to
  users, embed it in prompts, or store it on `str()`. User-facing text comes from `src/animichi/agents/error_messages.py`.

## Type safety

See `.claude/rules/python-types.md` (auto-loads for `*.py` here) + `docs/typing-rules.md`.

## Catalog client (hand-mirrored contract — do NOT codegen)

`src/animichi/clients/catalog_client.py` mirrors `packages/contract` by hand with sentinel defaults
(`episode=-1`, `name_cn=""`, `distance_m=-1.0`). Error mirror: `src/animichi/clients/catalog_errors.py`;
user messages: `src/animichi/agents/error_messages.py`. Adding an error code → follow the checklist in
`packages/contract/README.md` (all three mirrors).

## External APIs (the agent reads the catalog; ingestion is the catalog Worker's job)

Anitabi (`api.anitabi.cn`) + Bangumi (`api.bgm.tv`) share Bangumi.tv subject IDs as our primary keys
(`eps=1` → movie, `eps>1` → TV). Full reference: `docs/api-reference/`.

## HTTP + observability conventions (F7/F8)

- **httpx only** — aiohttp is retired (F7). **One shared `httpx.AsyncClient` per client**, created
  lazily and closed via the FastAPI lifespan `aclose()` (`src/animichi/interfaces/fastapi_service.py`) — never per-request.
  Leave `trust_env` at httpx's default (`True`) for this **shared lifespan client** so proxy/CA env
  vars are respected. **This does not apply to BYOK/egress-guarded clients** (#284 Task 1/T13):
  those must be built via `egress_transport.build_guarded_async_client`, which sets
  `trust_env=False` and no `mounts`/proxy on purpose — a proxy env var would silently defeat the
  connect-time IP pinning that closes the DNS-rebinding/TOCTOU window (T4) and the redirect-bypass
  window (T5). **T12 note:** the guarded factory is the *only* sanctioned way to build an
  outbound HTTP client for a user-influenceable destination (BYOK `base_url`, and any future
  user-controlled egress) — any new outbound call site that constructs its own `httpx.AsyncClient`
  instead of going through the factory recreates the SSRF/T13 bypass this convention exists to
  close. See `docs/ops/cloudflare-hardening.md` §6 — `RuntimeContainer.deniedHosts` covers T12 at
  the Worker's URL-hostname layer for plain-HTTP requests naming a denied IP/hostname literal
  directly (not DNS rebinding, and not HTTPS); this code-review convention is the enforcement
  point for everything that layer does not reach — HTTPS to a private/link-local/CGNAT address,
  and any hostname that only *resolves* to one.
- **Status-based retry** — classify by **status code, never by URL/substring**: 5xx, transport errors,
  and transient 4xx (408/429) retry with backoff; other 4xx raise immediately (`src/animichi/clients/catalog_client.py`).
- **Observability = logfire only** (F8). Never hand-roll OpenTelemetry or add `opentelemetry-api|sdk`
  directly (logfire pins its own). Go through `src/animichi/infrastructure/observability/runtime.py`
  (`runtime_span` / `http_span`, `record_*`); `setup_logfire` calls
  `logfire.configure(send_to_logfire="if-token-present")`, which no-ops without `LOGFIRE_TOKEN`.
  Test spans via `logfire.testing.capfire`.
- **structlog is configured once per process** — `animichi.utils.logger.configure_structlog()` runs
  from every process start: the FastAPI app factory, the test conftest, the `run_agent_eval` CLI,
  and the CodeMode rematch spike. Any new entry point owes the same call. It ends
  the chain with `format_exc_info` + `JSONRenderer`, so `exc_info=` is safe to pass. Never leave
  structlog unconfigured: its default `ConsoleRenderer` hands every frame to rich, which re-reads
  and syntax-highlights that frame's source and pretty-prints its locals — 91 s and 28 MB of output
  for one pydantic-ai agent-run error (#1502).
- **Persistence = SQLModel/SQLAlchemy repositories** (#994/#995) — `infrastructure/persistence/`
  (models + repositories) is the only persistence path, expressed via typed SQLAlchemy expressions
  (raw-SQL policy, #999). asyncpg is the underlying driver (with `asyncpg-stubs`); repositories open
  one short-lived `AsyncSession` from an injected factory and never touch untyped pool/record access.

## Test environment reality

- Unit tests are hermetic: the autouse fixture sets `pydantic_ai.models.ALLOW_MODEL_REQUESTS=False`
  and installs test models/keys. `.env` is not needed for `make test`; it is needed for live evals.
- `MIMO_API_KEY` is selected by `_model_api_key()` in `src/animichi/agents/base.py` only for
  `xiaomimimo.com` model endpoints; do not reuse a generic key by accident.
- Official eval entry: `src/animichi/tests/eval/run_agent_eval.py`. It streams one status line per case,
  persists reports, creates/enforces statistical baselines, and exits nonzero on gate regression or
  all-error runs. Never refresh a baseline merely to pass a gate.
- DB-backed pytest suites select one arm in this order: `TEST_DATABASE_URL` (BYO), explicit
  `TEST_DB=docker|neon`, then the offline Docker default. The offline arm needs Docker/Colima, the
  cached `animichi-test-postgres` image, and Atlas 0.30.0; `TEST_DB=neon` additionally needs a
  personal `NEON_API_KEY` + `NEON_PROJECT_ID` and is a local-only path since #1053 (CI's DB-backed
  integration lane runs `TEST_DB=docker`). BYO mutation requires `TEST_DB_ALLOW_MUTATION=1` and
  rejects protected Neon lineage. The standalone full-stack eval runner accepts `TEST_DATABASE_URL`
  only.
- The local backend Postgres is Neon Local (`make dev-db`); `supabase start` is no longer needed
  for auth or the integration-test database (auth is Neon Auth, AUTH-2 #950). Unit tests need
  neither Docker nor network.

## Eval: cost, run recipe, and the post-redesign baseline (2026-07-17)

**Model + cost.** The eval model is MiMo `mimo-v2.5` (`openai:mimo-v2.5@https://api.xiaomimimo.com/v1`,
credential `MIMO_API_KEY`; thinking param OFF — pinned in `src/animichi/config/model_aliases.py`).
MiMo pay-as-you-go (permanent rate since 2026-05-27): **$1 / M input, $3 / M output, $0.20 / M cached input**.

Measured full run (655 cases, trajectory tier, ~21 min): **6.40 M input + 0.31 M output tokens, 2,341 requests**
→ **≈ $3–7 per full run** ($7.3 worst-case with zero cache credit; ~$3 at the observed ~85–90 % cache-hit rate).
A 50-case subset ≈ **$0.3–0.6**. Pre-redesign the same run cost ~8–10× (request thrash: 27–50 requests/case).
Run it freely at milestones; don't hoard it.

**Run recipe.**
```bash
cd apps/agent && uv run python -m animichi.tests.eval.run_agent_eval \
  --eval-model "openai:mimo-v2.5@https://opencode.ai/zen/go/v1"   # full suite
EVAL_MAX_CASES=50 uv run python -m animichi.tests.eval.run_agent_eval ...  # capped = report-only, no baseline/gate
```
Direct thrash gates (req≤12 / tool≤10 / repeat=0 / p95≤8 — `src/animichi/tests/eval/direct_gates.py`) are
**report-only** until `DIRECT_GATE_ENFORCE=1` (owner calibrates first). Capped runs never read/write baselines.

**A starved run is refused before it is scored (#1496), and never becomes the baseline (#1499).**
`error_boundary` answers an unclassified agent-loop failure with a clean `ErrorResponseModel`, so
those cases are *evaluated*, not failed, and `error_rate_gate` never sees them.
`src/animichi/tests/eval/provider_outage.py` gates on their share and raises `ProviderOutage` naming
the model. Two ceilings, picked by run mode: a capped PR-lane run keeps `CAPPED_LANE_CEILING` (0.20,
`smoke_errors.TRANSPORT_RATE_CEILING`'s) because it reads and writes no baseline; the uncapped run
gets `BASELINE_LANE_CEILING` (0.02), since at 0.20 a 662-case nightly admits 132 starved cases into
the record every later run is judged against. Under that ceiling, two more guards:
`src/animichi/tests/eval/baseline_mint.py` refuses to write a baseline from a run with ANY starved
case, and `src/animichi/tests/eval/metric_gate.py` FAILS a metric whose pairs starvation emptied
instead of logging the small-sample skip. `run_metric_names.py` derives the run's columns from what
the report actually scored, so a column no case could compute is dropped rather than reported as
`Missing metric(s)`.

**CI tiering (SD-30, #228/#227).** `EVAL_SMOKE=1` makes a capped run enforce its own
zero-error/direct-thrash assertions, without reading or writing the baseline. It has no CI lane:
pull requests stopped running a model-backed eval when the affected-matrix rewrite landed, so
provider transport cannot make `PR Verification` nondeterministic. The uncapped L1 suite — owning the statistical baseline
via `finish_cli_report`/`gate.py` — runs nightly + on `workflow_dispatch` only, in the standalone
`agent-eval-nightly.yml` (never on PRs, so its cron cadence doesn't ride along with the PR/push
affected-component matrix in `pr-verification.yml`).

**Post-redesign full-655 numbers (2026-07-17, the re-baseline candidate — NOT yet the committed baseline;
the owner signs off per the redesign spec §7):**

| Metric | Full 655 pre-switch calibration |
|---|---|
| request p95 / case | **7** |
| argument_correctness | 0.641 |
| tool_correctness | 0.522 |
| trajectory_match | 0.694 |
| max_tool_calls | 0.769 |
| data_keys_present | 0.769 |
| locale_match | 0.739 |
| nonempty_results | 0.769 * |
| step_efficiency | 0.802 |

\* the nonempty evaluator was rewritten in the re-baseline (reads the produced route's `source_ref`) —
not apples-to-apples with the old contract; 15/655 errored cases (~2.3 %) also drag it. The table is
calibration-only: the official-first switch changes metric semantics and requires a fresh uncapped
baseline. Per-case results land in `src/animichi/tests/eval/results/`.

**Module layout, and the file cap that keeps it (#1493).** `src/animichi/tests/eval/` is one flat
package, and every `.py` in it is held to the 1-10-50 file cap by
`src/animichi/tests/unit/test_eval_file_line_cap.py` — a 301-line module there turns it red. Seven
modules were split by ownership to get under it, so reach for the right neighbour:

| Concept | Module |
|---|---|
| dataset file → `Case`, and a case's replayed message history | `agent_eval_cases.py` |
| the three routes one case takes (two bypasses, the agent) | `agent_eval_task.py` |
| the run itself: case selection, evaluators, tracing, `evaluate_target` | `eval_harness.py` |
| behavior-family strata read off a dataset | `case_strata.py` |
| the bootstrap / Clopper-Pearson arithmetic | `stats.py` |
| the results-file schema | `results_payload.py` |
| a finished report read into those rows | `report_case_rows.py` |
| the execution tier, the case cap, writing the results file | `exec_tiers.py` |
| a report's trajectories, classified errors, expectations | `report_gate_evidence.py` |
| gate policy: capped / smoke / uncapped, and the baseline | `eval_gate_flow.py` |
| the deterministic project evaluators | `evaluators.py` |
| the L3 outcome judges (`EVAL_L3=1`) | `l3_judges.py` |
| offline catalog fixtures: the anime / the places | `mock_catalog_fixtures.py` / `mock_geocode_fixtures.py` |
| the oracle scenario roster, and the two families it splices in | `evaluator_oracle_cases.py` + `evaluator_oracle_selection_cases.py` / `evaluator_oracle_reply_language_cases.py` |

The cap gate stops at that package on purpose: **24** more files under `src/animichi` are still over
300 lines (31 before this split), and a gate that starts red is a gate nobody keeps. Widening it —
and adding the oxlint `max-lines` rule the TypeScript side has never had — is #1519.

## TDD: invoke `/backend-tdd` before writing Python.
