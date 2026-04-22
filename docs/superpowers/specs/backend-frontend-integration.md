# ADR: Backend-Frontend Integration for Redesigned Frontend

## Status
Proposed

## Date
2026-04-22

## Context

The frontend has been redesigned with a full set of generative UI components
(PilgrimageGrid, NearbyMap, RoutePlannerWizard, Clarification) operating on
typed domain models (`frontend/lib/types/domain.ts`). During development, the
frontend was wired to MSW mock data (`frontend/lib/mock-data.ts`) that defines
the "contract" -- the exact JSON shapes the frontend parses and renders.

This ADR documents the gaps between what the backend currently returns and what
the frontend expects, then defines architecture decisions and an implementation
plan to close those gaps.

## Current Architecture

```
User text
    |
    v
FastAPI (/v1/runtime or /v1/runtime/stream)
    |
    v
RuntimeAPI.handle()
    |
    v
run_pipeline() --> ReActPlannerAgent (LLM) --> ExecutionPlan
                                                   |
                                                   v
                                             ExecutorAgent (deterministic)
                                               |         |          |
                                        handler/*   handler/*   handler/*
                                               |         |          |
                                        context[tool] = step_result.data
                                                   |
                                                   v
                                        _build_output(result, context, primary_tool)
                                                   |
                                                   v
                                             PipelineResult
                                                   |
                                                   v
                                        pipeline_result_to_public_response()
                                        (response_builder.py)
                                                   |
                                                   v
                                         PublicAPIResponse
                                                   |
                                    +--------------+---------------+
                                    |                              |
                                    v                              v
                              JSON response               SSE event stream
                         (/v1/runtime)               (/v1/runtime/stream)
```

### Current response building process

1. Each handler returns `{"tool": ..., "success": ..., "data": {...}}`.
2. `ExecutorAgent._execute_step()` stores `step_result.data` in `context[tool_name]`.
3. `_build_output()` reads context entries and copies them into `final_output`:
   - `output["results"] = context["search_bangumi"]` or `context["search_nearby"]`
   - `output["route"] = context["plan_route"]` or `context["plan_selected"]`
   - For `clarify`: copies `question`, `options` into output -- but NOT as `data` sub-keys
4. `pipeline_result_to_public_response()` copies `final_output` into `PublicAPIResponse.data`:
   ```python
   data={
       k: final_output[k]
       for k in ("results", "route")
       if final_output.get(k) is not None
   },
   ```
   **Only "results" and "route" are copied.** Everything else is dropped.

## Problem Statement

There are 10 gaps between what the frontend expects and what the backend
currently returns, grouped by severity.

### P0 -- Blocks integration (frontend renders nothing or crashes)

**Gap 1: `image` vs `screenshot_url` in `get_points_by_bangumi`**

The `points` table stores images in a column called `image`. The SQL agent
(`_POINT_RUNTIME_COLUMNS`) correctly aliases `p.image AS screenshot_url`, and
so does `search_points_by_location()` in `points.py`. However,
`get_points_by_bangumi()` uses `SELECT *`, which returns the raw column name
`image` -- not `screenshot_url`. The frontend type `PilgrimagePoint` expects
`screenshot_url`.

- **Impact:** `plan_selected` handler calls `db.points.get_points_by_ids()`
  which also uses `SELECT p.*` -- same problem.
- **Where it breaks:** Any `plan_selected` route or any code path that
  bypasses the SQL agent (direct repository calls).

**Gap 2: Missing `title`/`title_cn` in `get_points_by_bangumi` and
`get_points_by_ids`**

The `points` table has no `title` or `title_cn` columns -- those live in the
`bangumi` table. The SQL agent joins `bangumi b ON p.bangumi_id = b.id` and
selects `b.title, b.title_cn`. But the repository methods
`get_points_by_bangumi()` and `get_points_by_ids()` use `SELECT *` / `SELECT
p.*` with no JOIN, so the returned rows lack anime metadata.

- **Impact:** Frontend `PilgrimagePoint.title` and `PilgrimagePoint.title_cn`
  are always `undefined` for `plan_selected` routes.

**Gap 3: `response_builder` drops clarify data**

The `pipeline_result_to_public_response()` function copies only `results` and
`route` from `final_output` into `data`. For a clarify intent, `_build_output`
sets `output["options"]`, `output["intent"]`, `output["status"]` at the
top-level of `final_output` -- but `response_builder` never copies these into
`PublicAPIResponse.data`.

Result: `PublicAPIResponse.data = {}` for clarify responses. Frontend expects:
```typescript
data: {
  intent: "clarify",
  confidence: 0.85,
  status: "needs_clarification",
  message: "...",
  question: "...",
  options: ["A", "B"],
  candidates?: ClarifyCandidate[]
}
```

### P1 -- UX degradation (feature partially works but looks broken)

**Gap 4: No `ClarifyCandidate` model in backend**

Frontend defines `ClarifyCandidate` with `{title, cover_url, spot_count,
city}`. The backend clarify handler (`answer_question.py:execute_clarify`)
returns only `{question, options, status}`. There is no mechanism to look up
bangumi metadata (cover art, spot count, city) for the options.

- **Impact:** Clarification cards render without cover art or spot counts.

**Gap 5: Missing `question` in clarify `data`**

Even if Gap 3 is fixed, `_build_output` sets `output["message"] = cl_p.get("question")`
at the top level but does NOT set a separate `question` key inside the data
dict. Frontend `isClarifyData()` checks for `"question" in data`.

**Gap 6: Popular bangumi endpoint returns `id` instead of `bangumi_id`**

`BangumiRepository.list_popular()` selects `id, title, title_cn, ...`. The
frontend MSW mock and `PopularBangumiEntry` interface expect `bangumi_id`. The
column comes back as `id` (the raw SQL column name).

- **Where:** `frontend/lib/api/client.ts` line 62: `PopularBangumiEntry.bangumi_id`
- **Where:** `frontend/mocks/handlers.ts` line 104: `{ bangumi_id: "115908", ... }`
- **Backend:** `bangumi.py:list_popular()` line 46: `SELECT id, title, ...`

### P2 -- SSE enhancement (streaming UX incomplete)

**Gap 7: SSE clarify step events lack `question`/`options`**

Frontend `sendMessageStream()` (runtime.ts lines 237-241) watches for
`payload.tool === "clarify"` step events and extracts `payload.question` and
`payload.options`. The SSE `on_step` callback receives the raw `step_result.data`
dict which DOES have `question` and `options`. However, it is emitted as
nested `data: {question, options}` inside the SSE payload `{tool, status, data}`.
The frontend extracts from the root payload level, not from `data`.

**Gap 8: SSE clarify step events lack `candidates`**

Even after fixing Gap 7, the SSE step event does not include `candidates`.

### P3 -- Verification gaps (not visible but risky)

**Gap 9: `get_points_by_ids` does not alias coordinates**

`get_points_by_ids()` uses `SELECT p.*` which returns `latitude`/`longitude`
directly. This is fine when the point has those columns populated. But if a
point only has the `location` geography column (no lat/lng), the `COALESCE`
pattern from the SQL agent is not applied. The frontend always expects
`latitude`/`longitude` to be non-null numbers.

**Gap 10: Route optimization receives un-aliased rows from `get_points_by_ids`**

When `plan_selected` is used, the handler fetches rows via
`db.points.get_points_by_ids()` then passes them directly to
`optimize_route()`. These rows have `image` (not `screenshot_url`) and lack
`title`/`title_cn`. The `rewrite_image_urls()` helper checks for
`row.get("screenshot_url")` -- so it silently does nothing because the key
does not exist. The route result then includes points with the wrong field
name.

## Decision

### Architecture Decisions

#### AD-1: Enrich point queries with bangumi metadata via SQL JOIN

**Decision:** Modify `PointsRepository.get_points_by_bangumi()` and
`PointsRepository.get_points_by_ids()` to use the same projection columns as
the SQL agent (`_POINT_RUNTIME_COLUMNS`) with a `LEFT JOIN bangumi b ON
p.bangumi_id = b.id`.

**Rationale:** The SQL agent already does this correctly for all search paths.
The repository methods are an escape hatch used by the `plan_selected` handler
and by the `get_points_by_bangumi` direct path. They should return the same
shape.

**Alternatives considered:**
1. **Post-process enrichment in the handler:** Would require a separate bangumi
   lookup per unique bangumi_id. More round-trips, more code. Rejected.
2. **Create a DB view:** Clean but adds migration complexity and makes the
   column projection implicit. Rejected for now -- JOIN is sufficient.

#### AD-2: Standardize column naming at the repository layer

**Decision:** All repository SELECT queries that return point data must alias
`p.image AS screenshot_url` and use `COALESCE(p.latitude,
ST_Y(p.location::geometry)) AS latitude` / `COALESCE(p.longitude,
ST_X(p.location::geometry)) AS longitude`.

**Rationale:** The frontend contract (`PilgrimagePoint`) has a single field
name. Aliasing at the SQL level is zero-cost and prevents field-name mismatch
bugs.

#### AD-3: Expand response_builder data copying for clarify intent

**Decision:** In `pipeline_result_to_public_response()`, when `result.intent
== "clarify"`, copy clarify-specific keys (`question`, `options`, `candidates`,
`confidence`, `status`, `intent`, `message`) from `final_output` into
`PublicAPIResponse.data`.

**Rationale:** The response_builder currently has a hard-coded allowlist of
`("results", "route")` for data copying. This was safe when only search and
route intents existed. Clarify was added later but the builder was not updated.
Expanding it is safe because it only adds keys the frontend already expects.

**Why not change `_build_output` instead:** `_build_output` already sets the
correct data -- it just gets dropped by response_builder. Fixing at the
response_builder level keeps the builder as the single point of contract
enforcement.

#### AD-4: Introduce ClarifyCandidate model in backend

**Decision:** Add a `ClarifyCandidate` Pydantic model to `agents/models.py`:

```python
class ClarifyCandidate(BaseModel):
    """A candidate anime in a clarification response."""
    title: str
    cover_url: str | None = None
    spot_count: int = 0
    city: str = ""
```

**Rationale:** Matches the frontend `ClarifyCandidate` type exactly. Provides
type safety for the clarify enrichment pipeline.

#### AD-5: Enrich clarify responses with bangumi metadata

**Decision:** Add enrichment in the `execute_clarify` handler (not
response_builder). After building the question/options, look up each option
title in the bangumi table to get `cover_url`, `points_count`, `city`.

**Rationale:** The handler has access to `db` and is the natural place to do
data enrichment. The response_builder should remain a thin mapper, not a data
fetcher.

**Implementation:** The handler already receives `db` as a parameter. When the
options are anime titles (which they always are for title disambiguation), query
`bangumi` for each title to get cover_url, points_count, city.

#### AD-6: Standardize field naming in popular bangumi endpoint

**Decision:** Change `list_popular()` SQL to alias `id AS bangumi_id`.

**Rationale:** Frontend expects `bangumi_id`. The backend MSW mock already uses
`bangumi_id`. The actual column is `id` but the frontend contract says
`bangumi_id`. Aliasing at the SQL layer is the cheapest fix.

## Implementation Spec

### Phase 1: Critical Fixes (P0 -- blocks integration)

#### Card B-1: Fix `image` -> `screenshot_url` and add bangumi JOIN to point repository queries

**Scope:** Modify `PointsRepository.get_points_by_bangumi()` and
`PointsRepository.get_points_by_ids()` to use explicit column projection with
aliasing and a bangumi JOIN.

**Files changed:**
- `backend/infrastructure/supabase/repositories/points.py`

**Change (get_points_by_bangumi):**

Replace:
```python
async def get_points_by_bangumi(self, bangumi_id: str) -> list[Row]:
    return await self._pool.fetch(
        "SELECT * FROM points WHERE bangumi_id = $1 ORDER BY episode, time_seconds",
        bangumi_id,
    )
```

With:
```python
_REPO_POINT_COLUMNS = (
    "p.id, p.bangumi_id, p.name, p.name_cn, p.episode, p.time_seconds, "
    "p.image AS screenshot_url, p.origin, "
    "COALESCE(p.latitude, ST_Y(p.location::geometry)) AS latitude, "
    "COALESCE(p.longitude, ST_X(p.location::geometry)) AS longitude, "
    "b.title, b.title_cn"
)

async def get_points_by_bangumi(self, bangumi_id: str) -> list[Row]:
    return await self._pool.fetch(
        f"SELECT {_REPO_POINT_COLUMNS} "
        f"FROM points p LEFT JOIN bangumi b ON p.bangumi_id = b.id "
        f"WHERE p.bangumi_id = $1 ORDER BY p.episode, p.time_seconds",
        bangumi_id,
    )
```

**Change (get_points_by_ids):**

Replace:
```python
rows = await self._pool.fetch(
    """
    SELECT p.*
    FROM points p
    JOIN unnest($1::text[]) WITH ORDINALITY AS requested(id, ord)
      ON p.id = requested.id
    ORDER BY requested.ord
    """,
    point_ids,
)
```

With:
```python
rows = await self._pool.fetch(
    f"""
    SELECT {_REPO_POINT_COLUMNS}
    FROM points p
    LEFT JOIN bangumi b ON p.bangumi_id = b.id
    JOIN unnest($1::text[]) WITH ORDINALITY AS requested(id, ord)
      ON p.id = requested.id
    ORDER BY requested.ord
    """,
    point_ids,
)
```

**AC:**
- [ ] Happy path: `get_points_by_bangumi("115908")` returns rows with `screenshot_url` key (not `image`) and `title`/`title_cn` from bangumi table -> unit
- [ ] Happy path: `get_points_by_ids(["pt-1","pt-2"])` returns rows with `screenshot_url`, `title`, `title_cn` -> unit
- [ ] Null/empty: `get_points_by_bangumi("nonexistent")` returns empty list -> unit
- [ ] Null/empty: `get_points_by_ids([])` returns empty list -> unit
- [ ] Null/empty: Point with NULL `image` column returns `screenshot_url: None` -> unit
- [ ] Error path: Point with NULL lat/lng but valid `location` geography returns correct `latitude`/`longitude` via COALESCE -> integration

#### Card B-2: Fix response_builder to preserve clarify data

**Scope:** Expand `pipeline_result_to_public_response()` to copy clarify keys
into `PublicAPIResponse.data`.

**Files changed:**
- `backend/interfaces/response_builder.py`
- `backend/agents/executor_agent.py` (the `_build_output` function)

**Change (executor_agent.py `_build_output`):**

Current code for clarify (lines 236-239):
```python
if cl_p:
    output["intent"] = "clarify"
    output["message"] = cl_p.get("question", "")
    output["status"] = "needs_clarification"
    output["options"] = cl_p.get("options", [])
```

Change to also store a structured `clarify` key that response_builder can copy:
```python
if cl_p:
    output["intent"] = "clarify"
    output["message"] = cl_p.get("question", "")
    output["status"] = "needs_clarification"
    output["options"] = cl_p.get("options", [])
    output["clarify"] = {
        "intent": "clarify",
        "confidence": 1.0,
        "status": "needs_clarification",
        "message": cl_p.get("question", ""),
        "question": cl_p.get("question", ""),
        "options": cl_p.get("options", []),
        "candidates": cl_p.get("candidates", []),
    }
```

**Change (response_builder.py):**

Current data-copy code (lines 49-53):
```python
data={
    k: final_output[k]
    for k in ("results", "route")
    if final_output.get(k) is not None
},
```

Change to:
```python
data=_build_response_data(final_output, result.intent),
```

Add helper:
```python
_SEARCH_DATA_KEYS = ("results", "route")

def _build_response_data(
    final_output: dict[str, object],
    intent: str,
) -> dict[str, object]:
    """Extract the data payload from final_output based on intent."""
    if intent == "clarify":
        clarify = final_output.get("clarify")
        if isinstance(clarify, dict):
            return dict(clarify)
        # Fallback: build from top-level keys
        return {
            "intent": "clarify",
            "confidence": 1.0,
            "status": final_output.get("status", "needs_clarification"),
            "message": str(final_output.get("message", "")),
            "question": str(final_output.get("message", "")),
            "options": final_output.get("options", []),
        }
    return {
        k: final_output[k]
        for k in _SEARCH_DATA_KEYS
        if final_output.get(k) is not None
    }
```

**AC:**
- [ ] Happy path: Clarify response `data` contains `question`, `options`, `status: "needs_clarification"`, `intent: "clarify"` -> unit
- [ ] Happy path: Search response `data` still contains `results` key -> unit
- [ ] Happy path: Route response `data` still contains `route` key -> unit
- [ ] Null/empty: Clarify with empty options returns `data.options = []` -> unit
- [ ] Error path: Clarify with no `clarify` key in final_output falls back to top-level extraction -> unit

#### Card B-3: Fix `_build_output` to set `question` key in clarify output

**Scope:** Ensure the clarify output in `_build_output` includes the `question`
key so `isClarifyData()` type guard succeeds.

**Files changed:**
- `backend/agents/executor_agent.py` (covered by B-2 changes)

This is subsumed by Card B-2. The `output["clarify"]` dict includes `question`
as a dedicated key.

**AC:**
- [ ] Happy path: `isClarifyData(response.data)` returns `true` when backend returns a clarify intent -> api

### Phase 2: UX Enhancement (P1)

#### Card B-4: Create ClarifyCandidate Pydantic model

**Scope:** Add `ClarifyCandidate` to shared agent models.

**Files changed:**
- `backend/agents/models.py`

**Change:** Add after the existing `TimedItinerary` class:

```python
class ClarifyCandidate(BaseModel):
    """A candidate anime in a clarification response."""

    title: str
    cover_url: str | None = None
    spot_count: int = 0
    city: str = ""
```

**AC:**
- [ ] Happy path: `ClarifyCandidate(title="テスト", cover_url="https://...", spot_count=10, city="京都")` validates -> unit
- [ ] Null/empty: `ClarifyCandidate(title="テスト")` defaults: `cover_url=None, spot_count=0, city=""` -> unit
- [ ] Error path: `ClarifyCandidate()` (missing title) raises `ValidationError` -> unit

#### Card B-5: Enrich clarify handler with candidate metadata

**Scope:** When the clarify handler returns options that are anime titles, look
up bangumi metadata for each to build `ClarifyCandidate` objects.

**Files changed:**
- `backend/agents/handlers/answer_question.py`
- `backend/infrastructure/supabase/repositories/bangumi.py` (add `find_bangumi_by_titles` batch query)

**Change (bangumi.py):** Add batch title lookup method:

```python
async def find_bangumi_by_titles(
    self, titles: list[str]
) -> list[dict[str, object]]:
    """Find bangumi metadata for a list of titles (by exact or ILIKE match)."""
    if not titles:
        return []
    # Build a CTE of requested titles, then LEFT JOIN to bangumi
    rows = await self._pool.fetch(
        """
        SELECT b.id AS bangumi_id, b.title, b.title_cn,
               b.cover_url, b.points_count, b.city
        FROM bangumi b
        WHERE b.title = ANY($1) OR b.title_cn = ANY($1)
        """,
        titles,
    )
    return [dict(r) for r in rows]
```

**Change (answer_question.py `execute_clarify`):**

```python
async def execute_clarify(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    params = step.params or {}
    question = params.get("question")
    if not isinstance(question, str):
        question = ""
    raw_options = params.get("options")
    options: list[str] = (
        [str(o) for o in raw_options if isinstance(o, str)]
        if isinstance(raw_options, list)
        else []
    )

    # Enrich with bangumi metadata when DB is available
    candidates: list[dict[str, object]] = []
    from backend.infrastructure.supabase.client import SupabaseClient
    if isinstance(db, SupabaseClient) and options:
        bangumi_rows = await db.bangumi.find_bangumi_by_titles(options)
        title_map: dict[str, dict[str, object]] = {}
        for row in bangumi_rows:
            for key in ("title", "title_cn"):
                val = row.get(key)
                if isinstance(val, str) and val:
                    title_map[val] = row
        for opt in options:
            meta = title_map.get(opt, {})
            candidates.append({
                "title": opt,
                "cover_url": meta.get("cover_url"),
                "spot_count": int(meta.get("points_count", 0) or 0),
                "city": str(meta.get("city", "") or ""),
            })

    return {
        "tool": "clarify",
        "success": True,
        "data": {
            "question": question,
            "options": options,
            "candidates": candidates,
            "status": "needs_clarification",
        },
    }
```

**AC:**
- [ ] Happy path: Clarify for "涼宮ハルヒ" returns candidates with `cover_url`, `spot_count > 0`, `city` from bangumi table -> integration
- [ ] Null/empty: Clarify with options that match no bangumi returns candidates with `cover_url: null, spot_count: 0, city: ""` -> unit
- [ ] Null/empty: Clarify with empty options returns `candidates: []` -> unit
- [ ] Error path: Clarify when `db` is not SupabaseClient (mock) returns candidates as empty list, no crash -> unit

#### Card B-6: Fix popular bangumi field naming

**Scope:** Alias `id` as `bangumi_id` in `list_popular()` SQL.

**Files changed:**
- `backend/infrastructure/supabase/repositories/bangumi.py`

**Change:**

Current (line 46):
```python
"""SELECT id, title, title_cn, cover_url, city, points_count, rating
```

Change to:
```python
"""SELECT id AS bangumi_id, title, title_cn, cover_url, city, points_count, rating
```

**AC:**
- [ ] Happy path: `GET /v1/bangumi/popular` response items have `bangumi_id` key (not `id`) -> api
- [ ] Null/empty: `GET /v1/bangumi/popular` with no bangumi in DB returns `{"bangumi": []}` -> api
- [ ] Error path: `GET /v1/bangumi/popular?limit=0` returns 422 -> api

#### Card B-7: Verify TimedItinerary completeness for plan_selected

**Scope:** Verify that `plan_selected` routes produce a complete
`timed_itinerary` with all fields the frontend expects.

**Files changed:**
- `backend/agents/handlers/plan_selected.py` (verify, minor fix if needed)
- `backend/agents/handlers/_helpers.py` (verify `rewrite_image_urls` works with aliased rows)

After Card B-1, `get_points_by_ids()` returns rows with `screenshot_url`
instead of `image`. Verify that `rewrite_image_urls()` and `optimize_route()`
still work correctly with these aliased rows.

**AC:**
- [ ] Happy path: `plan_selected` with 3+ valid point IDs returns `data.timed_itinerary` with `stops`, `legs`, `total_minutes`, `export_google_maps_url` -> integration
- [ ] Happy path: `plan_selected` result points have `screenshot_url` (not `image`) and `title`/`title_cn` -> integration
- [ ] Null/empty: `plan_selected` with empty `point_ids` returns error -> unit
- [ ] Error path: `plan_selected` with non-existent point IDs returns error or empty route -> integration

### Phase 3: SSE Enhancement (P2)

#### Card B-8: Emit clarify step data at root level in SSE events

**Scope:** Flatten clarify data (`question`, `options`, `candidates`) into the
root of the SSE step event payload so the frontend can extract them.

**Files changed:**
- `backend/interfaces/routes/runtime.py` (the `on_step` callback)

**Change:**

Current `on_step` callback (lines 52-68):
```python
async def on_step(
    tool: str,
    status: str,
    data: dict[str, object],
    thought: str = "",
    observation: str = "",
) -> None:
    await emit(
        "step",
        {
            "tool": tool,
            "status": status,
            "thought": thought,
            "observation": observation,
            "data": data,
        },
    )
```

Change to also flatten clarify keys to root level:
```python
async def on_step(
    tool: str,
    status: str,
    data: dict[str, object],
    thought: str = "",
    observation: str = "",
) -> None:
    payload: dict[str, object] = {
        "tool": tool,
        "status": status,
        "thought": thought,
        "observation": observation,
        "data": data,
    }
    # Flatten clarify-specific keys to root for frontend extraction
    if tool == "clarify" and status == "done" and isinstance(data, dict):
        for key in ("question", "options", "candidates"):
            if key in data:
                payload[key] = data[key]
    await emit("step", payload)
```

**AC:**
- [ ] Happy path: SSE stream for a clarify query includes a `step` event with `tool: "clarify"`, `question`, `options` at root level -> api
- [ ] Happy path: SSE stream for a clarify query includes `candidates` at root level when available -> api
- [ ] Null/empty: SSE stream for a non-clarify query does NOT flatten clarify keys -> unit
- [ ] Error path: SSE stream correctly emits `done` event after clarify step -> api

## Data Flow (After Changes)

```
User text
    |
    v
FastAPI (/v1/runtime or /v1/runtime/stream)
    |
    v
RuntimeAPI.handle()
    |
    v
run_pipeline() --> ReActPlannerAgent (LLM) --> ExecutionPlan
                                                   |
                                                   v
                                             ExecutorAgent (deterministic)
                                               |         |          |          |
                            resolve_anime    search_*   plan_*    clarify
                                               |         |          |
                                      (retriever/SQL)   (repo)   (handler)
                                               |         |          |
                         +---------+-----------+---------+-----+----+--------+
                         |         |                            |             |
                   SQL Agent     Points Repo            clarify handler    bangumi
                   (JOIN!)    *** (JOIN!) ***          *** (enriched!) ***  lookup
                         |         |                            |             |
                         |   screenshot_url                candidates[]       |
                         |   title, title_cn              cover_url, city     |
                         |         |                     spot_count           |
                         +---------+---+----+----+---------+----+------------+
                                       |         |              |
                                context[tool] = step_result.data
                                       |
                                       v
                            _build_output(result, context, primary_tool)
                            *** output["clarify"] = {question, options, candidates} ***
                                       |
                                       v
                                 PipelineResult
                                       |
                                       v
                        pipeline_result_to_public_response()
                        *** _build_response_data() handles clarify ***
                                       |
                                       v
                                PublicAPIResponse
                                       |
                        +--------------+------------------+
                        |                                 |
                        v                                 v
                  JSON response                    SSE event stream
             (/v1/runtime)                    (/v1/runtime/stream)
                                              *** clarify keys flattened ***
```

## API Contract (Final)

### POST /v1/runtime (intent: search_bangumi)

```json
{
  "success": true,
  "status": "ok",
  "intent": "search_bangumi",
  "session_id": "abc123",
  "message": "找到了「響け！ユーフォニアム」的 156 个取景地...",
  "data": {
    "results": {
      "rows": [
        {
          "id": "pt-001",
          "name": "京都コンサートホール",
          "name_cn": "京都音乐厅",
          "episode": 1,
          "time_seconds": 85,
          "screenshot_url": "/img/points/115908/qys7fu.jpg?plan=h160",
          "bangumi_id": "115908",
          "latitude": 34.8892,
          "longitude": 135.7983,
          "title": "響け！ユーフォニアム",
          "title_cn": "吹响！上低音号",
          "origin": "anitabi"
        }
      ],
      "row_count": 156,
      "strategy": "sql",
      "status": "ok"
    }
  },
  "session": {
    "interaction_count": 1,
    "route_history_count": 0
  },
  "route_history": [],
  "errors": [],
  "ui": { "component": "PilgrimageGrid" }
}
```

### POST /v1/runtime (intent: search_nearby)

```json
{
  "success": true,
  "status": "ok",
  "intent": "search_nearby",
  "session_id": "abc123",
  "message": "在宇治市 1km 范围内找到了 8 个动漫取景地。",
  "data": {
    "results": {
      "rows": [
        {
          "id": "pt-nb-001",
          "name": "宇治橋",
          "name_cn": "宇治桥",
          "episode": 2,
          "time_seconds": 125,
          "screenshot_url": "/img/points/115908/qys7fu.jpg?plan=h160",
          "bangumi_id": "115908",
          "latitude": 34.8847,
          "longitude": 135.8008,
          "title": "響け！ユーフォニアム",
          "title_cn": "吹响！上低音号",
          "distance_m": 120.5
        }
      ],
      "row_count": 8,
      "strategy": "geo",
      "status": "ok"
    }
  },
  "session": { "interaction_count": 1, "route_history_count": 0 },
  "route_history": [],
  "errors": [],
  "ui": { "component": "NearbyMap" }
}
```

### POST /v1/runtime (intent: clarify)

```json
{
  "success": true,
  "status": "ok",
  "intent": "clarify",
  "session_id": "abc123",
  "message": "找到了多部相关作品，请确认你想查找哪一部。",
  "data": {
    "intent": "clarify",
    "confidence": 1.0,
    "status": "needs_clarification",
    "message": "找到了多部相关作品，请确认你想查找哪一部。",
    "question": "どちらの作品ですか？",
    "options": ["涼宮ハルヒの憂鬱", "涼宮ハルヒの消失"],
    "candidates": [
      {
        "title": "涼宮ハルヒの憂鬱",
        "cover_url": "https://image.anitabi.cn/bangumi/485.jpg",
        "spot_count": 134,
        "city": "西宮市"
      },
      {
        "title": "涼宮ハルヒの消失",
        "cover_url": null,
        "spot_count": 42,
        "city": "西宮市"
      }
    ]
  },
  "session": { "interaction_count": 1, "route_history_count": 0 },
  "route_history": [],
  "errors": [],
  "ui": { "component": "Clarification" }
}
```

### POST /v1/runtime (intent: plan_selected)

```json
{
  "success": true,
  "status": "ok",
  "intent": "plan_selected",
  "session_id": "abc123",
  "message": "已为你规划好巡礼路线...",
  "data": {
    "route": {
      "ordered_points": [
        {
          "id": "pt-001",
          "name": "宇治駅",
          "name_cn": null,
          "episode": 1,
          "time_seconds": 85,
          "screenshot_url": "/img/points/115908/qys7fu.jpg?plan=h160",
          "bangumi_id": "115908",
          "latitude": 34.8841,
          "longitude": 135.8007,
          "title": "響け！ユーフォニアム",
          "title_cn": "吹响！上低音号"
        }
      ],
      "point_count": 5,
      "status": "ok",
      "summary": {
        "point_count": 5,
        "with_coordinates": 5,
        "without_coordinates": 0,
        "clusters": 3,
        "total_minutes": 135,
        "total_distance_m": 2100.0
      },
      "timed_itinerary": {
        "stops": [
          {
            "cluster_id": "cl-001",
            "name": "宇治駅",
            "arrive": "09:00",
            "depart": "09:45",
            "dwell_minutes": 45,
            "lat": 34.8841,
            "lng": 135.8007,
            "photo_count": 3,
            "points": []
          }
        ],
        "legs": [
          {
            "from_id": "cl-001",
            "to_id": "cl-002",
            "mode": "walk",
            "duration_minutes": 10,
            "distance_m": 650.0
          }
        ],
        "total_minutes": 135,
        "total_distance_m": 2100.0,
        "spot_count": 17,
        "pacing": "normal",
        "start_time": "09:00",
        "export_google_maps_url": [
          "https://www.google.com/maps/dir/34.8841,135.8007/..."
        ],
        "export_ics": "BEGIN:VCALENDAR\r\n..."
      }
    }
  },
  "session": { "interaction_count": 2, "route_history_count": 1 },
  "route_history": [],
  "errors": [],
  "ui": { "component": "RoutePlannerWizard" }
}
```

### POST /v1/runtime/stream (SSE)

```
event: planning
data: {"event":"planning","status":"running"}

event: step
data: {"event":"step","tool":"resolve_anime","status":"running","thought":"","observation":"","data":{}}

event: step
data: {"event":"step","tool":"resolve_anime","status":"done","thought":"","observation":"","data":{"bangumi_id":"115908","title":"京吹"}}

event: step
data: {"event":"step","tool":"clarify","status":"done","thought":"","observation":"","data":{"question":"どちらの作品ですか？","options":["A","B"],"candidates":[...]},"question":"どちらの作品ですか？","options":["A","B"],"candidates":[...]}

event: done
data: {"event":"done","success":true,"status":"ok","intent":"clarify","message":"...","data":{...},...}
```

Note: For the clarify step event, `question`, `options`, and `candidates` are
flattened to the root of the payload (in addition to being nested inside `data`)
because the frontend SSE parser reads from the root level.

### GET /v1/bangumi/popular

```json
{
  "bangumi": [
    {
      "bangumi_id": "115908",
      "title": "響け！ユーフォニアム",
      "title_cn": "吹响！上低音号",
      "cover_url": "https://image.anitabi.cn/bangumi/115908.jpg?plan=h160",
      "city": "宇治市",
      "points_count": 156,
      "rating": 8.5
    }
  ]
}
```

## Migration Checklist

- [x] No new DB migrations needed -- all changes are column aliasing at the SQL
  level, not schema changes. The `image` column stays as `image` in the
  `points` table; we alias it to `screenshot_url` in SELECT projections.
- [x] No new indexes needed -- the JOIN uses `p.bangumi_id = b.id` which
  already has `idx_points_bangumi`.

## Verification Plan

1. `make lint` -- ruff passes
2. `make typecheck` -- mypy passes
3. `make test` -- all unit tests pass, including new tests for:
   - `test_points_repo_returns_screenshot_url`
   - `test_points_repo_returns_bangumi_metadata`
   - `test_response_builder_clarify_data`
   - `test_clarify_candidate_model`
   - `test_popular_bangumi_field_naming`
4. `make test-integration` -- all integration tests pass, including:
   - `test_plan_selected_returns_aliased_fields`
   - `test_clarify_enrichment_with_bangumi_metadata`
5. `make test-eval` -- planner evals pass gates (no planner changes)
6. Manual verification: Frontend with `MOCK_MODE=false` + local Supabase:
   - Search for "京吹" -> PilgrimageGrid renders with screenshots and titles
   - Search for "涼宮ハルヒ" -> Clarification renders with cover art and spot counts
   - Select points -> route plan -> RoutePlannerWizard renders with screenshots
   - Popular bangumi chips on welcome screen render correctly
   - SSE streaming works end-to-end for all intents

## Task Dependency Graph

```
B-1 (repo fix)  -----> B-7 (verify plan_selected)
      |
B-2 (response_builder) -----> B-8 (SSE clarify)
      |
B-4 (model) -----> B-5 (clarify enrichment) -----> B-8
      |
B-6 (popular naming) [independent]
```

**Wave 1 (parallel):** B-1, B-4, B-6
**Wave 2 (parallel):** B-2, B-5
**Wave 3 (parallel):** B-7, B-8

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Repository JOIN changes slow down queries | Low | Low | The JOIN on `bangumi(id)` primary key is indexed. No measurable impact expected for < 500 rows. |
| Breaking existing unit tests that mock raw `SELECT *` rows | Medium | Low | Tests that mock raw DB rows may need `screenshot_url` instead of `image`. Search-and-replace in test fixtures. |
| `_build_output` changes affect non-clarify intents | Low | High | The `if cl_p:` guard is unchanged. Non-clarify paths are not affected. Unit test each intent. |
| Clarify enrichment adds latency (extra DB round-trip) | Low | Low | `find_bangumi_by_titles` is a single batch query on an indexed table. < 5 ms for 2-3 titles. |
| SSE flattening breaks non-clarify step events | Low | Medium | The `if tool == "clarify" and status == "done"` guard prevents flattening for other tools. |

## Consequences

After this ADR is implemented:

1. Frontend can disable MSW mock mode and connect to the real backend
2. All 6 frontend domain type guards (`isSearchData`, `isRouteData`, `isClarifyData`, `isTimedRouteData`, `isQAData`) pass with real data
3. `PilgrimagePoint.screenshot_url` is always populated from real data
4. `PilgrimagePoint.title` / `title_cn` are always populated for anime-linked points
5. Clarification UI renders with cover art, spot counts, and city names
6. Popular bangumi chips on the welcome screen render correctly
7. SSE streaming works end-to-end for clarify intents
8. No database migrations required
9. No frontend code changes required -- the backend conforms to the frontend contract
