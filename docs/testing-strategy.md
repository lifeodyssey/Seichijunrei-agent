# Animichi Testing Strategy

Date: 2026-07-18
Status: CURRENT
Repo: lifeodyssey/animichi
Stack: FastAPI + asyncpg + PydanticAI (`apps/agent`), TanStack Start + React (`apps/web`), Cloudflare Workers (`workers/edge` · `catalog` · `users` · `maintenance`)

## Table of Contents

1. [Test Pyramid](#test-pyramid)
2. [Backend Testing](#backend-testing)
3. [Frontend Testing](#frontend-testing)
4. [Eval Layers](#eval-layers)
5. [Mock Strategy](#mock-strategy)
6. [Database Testing & SQL Review](#database-testing--sql-review)
7. [Third-Party API Testing](#third-party-api-testing)
8. [E2E Testing](#e2e-testing)
9. [Coverage Targets & CI](#coverage-targets--ci)
10. [Eval Resilience & Deploy Impact](#eval-resilience--deploy-impact)
11. [Code Standards (Embed in Prompt)](#code-standards-embed-in-prompt)
12. [Reviewer Checklist](#reviewer-checklist)
13. [Toolchain](#toolchain)
14. [References](#references)

---

## Test Pyramid

```
                    ┌─────────────┐
                    │  🌐 E2E     │ ← Evaluator (no code access, real app testing)
                    │  Browser    │   browse daemon / Chrome DevTools MCP
                    ├─────────────┤
                    │  📊 Eval    │ ← Full agent run, CI-only monitor
                    │  Layer 3    │   Agent end-to-end
                    ├─────────────┤
                    │  📊 Eval    │ ← Single LLM call
                    │  Layer 2    │   Agent tool selection / output
                    ├─────────────┤
                    │  📊 Eval    │ ← Deterministic, no LLM, seconds
                    │  Layer 1    │   ModelRetry guards / output_validator
                    ├─────────────┤
                    │  🔌 API     │ ← Full HTTP + real DB
                    │  Tests      │   FastAPI TestClient + testcontainers
                    ├─────────────┤
                    │  🔗 Integ.  │ ← Component interaction
                    │  Tests      │   DB + API contract + SSE contract
                    ├─────────────┤
               ┌────┤  🧪 Unit   │ ← Fastest, most numerous
               │    │  Tests      │   Function/class level, fully mocked
               └────┴─────────────┘
```

**Principle: more tests at the bottom, fewer at the top. Unit tests in seconds, E2E in minutes.**

---

## Backend Testing

### Unit Tests

**What to test:** Single function/class input→output mapping, boundary values, null, error paths.

**Scope:**
- Tool handlers in `pilgrimage_tools.py` (resolve_anime, search_bangumi, plan_route, etc.)
- ModelRetry guards on tool parameters
- Type guards (isSearchData, isRouteData, etc.)
- AgentResult / StepRecord construction
- Route optimizer algorithm
- Response builder (`agent_result_to_response`)
- Models / schema serialization
- Session facade

**Mock strategy:**
- DB → `AsyncMock` (mock the SQLModel persistence repos)
- External API gateway → `MagicMock`
- LLM → `TestModel` / `FunctionModel` via `Agent.override`
- Settings → `mock_settings` fixture

**Pydantic AI Agent testing (key update):**

Use Pydantic AI's official `TestModel` and `Agent.override` instead of manual mocks:

```python
from pydantic_ai.models.test import TestModel
from pydantic_ai import models

# Global safety net: prevent accidental real LLM calls
models.ALLOW_MODEL_REQUESTS = False

async def test_agent_produces_valid_output():
    """TestModel auto-generates valid data matching the output_type JSON schema."""
    with pilgrimage_agent.override(model=TestModel()):
        result = await pilgrimage_agent.run("響け！ユーフォニアムの聖地")
        assert result.output is not None
```

For precise control over tool call logic, use `FunctionModel`:

```python
from pydantic_ai.models.function import FunctionModel, AgentInfo

def mock_agent(messages: list, info: AgentInfo) -> ModelResponse:
    """Custom agent: first call resolve_anime, second call done."""
    if len(messages) == 1:
        return ModelResponse(parts=[
            ToolCallPart("resolve_anime", {"title": "響け！ユーフォニアム"})
        ])
    return ModelResponse(parts=[TextPart("Search complete")])

async def test_agent_calls_resolve_first():
    with pilgrimage_agent.override(model=FunctionModel(mock_agent)):
        with capture_run_messages() as messages:
            result = await pilgrimage_agent.run("ユーフォの聖地")
        assert messages[1].parts[0].tool_name == "resolve_anime"
```

**Fixture standards — use `factory-boy` instead of scattered `_canned_*` helpers:**

```python
# backend/tests/factories.py
import factory
from backend.agents.agent_result import AgentResult, StepRecord

class StepRecordFactory(factory.Factory):
    class Meta:
        model = StepRecord
    tool = "search_bangumi"
    params = factory.LazyAttribute(lambda o: {"bangumi_id": "12345"})
    result = factory.LazyAttribute(lambda o: {"rows": [], "row_count": 0})

class AgentResultFactory(factory.Factory):
    class Meta:
        model = AgentResult
    output = factory.LazyAttribute(lambda o: {"message": "test"})
    steps = factory.LazyFunction(lambda: [StepRecordFactory()])
    tool_state = factory.LazyFunction(dict)
```

### Integration Tests

**What to test:** Component interaction, boundary crossing (DB, HTTP, SSE).

**Scope:**
- DB CRUD (retriever queries, write-through, session persistence)
- API contract (HTTP status codes, response shape, header validation)
- SSE contract (event order: planning → step* → done, payload format)
- Auth middleware (X-User-Id header injection, API key validation)

**Mock strategy:**
- DB → **real Postgres selected by the three-arm fixture** (not mocked)
- LLM → `TestModel` or `FunctionModel` via `Agent.override`
- External API → `respx` HTTP-level mock
- RuntimeAPI → partially mocked (contract tests verify shape only)

### Agent database arms

`src/animichi/tests/conftest_db.py` evaluates this once per pytest session. Credentials alone never opt a
local run into the live arm.

| `TEST_DATABASE_URL` | `TEST_DB` | Result |
|---|---|---|
| set | set | Hard error: conflicting selectors |
| set | unset | BYO database; read-verified, then mutation-gated |
| unset | `docker` | Offline derived-image arm |
| unset | `neon` | Neon arm; requires `NEON_API_KEY` + `NEON_PROJECT_ID` |
| unset | unset | Offline derived-image default |
| unset | anything else | Hard error: unknown arm |

The priority is therefore `TEST_DATABASE_URL` > explicit `TEST_DB=docker|neon` > offline default.
All container arms apply `migrations/neon/` with the pinned Atlas CLI, reapply the idempotent seed,
and run the same pgvector/HNSW contract. Since the test-infra retirement (#1053), `TEST_DB=neon`
is a **local-only** path (personal key): CI's DB-backed integration lane runs the offline Docker arm
in the single CI workflow's affected-agent lane and references neither the live Neon arm nor a Neon credential. A BYO
database is not writable until `TEST_DB_ALLOW_MUTATION=1`; Neon BYO additionally passes the
protected-lineage check.

Offline recipe (network-free after the immutable image and Atlas are cached):

```bash
docker build -f apps/agent/docker/test-postgres/Dockerfile \
  -t animichi-test-postgres:18-3.6-pgvector-0.8.5 .
ATLAS_VERSION=0.30.0 TEST_DB=docker make test-integration
```

Budget about **30–45 seconds** for the cached offline arm and **6–7 minutes** for a live Neon arm
(manual local runs only since #1053; CI uses the Docker arm). The offline image build itself needs
network once; the Neon arm always needs network and consumes a temporary branch. See
`docs/ops/neon-test-infra.md` for operator details.

`supabase start` is **no longer needed for auth E2E** (AUTH-2 #950): the auth plane is Neon Auth,
login E2E is `e2e/web-neon-login.spec.ts` (live Neon origin, self-skipping), and `make e2e-setup`
installs deps only. The agent backend's local Postgres in `make dev-local` comes from Neon Local
(`make dev-db`); `supabase/` is **archived history** (issue #1000), so `supabase start` is no longer used
as the backend database or for migration tooling. **`supabase start` is an auth appliance, not a test database.**

**FastAPI Dependency Override (official pattern):**

```python
def test_runtime_endpoint():
    app = create_fastapi_app(settings=mock_settings)
    app.dependency_overrides[get_runtime_api] = lambda: mock_handle
    client = TestClient(app)
    response = client.post("/v1/runtime", json={"text": "test", "locale": "ja"},
                           headers={"X-User-Id": "test-user"})
    assert response.status_code == 200
    app.dependency_overrides.clear()
```

### API Tests (new layer)

**What to test:** Full HTTP request path including auth, session management, data persistence.

**Difference from integration tests:**
- Integration tests mock `RuntimeAPI.handle` — only verify HTTP shape
- API tests **do NOT mock RuntimeAPI** — but mock LLM via TestModel
- API tests verify: request → middleware → RuntimeAPI → pipeline (TestModel) → DB write → response

**Scope:**
- POST /v1/runtime — with real DB, verify session creation and message persistence
- POST /v1/runtime/stream — SSE event stream completeness
- GET /v1/conversations — session list correctness
- POST /v1/feedback — feedback written to DB
- Auth header validation — missing header → 400, bad token → 401

---

## Frontend Testing

### Unit Tests (Vitest)

**What to test:** Pure functions and utility logic.

**Scope:**
- `lib/types.ts` — type guards (isSearchData, isRouteData, isQAData, isTimedRouteData)
- `lib/api.ts` — hydrateResponseData, request header construction, error handling
- SSE parsing logic
- Date/locale formatting

**No mocking needed — pure logic.**

### Component Tests (Vitest + React Testing Library + MSW)

**What to test:** React component rendering and user interaction.

**Scope:**
- `MessageBubble` — render different response types (search/route/clarify/error)
- `PilgrimageGrid` — grouping display, tab switching (By Episode / By Area)
- `AppShell` — three-column layout, message selection, activeMessageId state
- `Sidebar` — session list rendering, click switching, "+ New chat" button
- `ResultPanel` — GenerativeUIRenderer registry lookup
- `InputArea` — send button state (disabled/enabled), loading state

**MSW setup:**

```typescript
// frontend/__tests__/mocks/handlers.ts
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.post('/v1/runtime', () => {
    return HttpResponse.json({
      success: true, status: 'ok', intent: 'search_bangumi',
      session_id: 'sess-test', message: '111 spots found',
      data: { results: { rows: [{ id: 1, title_ja: '久美子ベンチ' }], row_count: 111 } },
      ui: { component: 'PilgrimageGrid' }
    })
  }),
  http.get('/v1/conversations', () => {
    return HttpResponse.json({ conversations: [] })
  }),
]

// frontend/__tests__/setup.ts
import { server } from './mocks/server'
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

**Why MSW over `vi.mock('../lib/api')`:**
- MSW intercepts at the network layer, covering fetch logic in `api.ts` (headers, error handling)
- Changing an API path without updating the mock causes test failure (good)
- Same handlers reusable in Storybook and dev
- `vi.mock` skips testing `api.ts` itself

**Component test example:**

```typescript
describe('MessageBubble', () => {
  it('handles null data without crash (BUG-02 regression)', () => {
    const response = { success: true, status: 'ok', data: undefined }
    expect(() => render(<MessageBubble role="bot" response={response} />)).not.toThrow()
  })
})
```

**Fixture conventions:**

```typescript
// frontend/__tests__/fixtures/responses.ts
export const searchResponse = { success: true, status: 'ok', intent: 'search_bangumi', ... }
export const routeResponse = { success: true, status: 'ok', intent: 'plan_route', ... }
export const clarifyResponse = { success: true, status: 'needs_clarification', ... }
export const errorResponse = { success: false, status: 'error', message: 'Pipeline failed' }
export const emptyResponse = { success: true, status: 'empty', data: { results: { rows: [], row_count: 0 } } }
```

---

## Eval Layers

Reference: [Anthropic — Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)

### Eval Pyramid

```
         ┌──────────────────────────────────────────────┐
         │ Layer 3: Agent Eval (full agent run)            │
         │ • 163 cases × full pilgrimage_agent run       │
         │ • Runtime: 1-2 hours, CI-only monitor         │
         │ • Tests: end-to-end convergence, output quality │
         │ • Grader: model-based (LLM scoring)           │
         │ • Metrics: pass@1, pass^3                     │
         ├──────────────────────────────────────────────┤
         │ Layer 2: Agent Tool Eval (single LLM call)     │
         │ • 163 cases × single agent.run()              │
         │ • Runtime: 3-10 minutes                       │
         │ • Tests: tool selection, params, output type   │
         │ • Grader: code-based (schema) + model-based   │
         │ • Metrics: accuracy, valid_output_rate         │
         ├──────────────────────────────────────────────┤
    ┌────┤ Layer 1: Component Eval (deterministic)       │
    │    │ • output_validator rules, ModelRetry guards    │
    │    │ • Runtime: 5 seconds                          │
    │    │ • Tests: deterministic logic correctness       │
    │    │ • Grader: code-based (assert)                 │
    │    │ • Metrics: pass/fail                          │
    └────┴──────────────────────────────────────────────┘
```

### Three Grader Types

| Type | Used in | Pros | Cons |
|------|---------|------|------|
| **Code-based** | L1, L2 schema | Fast, cheap, objective, reproducible | Brittle against valid variations |
| **Model-based** | L2 semantic quality, L3 | Flexible, captures nuance | Non-deterministic, needs calibration |
| **Human** | Calibrating model-based | Gold standard | Expensive, slow |

### Eval Metrics

**pass@k:** Probability of at least one success in k attempts. Use for "just needs to work once."
**pass^k:** Probability that ALL k trials succeed. Use for user-facing reliability.

### Eval execution architecture (two tiers)

Tier 1 trajectory is the default `make test-eval` path. It runs the real LLM
against `MockCatalogClient` and `NullDatabase`, so the tool side is
deterministic and there are zero DB, Docker, or real catalog dependencies. The
same command runs locally and in CI.

Tier 2 fullstack is opt-in via `make test-eval-fullstack`. It sets
`EVAL_FULLSTACK=1` and defaults `EVAL_MAX_CASES` to 50 for a thin run against a
disposable `TEST_DATABASE_URL` plus the real catalog client. The standalone
runner does not own container lifecycle and rejects `TEST_DB`. It is not a PR
gate; use it for nightly or pre-release integration confidence.

No-retry-until-green: eval tasks run once. `retry_task` and
`EVAL_TASK_RETRIES` are not part of the eval contract; task errors are counted
in `errored_count`, and a run fails when more than 20% of cases error.

Regression gating uses `src/animichi/tests/eval/gate.py`: schema-v2 per-case baselines
and a paired-bootstrap 95% confidence interval. Capped runs are report-only and
never read, write, or enforce baselines.

Baselines are per layer and model. Trajectory writes `agent_trajectory_*`;
fullstack writes `agent_*`. These tiers are not score-comparable because their
dependencies and failure modes differ.

### Eval-Driven Development (TDD for LLMs)

1. **Red**: Write eval case (expected behavior), confirm it fails
2. **Green**: Modify prompt / add tool / change validator to pass
3. **Refactor**: Optimize prompt length, reduce token consumption

---

## Mock Strategy

| Dependency | Unit | Integration | API Test | Eval | E2E (Browser) |
|-----------|------|-------------|----------|------|---------------|
| **DB (asyncpg)** | `AsyncMock` | Three-arm real DB fixture | Three-arm real DB fixture | NullDatabase default; BYO fullstack | Real DB |
| **LLM (Pydantic AI)** | `TestModel` / N/A | `TestModel` | `TestModel` | **Real LLM** | Real LLM |
| **Bangumi API** | `MagicMock` | `respx` | `respx` | Behind catalog tier; not direct | Real API |
| **Anitabi API** | `MagicMock` | `respx` | `respx` | Behind catalog tier; not direct | Real API |
| **Frontend API** | — | — | — | — | No mock |
| **Auth / Session** | `mock_settings` | `X-User-Id` header | `X-User-Id` header | `.env.test` | Real login |

**Core principle: Mock at boundaries, never mock the system under test.**

### Mock Tool Selection

| Scenario | Tool | Reason |
|----------|------|--------|
| DB async methods | `unittest.mock.AsyncMock` | Native async support |
| Pydantic AI Agent | `TestModel` + `Agent.override` | Official, auto-generates schema-valid data |
| Custom agent behavior | `FunctionModel` | Precise control over tool call logic |
| HTTP external API | `respx` | httpx-native, 3-6x faster than MagicMock, validates request format |
| HTTP API recording | `pytest-recording` (VCR) | Record real responses, replay without network |
| Frontend API | `msw` (Mock Service Worker) | Network-layer intercept, doesn't skip fetch logic |
| Test data construction | `factory-boy` | Replaces `_canned_*` helpers, composable, overridable |

---

## Database Testing & SQL Review

### Migration Testing

The test fixture never parses, filters, splits, or swallows migration SQL. Atlas 0.30.0 applies
`migrations/neon/` transactionally and records revisions in `public.atlas_schema_revisions`; tests
then assert required tables, extensions, the `vector(1024)` column, and its HNSW index. New
catalog/user schema changes are authored in `migrations/neon/` directly; the archived Supabase
compatibility files (`supabase/`, issue #1000) are not a source and never require an Atlas twin. See
`docs/ops/neon-test-infra.md` for the source rule; `test-base` refresh is manual since #1053.

### SQL Review Standards

Reviewer must check all SQL for:

1. **Performance:** Indexed WHERE columns (verify with EXPLAIN ANALYZE), no SELECT *, LIMIT on large tables, no N+1 (use JOIN or batch)
2. **Security:** Parameterized queries (`$1, $2`), no string concatenation. RLS policies correct. Sensitive data (e.g. credential hashes) hashed.
3. **Correctness:** NULL handling (COALESCE / IS NOT NULL). Transaction boundaries. Unique constraints.
4. **Maintainability:** Formatted SQL (aligned clauses). Comments explain "why" not "what". Migration naming: `YYYYMMDDHHMMSS_description.sql`. Idempotent migrations.

---

## Third-Party API Testing

### respx Usage

```python
import respx
from httpx import Response

@respx.mock
async def test_bangumi_search():
    respx.get("https://api.bgm.tv/search/subject/ユーフォ").mock(
        return_value=Response(200, json={"list": [{"id": 253, "name_cn": "吹响！上低音号"}]})
    )
    client = BangumiClientGateway()
    result = await client.search_by_title("ユーフォ")
    assert result == "253"

async def test_bangumi_api_timeout():
    async with respx.mock:
        respx.get("https://api.bgm.tv/search/subject/test").mock(
            side_effect=httpx.TimeoutException("Timeout")
        )
        result = await gateway.search_by_title("test")
        assert result is None
```

**Required test scenarios:** success (200 + valid JSON), empty response (200 + empty list), error responses (404, 500), timeout, rate limiting (429 + Retry-After), malformed JSON.

### VCR Recording (for Eval)

```python
@pytest.mark.vcr(record_mode="once")
async def test_bangumi_real_response():
    client = BangumiClientGateway()
    result = await client.search_by_title("響け！ユーフォニアム")
    assert result is not None
```

Weekly CI run without cassettes verifies APIs haven't changed.

---

## E2E Testing

**Executed by Evaluator. Evaluator has no code access — only operates the live app.**

### Test Environment

- Agent: `localhost:8080` (FastAPI container/service; choose its DB arm separately)
- Web: `apps/web` Vite dev / Wrangler preview (default `E2E_WEB_BASE_URL=http://localhost:3000`)
- Auth: **Neon Auth (Better Auth)** — live login E2E signs in against the real Neon origin
  (AUTH-2 #950); Supabase GoTrue + `send-auth-email` + Mailpit are retired
- **Nothing is mocked** (the unit suite's MSW lane is separate)

`make e2e-setup` installs E2E deps and the Playwright browser; it no longer starts Supabase or
seeds a compatibility database (the auth E2E database was specific to the retired magic-link flow).

### Core Journeys

| ID | Journey | Actions | Assertions |
|----|---------|---------|------------|
| E2E-01 | Anime search | Type "響け！ユーフォニアム" → send | PilgrimageGrid renders, row count > 0 |
| E2E-02 | Nearby search | Type "宇治駅の近く" → send | Results shown, no excessive duplicates |
| E2E-03 | Route planning | After search, type "ルートを作って" | Route result or clarify prompt, not blank |
| E2E-04 | History switch | Click sidebar entry | Shows correct session messages |
| E2E-05 | New chat | Click "+ New chat" | Chat panel clears |
| E2E-06 | Mobile | Viewport 375px | Bottom drawer works, sidebar overlay |
| E2E-07 | Error recovery | Trigger backend 500 | Error shown, send button recovers |
| E2E-08 | Multilingual | Search in ja/zh/en | Response language matches input |

### Evaluator-Generated Edge Cases

Beyond AC-defined scenarios, Evaluator proactively generates:
- Empty input / very long input (1000 chars)
- Special characters (emoji, HTML tags, SQL injection attempts)
- Rapid-fire 10 messages
- Page refresh → session recovery
- Network throttle (3G)
- Switch between 3 sessions and back

### Screenshots as Evidence

```json
{
  "evidence": [
    {"type": "screenshot", "step": "E2E-01", "file": "/tmp/e2e-search.png", "note": "Search results OK"},
    {"type": "screenshot", "step": "E2E-03", "file": "/tmp/e2e-route.png", "note": "Route still blank ❌"}
  ]
}
```

### Visual Regression (Pixel) Pipeline

The pixel pipeline (`e2e/visual/`, two-tier doctrine: convergence vs
regression) is exposed as a parameterized, re-entrant task atom:

- `make visual-check` — every frame in the registry.
- `make visual-check PAGE=landing MODE=night` — one frame; `PAGE` accepts a
  full frame key or a partial key resolved against `MODE`.
- `make visual-check RATIO=0.05` — loosen the pixel budget; `RATIO` is the
  threshold config, default `0.01`, must be a finite number in `(0, 1]` (a
  malformed value fails fast with `exitCode: 2` + `error`, never a silent
  `NaN`→`null`).
- `make visual-check-self-test` — shell-boundary contract check, three
  phases: (1) multi-frame — runs the atom with no `PAGE` (every frame) and
  asserts each frame has a report, all verdicts are `pass`, and
  `summary.exitCode` is `0`; (2) invocation — a malformed `RATIO` fails fast
  with a fresh `exitCode: 2` summary; (3) host-arm — with docker unavailable
  and no resolvable Playwright binary, the host arm fails fast with an
  environment summary instead of a bare "command not found". Loose budget on
  purpose (contract, not convergence — that is C4). Needs docker + a
  reachable app; fails closed otherwise.
- The docker arm runs Playwright in the image with `e2e/node_modules`; the
  host arm resolves Playwright from `e2e/node_modules` first, then the
  workspace root, and fails fast (environment summary) if neither exists.

Contract (inputs/outputs):

- **Inputs**: `PAGE` (empty = all frames), `MODE` (`day`/`night`, for partial
  keys only), `RATIO` (pixel budget, from config), `E2E_WEB_BASE_URL`
  (default `http://localhost:3000`).
- **The single authoritative verdict is `e2e/visual/report/summary.json`** —
  written fresh on every invocation path (including invocation failures, with
  an `error` field), with a `runId` for freshness; per-frame reports are
  cleared by the runner once, before the frame loop (never from the host
  shell — rm on a Docker Desktop bind mount races the container's writes
  with ENOENT; never per frame, or frame N+1 would delete frame N's report
  and every frame but the last would misreport "no convergence report
  produced").
  `summary.exitCode` has three states: `0` every frame compared and passed ·
  `1` at least one visual diff (`failedFrames`) ·
  `2` environment or invocation problem (unknown `PAGE`, malformed `RATIO`,
  or a frame produced no comparison — app unreachable, runner blocked —
  **fail-closed: zero compared pixels is never green**).
  `scripts/visual-check.sh` exits 0/1/2
  directly; via `make` GNU make remaps any recipe failure to its own exit `2`
  (still nonzero), so the 1-vs-2 distinction lives in the JSON, not in make's
  exit code.
- Per-frame `status` (`pass`/`fail`/`skipped`) carries `ratio`, `threshold`,
  `reason`; `failedFrames` / `skippedFrames` are the flat lists.
- Frame registry, determinism rules, orchestration recipe, and the C4
  convergence TODO (frames not yet converged under the default `RATIO=0.01`):
  `e2e/visual/README.md`.

---

## Coverage Targets & CI

### Enforced coverage floors

The configuration files are authoritative. This table mirrors their live numeric values so the
documentation guard can detect drift; change a floor in its config and this table in the same
commit.

| Metric | Configured floor (%) | Source of truth |
|--------|----------------------|-----------------|
| Backend total | `87` | `apps/agent/pyproject.toml`, `[tool.pytest.ini_options] addopts` → `--cov-fail-under` |
| Frontend statements | `98` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.statements` |
| Frontend branches | `95` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.branches` |
| Frontend functions | `98` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.functions` |
| Frontend lines | `99` | `apps/web/vitest.config.ts`, `test.coverage.thresholds.lines` |

Backend exclusions and reporting rules remain in `apps/agent/pyproject.toml`. Frontend inclusion,
exclusion, reporter, and ratchet details remain in `apps/web/vitest.config.ts`; this document does
not define a second coverage policy.

### Affected PR CI

`.github/workflows/pr-verification.yml` is the single pull-request and merge-queue workflow. The
affected set is pnpm's: `pnpm ls -r --depth -1 --json --filter "...[<merge-base>]"` selects every
workspace project whose files changed plus every dependent, and each selected package runs its own
`lint` / `typecheck` / `test` / `test:integration`. The paths outside the package graph
(`apps/agent`, `migrations/neon`, `e2e`, the root dependency files) are routed by
`dorny/paths-filter` into dedicated jobs, and a root dependency change means every package.
`PR Verification` blocks merge unless every lane succeeds; the direct `Security` context separately
fail-closes the six always-on security jobs.

**No pull request runs a model-backed eval.** The `CI / agent eval (L0 smoke)` lane — 80 capped
trajectories against MiMo through `https://opencode.ai/zen/go/v1` — was deleted with the
affected-matrix rewrite, so no pull-request or merge-queue job holds a provider credential of any
kind. `EVAL_SMOKE=1` is a local recipe now (`apps/agent/AGENTS.md`); the capped run was always
report-only, and removing it changed no merge verdict.

The uncapped L1 trajectory suite is the only model-backed lane left. It runs nightly and on
`workflow_dispatch` in `agent-eval-nightly.yml`, which spells its own steps out since the shared
`.github/actions/agent-eval` composite was deleted (#1367) and opens `ZEN_GO_API_KEY` from Pulumi
ESC with the job's own OIDC identity rather than reading a GitHub secret.

Deployment is not a CI job. A successful merge creates a `main` push; only then does
`.github/workflows/cd.yml` build and promote the affected release cohort.

---

## Eval Resilience & Deploy Impact

### Provider-backed trajectory lane

The affected PR L0 lane and nightly L1 lane use the explicitly configured OpenCode zen/go model;
they do not widen production fallback or secret handling. Provider or transport failures remain
report evidence instead of a merge verdict. Deterministic trajectory assertions and component
tests still fail their own blocking lanes normally.

### Per-Layer Deploy Impact

| Eval Layer | On Failure | Reason |
|------------|-----------|--------|
| Layer 1 (deterministic) | **Block deploy** | Deterministic failure = actually broken |
| Layer 2 (provider-backed L0 trajectory) | **Warning only** | Provider transport/availability must not make merge nondeterministic; the ~80-case report remains visible |
| Layer 3 (nightly full trajectory) | **Warning only** | Statistical baseline and full-provider evidence live outside per-PR blocking CI |
| E2E (browser) | **Block PR merge** | User-visible issues must be fixed |

---

## Code Standards (Embed in Prompt)

The following is embedded directly in Executor and Reviewer prompts. No runtime lookup needed.

### Python / FastAPI

- Routes via `APIRouter`, not directly on app
- Dependency injection via `Depends()`, not in-function imports
- Request/response bodies as Pydantic `BaseModel`, not dict
- Exceptions via `HTTPException`, custom exceptions via `@app.exception_handler`
- Async consistency: `await` inside → `async def`, otherwise → `def`
- Settings via `pydantic-settings`, read from env vars
- Test isolation via `app.dependency_overrides[dep] = mock_dep`

### Pydantic AI Agent

- Agent declares `output_type=` for structured output
- `retries=` for retry (default 2)
- `system_prompt` via `@agent.system_prompt` decorator or string
- Tools via `@agent.tool`, return `str` or serializable type
- `RunContext` for dependency injection, no globals
- Test with `TestModel` + `Agent.override`, not `unittest.mock`
- Assert agent-model exchange with `capture_run_messages()`
- Global `models.ALLOW_MODEL_REQUESTS = False` prevents accidental real calls

### React / TanStack Start (`apps/web`)

- Prefer server loaders and route-level data; mark client components only when interaction/state needs the browser
- Hook rules: no hooks in conditionals/loops
- key prop with stable IDs (e.g. `message.id`), not array index
- `useCallback` for event handlers to prevent unnecessary child re-renders
- CSS via Tailwind utility + `apps/web/src/styles/globals.css` design tokens
- `useEffect` cleanup: return cleanup function to prevent memory leaks
- Package conventions and coverage floors: `apps/web/AGENTS.md` + `apps/web/vitest.config.ts`

### testcontainers

- The session fixture selects BYO, explicit Docker/Neon, or the offline default once
- Use `container.get_connection_url(driver=None)` so asyncpg receives a plain PostgreSQL URL
- `yield` fixtures and the Neon API fallback both enforce lifecycle cleanup
- Apply migrations only through pinned Atlas; never filter or split SQL in Python
- Keep pgvector/HNSW coverage unconditional on both container arms

### respx

- Use `respx.mock` decorator or context manager
- Test success + error + timeout paths
- `url__startswith=` for base URL matching
- Default `assert_all_called=True`: all defined mocks must be called

### MSW (Mock Service Worker)

- `setupServer` in `beforeAll`, close in `afterAll`
- `server.resetHandlers()` in `afterEach` to prevent test pollution
- `onUnhandledRequest: 'error'` — unmocked requests auto-fail
- Handlers centralized in `__tests__/mocks/handlers.ts`

### Clean Code

- **1-10-50**: methods < 10 lines, classes < 50 lines, max 1 indentation level
- **Early return** instead of nested if-else
- **Self-documenting names**, zero comments (unless explaining "why")
- **Declare variables near usage point**
- **No `Any` type** (Python) — use `object` + `isinstance()` narrowing

### SOLID

- **S** — Single Responsibility: one module, one reason to change
- **O** — Open/Closed: new tool = new `@agent.tool` registration, don't modify agent core
- **L** — Liskov Substitution: subclasses don't break parent constraints
- **I** — Interface Segregation: don't expose unused methods
- **D** — Dependency Inversion: handlers depend on DB interface (async methods), not concrete implementation

### Naming Conventions

| Category | Rule | Good | Bad |
|----------|------|------|-----|
| Functions | Verb-first | `find_bangumi_by_title()` | `get_data()` |
| Booleans | is/has/can/should prefix | `is_cached`, `has_results` | `cached`, `found` |
| Classes | Noun, describes role | `RouteOptimizer` | `RouteHelper` |
| Constants | SCREAMING_SNAKE | `MAX_RETRIES` | `maxRetries` |
| Files | Match content | `resolve_anime.py` | `handler1.py` |
| React components | PascalCase | `MessageBubble` | `Bubble` |
| Hooks | use prefix | `useChat` | `chatManager` |
| Tests | test_ + describe behavior | `test_returns_empty_on_timeout` | `test_1` |

### Mock Rules (by test layer)

- Unit: mock all external dependencies (DB, API, LLM)
- Integration: mock only LLM; DB uses the three-arm real fixture
- API test: mock only LLM, real DB
- Agent eval: trajectory uses NullDatabase + MockCatalogClient; fullstack uses BYO + real catalog
- Frontend component: MSW mock API layer
- E2E: **mock nothing**
- Use `respx` for HTTP mocks, `AsyncMock` for async functions
- Use `TestModel` + `Agent.override` for Pydantic AI Agent mocks
- Use `factory-boy` for test data, not hand-written `_canned_*`

---

## Reviewer Checklist

### Code Review (by priority)

**P0 — Must fix:**
- Security vulnerabilities (SQL injection, XSS, hardcoded secrets)
- Crash bugs (null pointer, unhandled exceptions)
- Data loss risk (missing transactions, race conditions)
- `Any` type introduced

**P1 — Should fix:**
- SOLID violation
- Clean Code rule violation (method > 10 lines, deep nesting)
- Missing corresponding test (Quality Ratchet: every AC must have a test)
- Framework best practice violation (FastAPI, Pydantic AI, React)
- Unclear naming

**P2 — Suggested:**
- Code duplication (extractable helper)
- Performance optimization opportunity
- Better data structure choice

### SQL Review

- Parameterized queries (`$1, $2`), no string concatenation
- WHERE columns indexed
- No `SELECT *`
- Large tables have `LIMIT`
- NULL handling (COALESCE / IS NOT NULL)
- Transaction boundaries correct
- Migrations idempotent

### Framework-Specific Review

For uncertain framework APIs or newly introduced libraries, Reviewer should use context7 to check latest docs. Known best practices (listed above) do not require runtime lookup.

---

## Toolchain

### Backend

| Tool | Purpose | Status |
|------|---------|--------|
| `pytest` | Test framework | ✅ Installed |
| `pytest-asyncio` | Async test support | ✅ Installed |
| `httpx` | FastAPI TestClient | ✅ Installed |
| `testcontainers[postgres]` | Real PG testing | ✅ Installed |
| `pytest-cov` | Coverage reporting | ✅ Installed |
| `pydantic-ai TestModel` | Agent mock | ⬆ Migrate from unittest.mock |
| `respx` | httpx HTTP mock | 🆕 To install |
| `factory-boy` | Test data factory | 🆕 To install |
| `pytest-recording` (VCR) | API response recording | 🆕 Optional |

### Frontend

| Tool | Purpose | Status |
|------|---------|--------|
| `vitest` | Test framework | 🆕 To install |
| `@testing-library/react` | Component testing | 🆕 To install |
| `@testing-library/jest-dom` | DOM assertions | 🆕 To install |
| `@testing-library/user-event` | User interaction simulation | 🆕 To install |
| `msw` | API mock | 🆕 To install |
| `jsdom` | Browser env simulation | 🆕 To install |

### Make Commands

```makefile
# Existing
test:                    # unit tests (seconds)
test-integration:        # integration (minutes, needs Docker)
test-eval:               # trajectory evals (needs LLM API, no Docker)
test-eval-fullstack:     # thin fullstack eval (opt-in, not a PR gate)

# New
test-api:                # API contract tests with real DB (minutes)
test-frontend:           # vitest (seconds)
test-coverage:           # pytest-cov + vitest --coverage
test-eval-component:     # Layer 1, deterministic, seconds
test-all:                # unit + integration + api + frontend + eval-component
```

---

## References

- [FastAPI Testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [FastAPI Dependency Override](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
- [Pydantic AI Testing Guide](https://pydantic.dev/docs/ai/guides/testing/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [MSW — Mock Service Worker](https://github.com/mswjs/msw)
- [respx — Mock HTTPX](https://github.com/lundberg/respx)
- [testcontainers Python](https://testcontainers.com/guides/getting-started-with-testcontainers-for-python/)
- [Anthropic: Demystifying Evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic: Harness Design](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- [pgTAP: PostgreSQL Unit Testing](https://pgtap.org/)
- [Clean Code / TDD Principles](https://zhenjia.org/posts/clean-code-refactoring-and-test-driven-development)
- [Agentic Coding Workflow](https://zhenjia.org/posts/my-core-agentic-coding-workflow-on-2025-12-8)
