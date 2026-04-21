# Spec: API & E2E Tests Against Production

Date: 2026-04-20
Status: READY
Author: Code smell refactor session

## Problem

Current test pyramid has a gap: unit tests (713) use mocks, integration tests use testcontainers, but there are no systematic tests that hit the **real production API** with **real data**. The existing `test_e2e_smoke.py` has 5 basic smoke tests but doesn't cover the full user journey or validate response shapes against real LLM output.

The user wants tests written with **production data as the ground truth** — real anime titles, real pilgrimage spots, real coordinates. Like Flyway migrations that run against the real DB, these tests run against the real API.

## Goals

1. **API contract tests** — verify every endpoint returns correct shape with real data
2. **User journey E2E** — simulate complete flows (search → view → route → feedback)
3. **Regression guard** — catch when LLM behavior drifts or DB data changes
4. **Locale coverage** — test ja/zh/en responses with real queries

## Non-Goals

- Replace unit tests or mocks (those stay for fast CI)
- Test internal implementation (only test the HTTP API surface)
- Guarantee deterministic LLM output (use fuzzy assertions)

## Architecture

```
backend/tests/e2e/
  conftest.py              # Shared: API client, auth, helpers
  test_health.py           # Health + CORS
  test_search.py           # Search by anime title (3 locales)
  test_nearby.py           # Nearby search with real coords
  test_route.py            # Route planning with real points
  test_conversation.py     # Conversation CRUD lifecycle
  test_feedback.py         # Feedback submission
  test_stream.py           # SSE streaming contract
  test_clarification.py    # Ambiguous queries → clarification
  datasets/
    queries.json           # Real queries with expected behaviors
```

## API Endpoints to Cover

| Endpoint | Method | Test Cases |
|---|---|---|
| `/healthz` | GET | Returns 200 + status ok |
| `/v1/runtime` | POST | Search, nearby, route, greet, clarify |
| `/v1/runtime/stream` | POST | SSE stream with step events |
| `/v1/feedback` | POST | Submit rating + comment |
| `/v1/conversations` | GET | List user conversations |
| `/v1/conversations/:id` | GET | Get single conversation |
| `/v1/conversations/:id` | PATCH | Rename conversation |
| `/v1/routes` | GET | List user route history |
| `/v1/bangumi/popular` | GET | Popular anime list |
| `/v1/bangumi/nearby` | GET | Nearby anime by coords |

## Test Cases (Real Production Data)

### Search Tests (`test_search.py`)

| # | Query | Locale | Expected |
|---|-------|--------|----------|
| S1 | "君の名は の聖地を教えて" | ja | intent=search_bangumi, rows > 0, has coordinates |
| S2 | "你的名字的取景地在哪" | zh | intent=search_bangumi, rows > 0, message in Chinese |
| S3 | "Show me anime spots for Your Name" | en | intent=search_bangumi, rows > 0, message in English |
| S4 | "響け！ユーフォニアム" | ja | intent=search_bangumi, rows with Kyoto-area coords |
| S5 | "秒速5センチメートル の聖地を探して" | ja | rows > 0, screenshot_url present |
| S6 | "nonexistent anime title xyz123" | en | graceful fallback, no crash |

### Nearby Tests (`test_nearby.py`)

| # | Query | Locale | Expected |
|---|-------|--------|----------|
| N1 | "京都駅の近くにある聖地を教えて" | ja | intent=search_nearby, results near Kyoto Station (34.98, 135.76) |
| N2 | "秋葉原附近的动漫取景地" | zh | intent=search_nearby, results near Akihabara |
| N3 | "Find anime spots near Tokyo Tower" | en | results near (35.66, 139.75) |

### Route Tests (`test_route.py`)

| # | Query | Locale | Expected |
|---|-------|--------|----------|
| R1 | "響け！ユーフォニアムの聖地を巡るルートを作って" | ja | intent=plan_route, ordered_points with distances |
| R2 | "帮我规划吹响上低音号的巡礼路线" | zh | intent=plan_route, route_url present |
| R3 | Search → select 3 points → plan_selected | en | ordered route with exactly 3 stops |

### Conversation Lifecycle (`test_conversation.py`)

| # | Step | Expected |
|---|------|----------|
| C1 | POST /v1/runtime with query → extract session_id | session_id returned |
| C2 | GET /v1/conversations | list contains the new session |
| C3 | GET /v1/conversations/:id | returns conversation detail |
| C4 | PATCH /v1/conversations/:id {title} | title updated |
| C5 | POST /v1/runtime with same session_id (follow-up) | context preserved |

### Clarification Tests (`test_clarification.py`)

| # | Query | Expected |
|---|-------|----------|
| CL1 | "ハルヒ" (ambiguous — multiple anime) | needs_clarification or search results |
| CL2 | "ラブライブ" (multiple series) | candidates list or direct results |

### Stream Tests (`test_stream.py`)

| # | Test | Expected |
|---|------|----------|
| ST1 | POST /v1/runtime/stream with search query | SSE events: step → step → done |
| ST2 | Parse each SSE event | valid JSON, has type field |
| ST3 | Final event | has message + data fields |

### Feedback Tests (`test_feedback.py`)

| # | Test | Expected |
|---|------|----------|
| F1 | POST /v1/feedback {session_id, rating: "good"} | 200, feedback_id returned |
| F2 | POST /v1/feedback {session_id, rating: "bad", comment: "..."} | 200, feedback_id |

## Environment Configuration

```bash
# Required env vars
SEICHI_API_URL=https://seichijunrei.zhenjia.org  # or http://localhost:8080
SEICHI_API_KEY=sk_xxx                             # API key for auth

# Run
uv run pytest backend/tests/e2e/ -v --no-cov

# CI: only on manual trigger (not on every push)
```

## Assertion Strategy

Since LLM output is non-deterministic:

1. **Shape assertions**: response has `message`, `data`, `session_id` fields
2. **Type assertions**: `rows` is a list, each row has `latitude`/`longitude`/`name`
3. **Fuzzy content**: message language matches locale (regex for ja/zh characters)
4. **Count assertions**: `rows > 0` not `rows == 5`
5. **Coordinate bounds**: results near expected location (within 50km radius)
6. **No crash**: error queries return graceful responses, not 500s

## Dependencies

- `aiohttp` for async HTTP calls (already in eval tests)
- Production API accessible (Cloudflare Worker)
- Valid API key (`sk_xxx` format)

## File Placement

- Tests: `backend/tests/e2e/`
- Datasets: `backend/tests/e2e/datasets/queries.json`
- NOT in `backend/tests/unit/` or `backend/tests/integration/`

## AC Summary

- [ ] `conftest.py` with shared client, auth, helpers → unit
- [ ] `test_health.py` — health + CORS → api
- [ ] `test_search.py` — 6 search cases across 3 locales → api
- [ ] `test_nearby.py` — 3 nearby cases → api
- [ ] `test_route.py` — 3 route cases → api
- [ ] `test_conversation.py` — 5-step lifecycle → api
- [ ] `test_clarification.py` — 2 ambiguous query cases → api
- [ ] `test_stream.py` — 3 SSE streaming cases → api
- [ ] `test_feedback.py` — 2 feedback cases → api
- [ ] `datasets/queries.json` — real queries with expected behaviors → api
- [ ] All tests skip gracefully when `SEICHI_API_URL` not set
- [ ] Tests pass against production (`seichijunrei.zhenjia.org`)
- [ ] CI workflow: manual trigger only (`workflow_dispatch`)
