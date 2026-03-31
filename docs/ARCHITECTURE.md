# Architecture

## Overview

```
User text  →  ReActPlannerAgent (LLM)  →  ExecutionPlan
                                              ↓
                                        ExecutorAgent (deterministic)
                                              ↓
                                        PipelineResult
```

Entry path: `HTTP service → RuntimeAPI → run_pipeline → ReActPlannerAgent → ExecutorAgent`

No IntentAgent. No hardcoded anime list. DB is source of truth.

## Shared Types — `agents/models.py`

```python
class ToolName(str, Enum):
    RESOLVE_ANIME = "resolve_anime"
    SEARCH_BANGUMI = "search_bangumi"
    SEARCH_NEARBY = "search_nearby"
    PLAN_ROUTE = "plan_route"
    ANSWER_QUESTION = "answer_question"

class PlanStep(BaseModel):
    tool: ToolName
    params: dict[str, Any] = {}
    parallel: bool = False

class ExecutionPlan(BaseModel):
    steps: list[PlanStep]
    reasoning: str   # for eval / debugging
    locale: str = "ja"

class RetrievalRequest(BaseModel):
    tool: Literal["search_bangumi", "search_nearby"]
    bangumi_id: str | None = None
    episode: int | None = None
    location: str | None = None
    origin: str | None = None
    radius: int | None = None
```

## ReActPlannerAgent — `agents/planner_agent.py`

- Pydantic AI `Agent`, `output_type=ExecutionPlan`, `retries=2`
- Single method: `create_plan(text: str, locale: str) → ExecutionPlan`
- System prompt describes tools without hardcoded anime IDs
- For any anime query: always emits `resolve_anime` as first step

## ExecutorAgent — `agents/executor_agent.py`

- Receives `ExecutionPlan`; no LLM calls
- Dispatches each step to a handler; deposits result in `context[tool_name]`
- Response message comes from `_MESSAGES[(tool, locale)]` static templates
- Adds `ui: {component, props}` to the response based on intent

### Tool handlers

| Tool | Handler | Notes |
|---|---|---|
| `resolve_anime` | `_execute_resolve_anime` | Fuzzy-match `bangumi` table; Bangumi.tv API on miss; write-through upsert |
| `search_bangumi` | `_execute_search_bangumi` | Reads `context["resolve_anime"]["bangumi_id"]` when `params.bangumi_id` is None |
| `search_nearby` | `_execute_search_nearby` | Geo query via Retriever |
| `plan_route` | `_execute_plan_route` | Nearest-neighbor sort on bangumi points |
| `answer_question` | `_execute_answer_question` | Static FAQ response |

## Retriever — `agents/retriever.py`

Unchanged. Accepts `RetrievalRequest`. Selects `sql`, `geo`, or `hybrid` deterministically. Write-through on bangumi DB miss (Anitabi → Supabase).

## SQL Agent — `agents/sql_agent.py`

Accepts `RetrievalRequest` (replaces old `IntentOutput`). Parameterized queries only.

## Public API — `interfaces/public_api.py`

- Stable request/response facade over `run_pipeline`
- Adds `ui: UIDescriptor` field to response
- Writes to `request_log` after every response (best-effort, never raises)
- Session persistence + route history

## HTTP Service — `interfaces/http_service.py`

aiohttp. Endpoints: `GET /healthz`, `POST /v1/runtime`, `POST /v1/feedback`. Auth is NOT enforced here — it is enforced upstream in the CF Worker.

## Response Contract

```typescript
interface UIDescriptor {
  component: string   // e.g. "PilgrimageGrid"
  props: Record<string, unknown>
}

interface RuntimeResponse {
  intent: string
  message: string     // localized static template, no LLM latency
  data: SearchData | RouteData | QAData | null
  ui?: UIDescriptor   // additive field for Generative UI
  session: string | null
  route_history: RoutePoint[]
}
```

## Self-Evolve

Every anime query triggers `resolve_anime` first:
1. Fuzzy-match `bangumi` table (title / title_cn)
2. On miss: query Bangumi.tv search API → upsert → return `bangumi_id`

DB grows automatically. No hardcoded list in code.

## Auth Layer — `src/worker.js`

CF Worker validates credentials before proxying to the container:

- `Authorization: Bearer <supabase_jwt>` → call `SUPABASE_URL/auth/v1/user`
- `Authorization: Bearer sk_<hex>` → SHA-256 hash → lookup `api_keys` table
- Sets `X-User-Id` + `X-User-Type` on forwarded request
- `/healthz` and static assets bypass auth

API keys: stored as SHA-256 hash in `api_keys` table. Raw key shown once at creation.

## Frontend Architecture

### Three-Column Layout

```
┌─────────┬──────────────────┬──────────────────────┐
│ Sidebar │ Chat Panel 360px │ Result Panel flex-1  │
│ 240px   │                  │                      │
│ History │ user messages    │ GenerativeUIRenderer │
│ New     │ bot: text only   │ (active result)      │
│         │ + ◈ anchor cards │                      │
│         │ [input]          │ empty: dark map bg   │
└─────────┴──────────────────┴──────────────────────┘
```

`◈` anchor click sets `activeMessageId` in AppShell → drives `ResultPanel`. On mobile: opens `ResultDrawer` (vaul bottom sheet).

### Generative UI Registry

```typescript
// frontend/components/generative/registry.ts
export const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  PilgrimageGrid:     (r) => <PilgrimageGrid data={r.data} />,
  RouteVisualization: (r) => <RouteVisualization data={r.data} />,
  NearbyMap:          (r) => <NearbyMap data={r.data} />,
  GeneralAnswer:      (r) => <GeneralAnswer data={r.data} />,
}
```

Adding a new component: register in `COMPONENT_REGISTRY` only. No routing changes.

### Design Tokens

Always dark — no media query conditional.

```css
--color-bg:       #0f0f11
--color-fg:       #f0ece6
--color-card:     #17171a
--color-primary:  #d4954a   /* 琥珀橙 */
--font-display:   "Shippori Mincho B1"
```

## Eval Infrastructure

| Path | Purpose |
|---|---|
| `infrastructure/supabase/migrations/002_request_log.sql` | Logs every request: plan_steps, intent, latency_ms |
| `tests/eval/datasets/plan_quality_v1.json` | 50+ cases × 3 locales |
| `tests/eval/test_plan_quality.py` | pydantic_evals harness; Iter 3 gate: ≥ baseline + 10pp |
| `tools/eval_scorer.py` | Batch LLM judge; writes `plan_quality_score` back to DB |
| `tools/eval_feedback_miner.py` | Mines `feedback(rating='bad')` → LLM prompt suggestions |
| `clients/python/seichijunrei_client.py` | Sync/async Python client for agent/CLI use |

## Design Rules

- One orchestration path: `ReActPlannerAgent → ExecutorAgent`
- ExecutorAgent is deterministic — no LLM calls
- Retrieval is structured-first — no semantic/vector search
- DB is source of truth for anime catalog — no hardcoded lists
- Frontend component additions require only a registry entry
- Auth is enforced at the CF Worker edge — container is not auth-aware
