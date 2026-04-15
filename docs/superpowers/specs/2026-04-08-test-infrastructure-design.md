# Test Infrastructure: Testcontainers + 160 Eval Cases + Playwright E2E

**Status:** PARTIALLY DONE (60% — testcontainers + eval expansion landed; Playwright + frontend tests not started)

> **Update (2026-04-11):** Tasks 1, 3, and 4 are fully landed. Task 2 is partial (only `test_runtime_acceptance.py` migrated; `test_api_contract.py` and `test_sse_contract.py` still use MagicMock). Task 7 (CI) has integration + eval jobs but no E2E or frontend component test gates. Tasks 5 (Playwright) and 6 (Frontend component tests / Vitest) have not been started. See **Remaining Work** at the bottom.

## Context

Current state: 418 unit tests (all mock), 49 eval cases (broken for ReAct, now fixed), 0 E2E tests, 0 testcontainer usage. Test pyramid is inverted. Every production bug this session was caught by manual QA, not by tests.

**Production model:** `gemini-2.5-pro`
**Local dev model:** `qwen3.5-9b` (LM Studio @ localhost:1234)

## Goals

1. Testcontainers for all integration + eval tests (real PostgreSQL 16)
2. Expand eval from 49 to 160 cases across 11 categories
3. Playwright E2E for 4 critical user flows (local + production)
4. Frontend component tests (Vitest + React Testing Library)
5. CI pipeline supports full test pyramid
6. Eval gate: `score >= baseline - 10pp` per evaluator, using `gemini-2.5-pro`

## Non-Goals

- No load testing / performance benchmarks
- No visual regression testing (screenshots)
- No contract testing against external APIs (Bangumi.tv, Anitabi)

## Architecture

### Test Pyramid

```
┌──────────────────────────────────────────────┐
│  E2E (Playwright)                  ~4 flows  │
│  Local dev server + Production URL           │
│  Trigger: CI (local) + post-deploy (prod)    │
├──────────────────────────────────────────────┤
│  Eval (pydantic_evals)            ~160 cases │
│  Testcontainer PostgreSQL + Real Gemini      │
│  Trigger: every PR (CI gate)                 │
├──────────────────────────────────────────────┤
│  Integration (FastAPI TestClient)   ~40 tests│
│  Testcontainer PostgreSQL                    │
│  Trigger: every PR                           │
├──────────────────────────────────────────────┤
│  Unit (pytest)                    ~420 tests  │
│  Mock DB, mock LLM                           │
│  Trigger: every PR                           │
└──────────────────────────────────────────────┘
```

**Key rule:** DB is real (testcontainer) for everything above unit tests. LLM is real (Gemini) for eval, mock (TestModel) for integration.

### Testcontainer Setup

```python
# backend/tests/conftest.py
@pytest.fixture(scope="session")
def pg_container():
    with PostgresContainer("postgres:16-alpine") as pg:
        _apply_migrations(pg.get_connection_url())
        _seed_fixtures(pg.get_connection_url())
        yield pg

@pytest.fixture
async def db(pg_container):
    client = SupabaseClient(dsn=pg_container.get_connection_url())
    await client.connect()
    yield client
    await client.close()
```

**Seed data:** Export from production Supabase — 10 popular anime + ~50 pilgrimage spots. Save as `backend/tests/fixtures/seed.sql`. Real data catches real edge cases (encoding, null fields, weird coordinates).

**Dependencies:** `testcontainers[postgres]` added to pyproject.toml dev deps. Docker required on CI runner (GitHub Actions ubuntu-latest has it).

---

## Task Breakdown

### Task 1: Testcontainer Conftest + Seed Data ✅ (landed)

**Files:**

- Create: `backend/tests/conftest_db.py` (testcontainer fixtures)
- Create: `backend/tests/fixtures/seed.sql` (exported from production)
- Modify: `pyproject.toml` (add testcontainers dep)

Steps:

1. Add `testcontainers[postgres]>=4.0` to dev dependencies
2. Export seed data from production: 10 anime from `bangumi` table, ~50 spots from `points` table
3. Create conftest with `pg_container` and `db` fixtures
4. Apply all migrations from `supabase/migrations/` on container startup
5. Seed with fixture data after migrations
6. Verify: `uv run pytest backend/tests/integration/ -x -q` passes with real DB

**AC:**

- [x] `pg_container` fixture spins up PostgreSQL 16 (uses `postgis/postgis:16-3.4`)
- [x] Migrations applied automatically (with pgvector line filtering)
- [x] Seed data loaded (10 anime, ~50 spots)
- [x] Existing integration tests pass against testcontainer

### Task 2: Migrate Integration Tests to Testcontainer (partial)

**Files:**

- Modify: `backend/tests/integration/test_runtime_acceptance.py` ✅ (uses `tc_db` fixture)
- Modify: `backend/tests/integration/test_api_contract.py` -- still uses `MagicMock`
- Modify: `backend/tests/integration/test_sse_contract.py` -- still uses `MagicMock`

> Note: `backend/tests/integration/conftest.py` provides the `tc_db` fixture (imports from `conftest_db`). Only `test_runtime_acceptance.py` consumes it so far.

Replace `MagicMock` DB with the `db` fixture from Task 1. Tests now run against real PostgreSQL.

**AC:**

- [ ] All integration tests use testcontainer DB -- **partial: only `test_runtime_acceptance.py`**
- [ ] No `MagicMock` for DB in integration tests -- **not yet: 2 files still use MagicMock**
- [ ] `uv run pytest backend/tests/integration/ -x -q` passes

### Task 3: Migrate Eval to Testcontainer

**Files:**

- Modify: `backend/tests/eval/test_plan_quality.py`

Replace `MagicMock` DB in `evaluate_plan()` with the `db` fixture. `OutcomeEvaluator` now tests against real data (row_count > 0 for known anime).

**AC:**

- [ ] Eval uses testcontainer DB
- [ ] `OutcomeEvaluator` scores > 0 for known anime queries
- [ ] `EVAL_MODEL=gemini-2.5-pro uv run python backend/tests/eval/test_plan_quality.py` runs successfully

### Task 4: Generate 111 New Eval Cases (49 → 160)

**Files:**

- Modify: `backend/tests/eval/datasets/plan_quality_v1.json`

Dispatch 10 parallel agents, one per category:

| Category | Agent generates | Count |
|----------|----------------|-------|
| Anime search (ja) | 5 new edge cases (typos, abbreviations, alternate titles) | +5 |
| Anime search (zh) | Chinese titles, bilibili-style queries | +15 |
| Anime search (en) | English titles, romanized Japanese | +15 |
| Route planning | Multi-step route queries across 3 locales | +12 |
| Nearby search | Location-based queries across 3 locales | +8 |
| QA / greeting | Identity, help, off-topic queries | +5 |
| Clarify | Ambiguous queries that need disambiguation | +15 |
| Error recovery | Unknown anime, invalid input, graceful failures | +12 |
| Multi-turn context | Follow-up queries requiring session context | +15 |
| Boundary / security | Empty, oversized, injection attempts | +8 |

Each case format:
```json
{
  "id": "category-locale-NN",
  "locale": "ja|zh|en",
  "query": "user query text",
  "expected_steps": ["resolve_anime", "search_bangumi"],
  "expected_intent": "search_bangumi",
  "context": null
}
```

Multi-turn cases add `context` field:
```json
{
  "id": "multiturn-ja-01",
  "locale": "ja",
  "query": "そのルートを作って",
  "context": {"last_intent": "search_bangumi", "last_bangumi_id": "262243"},
  "expected_steps": ["plan_route"],
  "expected_intent": "plan_route"
}
```

**AC:**

- [ ] Dataset has 160 total cases
- [ ] All 11 categories represented
- [ ] Each case has valid expected_steps and expected_intent
- [ ] Multi-turn cases have context field

### Task 5: Playwright E2E Setup

**Files:**

- Create: `e2e/playwright.config.ts` (local)
- Create: `e2e/playwright.prod.config.ts` (production)
- Create: `e2e/fixtures/auth.ts` (magic link helper)
- Create: `e2e/tests/auth-flow.spec.ts`
- Create: `e2e/tests/search-flow.spec.ts`
- Create: `e2e/tests/route-planning.spec.ts`
- Create: `e2e/tests/conversation.spec.ts`
- Modify: `package.json` (add playwright deps)

**4 critical flows:**

1. **Auth flow:** Generate magic link → navigate → session created → sidebar shows history
2. **Search flow:** Type anime name → results grid appears → click spot → detail shown
3. **Route planning:** Select multiple spots → click plan route → route visualization renders
4. **Conversation:** Send message → start new chat → click old conversation → history restored

**Two configs:**

- `playwright.config.ts`: `baseURL: 'http://localhost:3000'` (local dev server)
- `playwright.prod.config.ts`: `baseURL: 'https://seichijunrei.zhenjia.org'` (production)

**AC:**

- [ ] `npx playwright test` passes against local dev server
- [ ] `npx playwright test --config=e2e/playwright.prod.config.ts` passes against production
- [ ] All 4 flows tested
- [ ] Auth uses magic link (no hardcoded tokens)

### Task 6: Frontend Component Tests

**Files:**

- Create: `frontend/vitest.config.ts`
- Create: `frontend/tests/components/MessageBubble.test.tsx`
- Create: `frontend/tests/components/PilgrimageGrid.test.tsx`
- Create: `frontend/tests/components/Sidebar.test.tsx`
- Create: `frontend/tests/hooks/useChat.test.ts`
- Create: `frontend/tests/hooks/useSession.test.ts`
- Modify: `frontend/package.json` (add vitest, @testing-library/react)

**AC:**

- [ ] Vitest configured for Next.js
- [ ] 5 test files with meaningful assertions
- [ ] `cd frontend && npm test` passes

### Task 7: CI Pipeline Update

**Files:**

- Modify: `.github/workflows/ci.yml`

Add:

- Integration tests with Docker service (postgres:16-alpine)
- Eval gate with `GEMINI_API_KEY` secret and testcontainer
- Frontend component tests (`npm test`)
- E2E local (Playwright against dev server)
- Post-deploy E2E production (separate job, runs after deploy)

```yaml
integration-tests:
  runs-on: ubuntu-latest
  steps:
    - uv sync --dev
    - uv run pytest backend/tests/integration/ -x -q

eval-gate:
  runs-on: ubuntu-latest
  env:
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  steps:
    - uv sync --dev
    - EVAL_MODEL=gemini-2.5-pro uv run python backend/tests/eval/test_plan_quality.py

e2e-local:
  runs-on: ubuntu-latest
  steps:
    - make serve &
    - cd frontend && npm run dev &
    - npx playwright test

e2e-production:
  if: github.ref == 'refs/heads/main'
  needs: [deploy]
  steps:
    - npx playwright test --config=e2e/playwright.prod.config.ts
```

**Eval baseline:** Store per-model baselines in `backend/tests/eval/baselines/gemini-2.5-pro.json`. Gate: `score >= baseline - 10pp`.

**AC:**

- [ ] CI runs unit + integration + eval + frontend tests + E2E on every PR
- [ ] Post-deploy E2E runs against production
- [ ] Eval gate blocks PRs that regress planner quality

## Iteration Phases

```
Phase 1 (parallel):
  ├── Task 1: Testcontainer conftest + seed data
  └── Task 4: Generate 111 new eval cases (agents)

Phase 2 (after Phase 1):
  ├── Task 2: Migrate integration tests to testcontainer
  ├── Task 3: Migrate eval to testcontainer
  └── Task 6: Frontend component tests (Vitest)

Phase 3 (after Phase 2):
  ├── Task 5: Playwright E2E setup
  └── Task 7: CI pipeline update
```

## Remaining Work

1. **Task 2 (partial):** Migrate `test_api_contract.py` and `test_sse_contract.py` from MagicMock to testcontainer DB
2. **Task 5 (not started):** Playwright E2E setup — `playwright.config.ts`, `e2e/` directory, 4 user journey tests
3. **Task 6 (not started):** Frontend component tests — Vitest config, tests for MessageBubble, PilgrimageGrid, AppShell, useChat, useSession
4. **Task 7 (partial):** Add Playwright E2E gate + frontend component test gate to CI pipeline

## Verification

After all tasks:

1. `uv run pytest backend/tests/unit -x -q` — 420+ tests pass (mock)
2. `uv run pytest backend/tests/integration/ -x -q` — 40+ tests pass (testcontainer)
3. `EVAL_MODEL=gemini-2.5-pro uv run python backend/tests/eval/test_plan_quality.py` — 160 cases scored
4. `cd frontend && npm test` — component tests pass
5. `npx playwright test` — 4 E2E flows pass
6. CI pipeline green with all gates
