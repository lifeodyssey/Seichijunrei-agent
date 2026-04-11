# Seichijunrei Testing Strategy

Date: 2026-04-11
Status: DRAFT
Repo: lifeodyssey/Seichijunrei-agent
Stack: FastAPI + asyncpg + Pydantic AI (backend), Next.js + React (frontend), Cloudflare Workers (deploy)

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
                    │  📊 Eval    │ ← Full ReAct loop, CI-only monitor
                    │  Layer 3    │   Pipeline end-to-end
                    ├─────────────┤
                    │  📊 Eval    │ ← Single LLM call
                    │  Layer 2    │   Planner plan quality
                    ├─────────────┤
                    │  📊 Eval    │ ← Deterministic, no LLM, seconds
                    │  Layer 1    │   Intent classifier / Validator
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
- Executor handlers (resolve_anime, search_bangumi, plan_route, etc.)
- Type guards (isSearchData, isRouteData, etc.)
- Result validator rules
- Route optimizer algorithm
- Response builder
- Models / schema serialization
- Session facade

**Mock strategy:**
- DB → `AsyncMock` (mock `SupabaseClient` methods)
- External API gateway → `MagicMock`
- LLM → not involved (executor has no LLM calls)
- Settings → `mock_settings` fixture

**Pydantic AI Agent testing (key update):**

Use Pydantic AI's official `TestModel` and `Agent.override` instead of manual mocks:

```python
from pydantic_ai.models.test import TestModel
from pydantic_ai import models

# Global safety net: prevent accidental real LLM calls
models.ALLOW_MODEL_REQUESTS = False

async def test_planner_produces_valid_plan():
    """TestModel auto-generates valid data matching the output_type JSON schema."""
    with planner_agent.override(model=TestModel()):
        result = await planner_agent.run("響け！ユーフォニアムの聖地")
        assert isinstance(result.output, ExecutionPlan)
        assert len(result.output.steps) > 0
```

For precise control over tool call logic, use `FunctionModel`:

```python
from pydantic_ai.models.function import FunctionModel, AgentInfo

def mock_planner(messages: list, info: AgentInfo) -> ModelResponse:
    """Custom planner: first call resolve_anime, second call done."""
    if len(messages) == 1:
        return ModelResponse(parts=[
            ToolCallPart("resolve_anime", {"title": "響け！ユーフォニアム"})
        ])
    return ModelResponse(parts=[TextPart("Plan complete")])

async def test_planner_calls_resolve_first():
    with planner_agent.override(model=FunctionModel(mock_planner)):
        with capture_run_messages() as messages:
            result = await planner_agent.run("ユーフォの聖地")
        assert messages[1].parts[0].tool_name == "resolve_anime"
```

**Fixture standards — use `factory-boy` instead of scattered `_canned_*` helpers:**

```python
# backend/tests/factories.py
import factory
from backend.agents.models import PlanStep, ExecutionPlan, ToolName
from backend.agents.executor_agent import PipelineResult, StepResult

class PlanStepFactory(factory.Factory):
    class Meta:
        model = PlanStep
    tool = ToolName.SEARCH_BANGUMI
    params = factory.LazyAttribute(lambda o: {"bangumi_id": "12345"})

class ExecutionPlanFactory(factory.Factory):
    class Meta:
        model = ExecutionPlan
    reasoning = "test"
    locale = "ja"
    steps = factory.LazyFunction(lambda: [PlanStepFactory()])

class PipelineResultFactory(factory.Factory):
    class Meta:
        model = PipelineResult
    intent = "search_bangumi"
    plan = factory.SubFactory(ExecutionPlanFactory)
```

### Integration Tests

**What to test:** Component interaction, boundary crossing (DB, HTTP, SSE).

**Scope:**
- DB CRUD (retriever queries, write-through, session persistence)
- API contract (HTTP status codes, response shape, header validation)
- SSE contract (event order: planning → step* → done, payload format)
- Auth middleware (X-User-Id header injection, API key validation)

**Mock strategy:**
- DB → **testcontainers real PostgreSQL** (not mocked)
- LLM → `TestModel` or `AsyncMock` returning fixed `ExecutionPlan`
- External API → `respx` HTTP-level mock
- RuntimeAPI → partially mocked (contract tests verify shape only)

**testcontainers best practices:**

```python
@pytest.fixture(scope="session")
def pg_container():
    """Session-scoped: all integration tests share one PG container."""
    with PostgresContainer("postgres:16-alpine") as pg:
        yield pg

@pytest.fixture
async def tc_db(pg_container):
    """Function-scoped: each test gets an isolated DB connection."""
    dsn = pg_container.get_connection_url().replace("+psycopg2", "")
    client = SupabaseClient(dsn, min_pool_size=1, max_pool_size=5)
    await client.connect()
    yield client
    await client.execute("TRUNCATE bangumi, points, feedback, request_log CASCADE")
    await client.close()
```

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
         │ Layer 3: Pipeline Eval (full ReAct loop)      │
         │ • 163 cases × full pipeline                   │
         │ • Runtime: 1-2 hours, CI-only monitor         │
         │ • Tests: end-to-end convergence, output quality│
         │ • Grader: model-based (LLM scoring)           │
         │ • Metrics: pass@1, pass^3                     │
         ├──────────────────────────────────────────────┤
         │ Layer 2: Planner Eval (single LLM call)       │
         │ • 163 cases × single planner.step()           │
         │ • Runtime: 3-10 minutes                       │
         │ • Tests: plan structure, tool selection, params│
         │ • Grader: code-based (schema) + model-based   │
         │ • Metrics: accuracy, valid_plan_rate           │
         ├──────────────────────────────────────────────┤
         │ Layer 1b: Intent Classifier Eval              │
         │ • 163 cases × classify_intent()               │
         │ • Runtime: 3-5 min (single LLM call/case)     │
         │ • Tests: intent classification accuracy        │
         │ • Grader: code-based (exact match)            │
         │ • Metrics: accuracy, confusion matrix          │
         ├──────────────────────────────────────────────┤
    ┌────┤ Layer 1a: Component Eval (deterministic)      │
    │    │ • result_validator rules, step dependency graph│
    │    │ • Runtime: 5 seconds                          │
    │    │ • Tests: deterministic logic correctness       │
    │    │ • Grader: code-based (assert)                 │
    │    │ • Metrics: pass/fail                          │
    └────┴──────────────────────────────────────────────┘
```

### Three Grader Types

| Type | Used in | Pros | Cons |
|------|---------|------|------|
| **Code-based** | L1a, L1b, L2 schema | Fast, cheap, objective, reproducible | Brittle against valid variations |
| **Model-based** | L2 semantic quality, L3 | Flexible, captures nuance | Non-deterministic, needs calibration |
| **Human** | Calibrating model-based | Gold standard | Expensive, slow |

### Eval Metrics

**pass@k:** Probability of at least one success in k attempts. Use for "just needs to work once."
**pass^k:** Probability that ALL k trials succeed. Use for user-facing reliability.

### Baseline & Regression Detection

1. First run generates baseline file (JSON: per-case pass/fail + score)
2. Subsequent runs compare against baseline:
   - Regression ≥ 10pp → **FAIL** (block merge)
   - Improvement ≥ 5pp → update baseline
   - Within baseline ± 5pp → PASS
3. Each layer maintains its own independent baseline file

### Handling Non-Determinism

- Run **3 trials** per case
- Use pass@3 for capability evals
- Use pass^3 for regression evals
- Isolate trials: clean session state between runs

### Eval-Driven Development (TDD for LLMs)

1. **Red**: Write eval case (expected behavior), confirm it fails
2. **Green**: Modify prompt / add tool / change validator to pass
3. **Refactor**: Optimize prompt length, reduce token consumption

---

## Mock Strategy

| Dependency | Unit | Integration | API Test | Eval | E2E (Browser) |
|-----------|------|-------------|----------|------|---------------|
| **DB (asyncpg)** | `AsyncMock` | testcontainers PG | testcontainers PG | Real PG or fixture | Real DB |
| **LLM (Pydantic AI)** | `TestModel` / N/A | `TestModel` | `TestModel` | **Real LLM** | Real LLM |
| **Bangumi API** | `MagicMock` | `respx` | `respx` | Real or VCR cache | Real API |
| **Anitabi API** | `MagicMock` | `respx` | `respx` | Real or VCR cache | Real API |
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

```python
async def test_migrations_apply_cleanly(pg_container):
    """All migration files apply to empty DB in order without error."""
    dsn = pg_container.get_connection_url().replace("+psycopg2", "")
    conn = await asyncpg.connect(dsn)
    for sql_file in sorted(Path("supabase/migrations").glob("*.sql")):
        await conn.execute(sql_file.read_text())
    tables = await conn.fetch("SELECT tablename FROM pg_tables WHERE schemaname='public'")
    table_names = {r['tablename'] for r in tables}
    assert {'bangumi', 'points', 'feedback', 'request_log', 'api_keys'} <= table_names
    await conn.close()
```

### SQL Review Standards

Reviewer must check all SQL for:

1. **Performance:** Indexed WHERE columns (verify with EXPLAIN ANALYZE), no SELECT *, LIMIT on large tables, no N+1 (use JOIN or batch)
2. **Security:** Parameterized queries (`$1, $2`), no string concatenation. RLS policies correct. Sensitive data (api_keys) hashed.
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

- Backend: `localhost:8080` (FastAPI + testcontainers PG or seed data)
- Frontend: `localhost:3000` (Next.js dev server)
- **Nothing is mocked**

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

---

## Coverage Targets & CI

### Current State (as of 2026-04-11)

| Area | Status | Notes |
|------|--------|-------|
| Backend unit coverage | ✅ CI enforced | `--cov-fail-under=70` in ci.yml |
| Backend coverage upload | ⚠️ Weak | Codecov configured but `continue-on-error: true` |
| Backend integration | ⚠️ Weak | Only runs on main push, `continue-on-error: true` |
| Frontend tests | ❌ None | No vitest, no test runner, no coverage |
| Eval in CI | ⚠️ Partial | `eval` job exists but separate from merge gate |

### Targets

| Layer | Current | Target | Enforcement |
|-------|---------|--------|-------------|
| Backend unit | ~70% (CI gate) | **80%** | `--cov-fail-under=80` |
| Backend integration | ~20% | **50%** | CI must-pass (remove `continue-on-error`) |
| Frontend unit+component | **0%** | **60%** | New vitest job with `--coverage` |
| E2E journeys | **0** | **8 journeys** | Evaluator runs pre-merge |
| Eval Layer 1a | existing | **100% pass** | Deterministic, must pass |
| Eval Layer 1b | existing | **baseline + 10pp** | Block merge on regression |
| Eval Layer 2 | to build | **baseline + 10pp** | Block merge on regression |
| Eval Layer 3 | existing | **monitor only** | Does not block |

### Coverage Rules

1. `make test-coverage` generates report (pytest-cov + vitest --coverage)
2. **PR cannot decrease coverage** (ratchet: only up, never down)
3. **New files must have > 70% coverage**
4. Exclude: `__init__.py`, migration files, `config/`, `__pycache__/`

### CI Pipeline (target state)

```yaml
jobs:
  gate-fast:              # Must pass for merge
    - make test            # unit
    - make lint
    - make typecheck
    - make test-frontend   # vitest

  gate-integration:        # Must pass for merge
    - make test-integration  # remove continue-on-error
    - make test-api

  gate-eval:               # Must pass for merge
    - make test-eval-component    # Layer 1a, seconds
    - make test-eval-intent       # Layer 1b, minutes
    - make test-eval-planner      # Layer 2, minutes

  monitor-only:            # Does not block
    - make test-eval-pipeline     # Layer 3, hours

  deploy:
    needs: [gate-fast, gate-integration, gate-eval]
```

---

## Eval Resilience & Deploy Impact

### LLM Provider Fallback

Eval runner uses the same multi-provider fallback as production:

```
Attempt order:
1. Gemini 3.1 Pro (EVAL_MODEL default)
2. GPT 5.4 via Univibe (EVAL_FALLBACK_MODEL)
3. Local LM Studio qwen3.5-9b (EVAL_LOCAL_MODEL, marked degraded)
```

All providers unavailable → `pytest.skip("No LLM provider")` → CI shows ⚠️ not ❌. Deploy continues with annotation.

### Per-Layer Deploy Impact

| Eval Layer | On Failure | Reason |
|------------|-----------|--------|
| Layer 1a (deterministic) | **Block deploy** | Deterministic failure = actually broken |
| Layer 1b (intent) | **Block PR merge** | Classification accuracy regressed |
| Layer 2 (planner) | **Block PR merge** | Plan quality regressed |
| Layer 3 (pipeline) | **Warning only** | Too slow, non-deterministic, report only |
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

### React / Next.js

- Server Components by default, `"use client"` only when interaction/state needed
- Minimize `"use client"` — only on components that truly need client state
- Hook rules: no hooks in conditionals/loops
- key prop with stable IDs (e.g. `message.id`), not array index
- `useCallback` for event handlers to prevent unnecessary child re-renders
- CSS via Tailwind utility + `globals.css` design tokens
- `useEffect` cleanup: return cleanup function to prevent memory leaks

### testcontainers

- Fixture `scope="session"` to share container, avoid per-test restart
- `yield` fixture ensures cleanup
- DSN conversion: remove `+psycopg2` for asyncpg format
- TRUNCATE tables after each test for isolation

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
- **O** — Open/Closed: new tool = new handler file + register, don't modify executor core
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
- Integration: mock only LLM, DB via testcontainers
- API test: mock only LLM, real DB
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
test-eval:               # all evals (hours, needs LLM API)

# New
test-api:                # API contract tests with real DB (minutes)
test-frontend:           # vitest (seconds)
test-coverage:           # pytest-cov + vitest --coverage
test-eval-component:     # Layer 1a, deterministic, seconds
test-eval-intent:        # Layer 1b, single LLM, minutes
test-eval-planner:       # Layer 2, single LLM, minutes
test-eval-pipeline:      # Layer 3, full ReAct, hours (CI-only)
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
