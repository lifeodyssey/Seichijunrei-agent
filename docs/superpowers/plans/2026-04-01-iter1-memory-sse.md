# Iter 1: Memory Context + Route Origin + SSE Streaming

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status (2026-04-03):** Landed in the codebase. Keep as historical rationale/checklist; use `docs/ARCHITECTURE.md` + `interfaces/public_api.py` for the current shape.

**Goal:** Make the planner session-aware, give route planning a real start point, and show users real-time step progress via SSE.

**Architecture:** Three independent backend features (context injection, route origin, SSE endpoint) plus one frontend feature (SSE client + StepTrace). F1a must land before F1b and F1c since both read from the context pipeline. F1d depends on F1c.

**Tech Stack:** Python / Pydantic AI / aiohttp 3.12+ / Next.js (static export) / TypeScript / Supabase

**Spec:** `docs/superpowers/specs/2026-04-01-frontend-memory-arch.md`

---

## File Map

| File | Change |
|------|--------|
| `agents/models.py` | Add `context_delta` field to interaction dict schema (type alias) |
| `agents/planner_agent.py` | `create_plan(context=None)` + prompt prefix injection |
| `agents/pipeline.py` | `run_pipeline(context=None)` passthrough |
| `interfaces/public_api.py` | `_extract_context_delta()`, `_build_context_block()`, inject into pipeline, store in session state |
| `agents/executor_agent.py` | `_nearest_neighbor_sort` → async + origin param; `_execute_plan_route` reads origin; `execute(on_step=None)` callback |
| `interfaces/http_service.py` | New `POST /v1/runtime/stream` SSE handler; CORS headers before `prepare()` |
| `frontend/lib/types.ts` | `SseStepEvent`, `steps` field on `ChatMessage` |
| `frontend/lib/api.ts` | `sendMessageStream()` using fetch + ReadableStream |
| `frontend/hooks/useChat.ts` | `send()` uses streaming path; thread `AbortController.signal` |
| `frontend/components/chat/MessageBubble.tsx` | `ThinkingBar` → `StepTrace` |
| `tests/unit/test_planner_agent.py` | Tests for context prefix injection |
| `tests/unit/test_executor_agent.py` | Tests for origin-aware sort and on_step callback |
| `tests/unit/test_public_api.py` | Tests for `_extract_context_delta` and `_build_context_block` |
| `tests/integration/test_http_service.py` | SSE endpoint smoke test |

---

## Task 1: F1a — context_delta extraction and context_block builder

**Files:**

- Modify: `interfaces/public_api.py`
- Test: `tests/unit/test_public_api.py`

- [ ] **Step 1.1: Write failing tests for `_extract_context_delta`**

```python
# tests/unit/test_public_api.py — add to existing file
from agents.executor_agent import StepResult
from agents.models import ExecutionPlan, PlanStep, ToolName
from agents.executor_agent import PipelineResult

def _make_pipeline_result(step_results):
    plan = ExecutionPlan(steps=[], reasoning="", locale="ja")
    return PipelineResult(intent="search_bangumi", plan=plan, step_results=step_results)

def test_extract_context_delta_from_resolve_anime():
    result = _make_pipeline_result([
        StepResult(tool="resolve_anime", success=True, data={"bangumi_id": "253", "title": "響け！ユーフォニアム"}),
    ])
    from interfaces.public_api import _extract_context_delta
    delta = _extract_context_delta(result)
    assert delta["bangumi_id"] == "253"
    assert delta["anime_title"] == "響け！ユーフォニアム"
    assert delta["location"] is None

def test_extract_context_delta_from_search_nearby():
    plan = ExecutionPlan(
        steps=[PlanStep(tool=ToolName.SEARCH_NEARBY, params={"location": "宇治"})],
        reasoning="", locale="ja",
    )
    result = PipelineResult(
        intent="search_nearby", plan=plan,
        step_results=[StepResult(tool="search_nearby", success=True, data={"rows": []})],
    )
    from interfaces.public_api import _extract_context_delta
    delta = _extract_context_delta(result)
    assert delta["location"] == "宇治"
    assert delta["bangumi_id"] is None

def test_extract_context_delta_empty_on_failure():
    result = _make_pipeline_result([
        StepResult(tool="resolve_anime", success=False, error="not found"),
    ])
    from interfaces.public_api import _extract_context_delta
    delta = _extract_context_delta(result)
    assert delta == {"bangumi_id": None, "anime_title": None, "location": None}
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
make test 2>&1 | grep "test_extract_context_delta"
```
Expected: `ImportError: cannot import name '_extract_context_delta'`

- [ ] **Step 1.3: Implement `_extract_context_delta` in public_api.py**

Add after the existing `_serialize_step_result` function (~line 447):

```python
def _extract_context_delta(result: PipelineResult) -> dict[str, Any]:
    """Extract context_delta from pipeline result for session state storage."""
    delta: dict[str, Any] = {"bangumi_id": None, "anime_title": None, "location": None}
    for step in result.step_results:
        if not step.success or not step.data:
            continue
        if step.tool == "resolve_anime":
            delta["bangumi_id"] = step.data.get("bangumi_id")
            delta["anime_title"] = step.data.get("title")
        elif step.tool == "search_bangumi" and delta["bangumi_id"] is None:
            delta["bangumi_id"] = step.data.get("bangumi_id")
    for plan_step in result.plan.steps:
        if plan_step.tool.value == "search_nearby" and plan_step.params.get("location"):
            delta["location"] = plan_step.params["location"]
            break
    return delta
```

- [ ] **Step 1.4: Run tests to verify they pass**

```bash
make test 2>&1 | grep "test_extract_context_delta"
```
Expected: 3 passed

- [ ] **Step 1.5: Write failing tests for `_build_context_block`**

```python
def test_build_context_block_from_interactions():
    interactions = [
        {"text": "京吹", "intent": "search_bangumi", "status": "ok", "success": True,
         "created_at": "2026-04-01T00:00:00", "context_delta": {"bangumi_id": "253", "anime_title": "響け！ユーフォニアム", "location": None}},
        {"text": "附近", "intent": "search_nearby", "status": "ok", "success": True,
         "created_at": "2026-04-01T00:01:00", "context_delta": {"bangumi_id": None, "anime_title": None, "location": "宇治"}},
    ]
    state = {"interactions": interactions, "last_intent": "search_nearby"}
    from interfaces.public_api import _build_context_block
    block = _build_context_block(state)
    assert block["current_bangumi_id"] == "253"
    assert block["current_anime_title"] == "響け！ユーフォニアム"
    assert block["last_location"] == "宇治"
    assert block["last_intent"] == "search_nearby"
    assert "253" in block["visited_bangumi_ids"]

def test_build_context_block_returns_none_when_empty():
    from interfaces.public_api import _build_context_block
    assert _build_context_block({"interactions": [], "last_intent": None}) is None
```

- [ ] **Step 1.6: Implement `_build_context_block`**

```python
def _build_context_block(session_state: dict[str, Any]) -> dict[str, Any] | None:
    """Scan recent interactions to build a context_block for the planner."""
    interactions = session_state.get("interactions") or []
    if not interactions:
        return None
    current_bangumi_id = None
    current_anime_title = None
    last_location = None
    visited_bangumi_ids: list[str] = []
    for interaction in reversed(interactions):
        delta = interaction.get("context_delta") or {}
        if current_bangumi_id is None and delta.get("bangumi_id"):
            current_bangumi_id = delta["bangumi_id"]
            current_anime_title = delta.get("anime_title")
        if last_location is None and delta.get("location"):
            last_location = delta["location"]
        if delta.get("bangumi_id") and delta["bangumi_id"] not in visited_bangumi_ids:
            visited_bangumi_ids.append(delta["bangumi_id"])
        if current_bangumi_id and last_location:
            break
    if not current_bangumi_id and not last_location:
        return None
    return {
        "current_bangumi_id": current_bangumi_id,
        "current_anime_title": current_anime_title,
        "last_location": last_location,
        "last_intent": session_state.get("last_intent"),
        "visited_bangumi_ids": visited_bangumi_ids,
    }
```

- [ ] **Step 1.7: Store context_delta in session state**

In `_build_updated_session_state()`, change the interaction record append to include `context_delta`:

```python
# Find the block that appends to new_interactions (around line 385)
# Change:
new_interactions.append({
    "text": request.text,
    "intent": response.intent,
    "status": response.status,
    "success": response.success,
    "created_at": datetime.now(UTC).isoformat(),
})
# To:
new_interactions.append({
    "text": request.text,
    "intent": response.intent,
    "status": response.status,
    "success": response.success,
    "created_at": datetime.now(UTC).isoformat(),
    "context_delta": result_context_delta or {},
})
```

Add `result_context_delta: dict | None = None` as parameter to `_build_updated_session_state()`.

Update the call site in `RuntimeAPI.handle()` to pass the extracted delta:

```python
context_delta = _extract_context_delta(result) if result else None
session_state = _build_updated_session_state(previous_state, request, response,
                                              result_context_delta=context_delta)
```

- [ ] **Step 1.8: Run all tests**

```bash
make test
```
Expected: all existing tests pass + new tests pass

- [ ] **Step 1.9: Commit**

```bash
git add interfaces/public_api.py tests/unit/test_public_api.py
git commit -m "feat(memory): extract context_delta from pipeline result into session state"
```

---

## Task 2: F1a — planner context injection

**Files:**

- Modify: `agents/planner_agent.py`, `agents/pipeline.py`, `interfaces/public_api.py`
- Test: `tests/unit/test_planner_agent.py`

- [ ] **Step 2.1: Write failing test for context-aware prompt**

```python
# tests/unit/test_planner_agent.py
import pytest
from unittest.mock import AsyncMock, patch
from agents.planner_agent import ReActPlannerAgent, _format_context_block

def test_format_context_block_full():
    block = {
        "current_bangumi_id": "253",
        "current_anime_title": "響け！ユーフォニアム",
        "last_location": "宇治",
        "last_intent": "search_bangumi",
        "visited_bangumi_ids": ["253"],
    }
    result = _format_context_block(block)
    assert "[context]" in result
    assert "anime: 響け！ユーフォニアム (bangumi_id: 253)" in result
    assert "last_location: 宇治" in result
    assert "last_intent: search_bangumi" in result

def test_format_context_block_minimal():
    block = {"current_bangumi_id": None, "current_anime_title": None,
             "last_location": "京都", "last_intent": None, "visited_bangumi_ids": []}
    result = _format_context_block(block)
    assert "last_location: 京都" in result
    assert "anime:" not in result
```

- [ ] **Step 2.2: Run to verify failure**

```bash
pytest tests/unit/test_planner_agent.py -v 2>&1 | tail -10
```
Expected: `ImportError: cannot import name '_format_context_block'`

- [ ] **Step 2.3: Add `_format_context_block` and update create_plan**

In `agents/planner_agent.py`, add below the system prompt constant:

```python
def _format_context_block(context: dict[str, Any]) -> str:
    lines = ["[context]"]
    if context.get("current_anime_title"):
        bid = context.get("current_bangumi_id", "")
        lines.append(f"anime: {context['current_anime_title']} (bangumi_id: {bid})")
    if context.get("last_location"):
        lines.append(f"last_location: {context['last_location']}")
    if context.get("last_intent"):
        lines.append(f"last_intent: {context['last_intent']}")
    ids = context.get("visited_bangumi_ids") or []
    if ids:
        lines.append(f"visited_ids: {', '.join(ids)}")
    return "\n".join(lines)
```

Update `create_plan` signature and body:

```python
async def create_plan(
    self, text: str, locale: str = "ja", context: dict[str, Any] | None = None
) -> ExecutionPlan:
    """Generate an ExecutionPlan from user text."""
    context_prefix = _format_context_block(context) + "\n" if context else ""
    prompt = f"{context_prefix}[locale={locale}] {text}"
    result = await self._agent.run(prompt)
    return result.output
```

- [ ] **Step 2.4: Thread context through pipeline.py**

```python
# agents/pipeline.py — update run_pipeline signature
async def run_pipeline(
    text: str,
    db: Any,
    *,
    model: Any = None,
    locale: str = "ja",
    context: dict[str, Any] | None = None,
) -> PipelineResult:
    plan = await ReActPlannerAgent(model).create_plan(text, locale=locale, context=context)
    ...
```

- [ ] **Step 2.5: Inject context from session state in public_api.py**

In `RuntimeAPI.handle()`, build the context block from `previous_state` before calling `run_pipeline`:

```python
previous_state = await _load_session_state(session_id)
context_block = _build_context_block(_normalize_session_state(previous_state))

result = await run_pipeline(
    request.text,
    self._db,
    model=request.model,
    locale=request.locale,
    context=context_block,
)
```

- [ ] **Step 2.6: Run all tests**

```bash
make test
```

- [ ] **Step 2.7: Commit**

```bash
git add agents/planner_agent.py agents/pipeline.py interfaces/public_api.py tests/unit/test_planner_agent.py
git commit -m "feat(memory): inject session context_block into planner prompt"
```

---

## Task 3: F1b — route origin + async nearest-neighbor sort

**Files:**

- Modify: `agents/executor_agent.py`, `agents/planner_agent.py` (system prompt)
- Test: `tests/unit/test_executor_agent.py`

- [ ] **Step 3.1: Write failing tests for origin-aware sort**

```python
# tests/unit/test_executor_agent.py — add tests
import pytest
from agents.executor_agent import _nearest_neighbor_sort

ROWS = [
    {"id": "a", "latitude": "35.0", "longitude": "135.8"},  # ~宇治
    {"id": "b", "latitude": "34.9", "longitude": "135.7"},  # ~木津川
    {"id": "c", "latitude": "35.1", "longitude": "135.9"},  # ~山科
]

@pytest.mark.asyncio
async def test_nearest_neighbor_sort_no_origin_returns_first_as_start():
    result = await _nearest_neighbor_sort(ROWS)
    assert result[0]["id"] == "a"  # first row is start when no origin

@pytest.mark.asyncio
async def test_nearest_neighbor_sort_with_origin_starts_from_nearest():
    # "木津川" is closest to row b
    with patch("agents.executor_agent.resolve_location", return_value=(34.9, 135.7)):
        result = await _nearest_neighbor_sort(ROWS, origin="木津川駅")
    assert result[0]["id"] == "b"

@pytest.mark.asyncio
async def test_nearest_neighbor_sort_unknown_origin_falls_back():
    with patch("agents.executor_agent.resolve_location", return_value=None):
        result = await _nearest_neighbor_sort(ROWS, origin="UnknownPlace")
    assert result[0]["id"] == "a"  # fallback to first row

@pytest.mark.asyncio
async def test_nearest_neighbor_sort_no_coords_appended_at_end():
    rows_mixed = ROWS + [{"id": "d"}]  # no lat/lon
    result = await _nearest_neighbor_sort(rows_mixed)
    assert result[-1]["id"] == "d"
```

- [ ] **Step 3.2: Run to verify failure**

```bash
pytest tests/unit/test_executor_agent.py -k "nearest_neighbor" -v 2>&1 | tail -15
```
Expected: `TypeError: _nearest_neighbor_sort() is not a coroutine`

- [ ] **Step 3.3: Make `_nearest_neighbor_sort` async with origin support**

In `agents/executor_agent.py`, add import at top:

```python
from agents.sql_agent import resolve_location
```

Replace `_nearest_neighbor_sort` (currently lines 348-371):

```python
async def _nearest_neighbor_sort(
    rows: list[dict], origin: str | None = None
) -> list[dict]:
    """Sort points by nearest-neighbor heuristic. O(n²), fine for <100 points."""
    if len(rows) <= 1:
        return list(rows)
    with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]
    without_coords = [r for r in rows if not (r.get("latitude") and r.get("longitude"))]
    if not with_coords:
        return list(rows)

    # Resolve origin to starting coordinates
    start_coords: tuple[float, float] | None = None
    if origin:
        start_coords = await resolve_location(origin)

    if start_coords:
        # Find the point closest to origin as the first stop
        o_lat, o_lon = start_coords
        first_idx = min(
            range(len(with_coords)),
            key=lambda i: (float(with_coords[i]["latitude"]) - o_lat) ** 2
                        + (float(with_coords[i]["longitude"]) - o_lon) ** 2,
        )
        ordered = [with_coords.pop(first_idx)]
    else:
        ordered = [with_coords[0]]
        with_coords = with_coords[1:]

    remaining = with_coords
    while remaining:
        last = ordered[-1]
        last_lat, last_lon = float(last["latitude"]), float(last["longitude"])
        best_idx, best_dist = 0, float("inf")
        for i, c in enumerate(remaining):
            d = (float(c["latitude"]) - last_lat) ** 2 + (
                float(c["longitude"]) - last_lon
            ) ** 2
            if d < best_dist:
                best_dist, best_idx = d, i
        ordered.append(remaining.pop(best_idx))

    return ordered + without_coords
```

- [ ] **Step 3.4: Update `_execute_plan_route` to pass origin and await sort**

```python
async def _execute_plan_route(
    self, step: PlanStep, context: dict[str, Any]
) -> StepResult:
    query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
        ToolName.SEARCH_NEARBY.value
    )
    rows = (query_data or {}).get("rows", [])
    if not rows:
        return StepResult(tool="plan_route", success=False, error="No points to route")

    origin = step.params.get("origin") or context.get("last_location")
    ordered = await _nearest_neighbor_sort(rows, origin=origin)
    with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]
    return StepResult(
        tool="plan_route",
        success=True,
        data={
            "ordered_points": ordered,
            "point_count": len(ordered),
            "origin": origin,
            "status": "ok",
            "summary": {
                "point_count": len(ordered),
                "with_coordinates": len(with_coords),
                "without_coordinates": len(rows) - len(with_coords),
            },
        },
    )
```

- [ ] **Step 3.5: Pass last_location into executor context**

In `agents/executor_agent.py`, update `execute()` to receive context_block:

```python
async def execute(
    self,
    plan: ExecutionPlan,
    context_block: dict[str, Any] | None = None,
    on_step: "Callable[[str, str, dict], Awaitable[None]] | None" = None,
) -> PipelineResult:
    locale = plan.locale
    context: dict[str, Any] = {"locale": locale}
    if context_block:
        context["last_location"] = context_block.get("last_location")
    ...
```

Update `run_pipeline` in `agents/pipeline.py` to pass context_block to executor:

```python
result = await ExecutorAgent(db).execute(plan, context_block=context)
```

- [ ] **Step 3.6: Update planner system prompt for plan_route origin**

In `agents/planner_agent.py`, change the `plan_route` line in `PLANNER_SYSTEM_PROMPT`:

```
- plan_route(origin: str | None)
  Sort the results of a preceding search_bangumi step into an optimal walking order
  starting from `origin` (a station or landmark name).
  Use origin from the user's message or from context last_location.
  Leave origin null if neither is available.
  Only include this after a search_bangumi step.
```

- [ ] **Step 3.7: Run all tests**

```bash
make test
```

- [ ] **Step 3.8: Commit**

```bash
git add agents/executor_agent.py agents/pipeline.py agents/planner_agent.py tests/unit/test_executor_agent.py
git commit -m "feat(route): origin-aware nearest-neighbor sort for plan_route"
```

---

## Task 4: F1c — ExecutorAgent on_step callback

**Files:**

- Modify: `agents/executor_agent.py`
- Test: `tests/unit/test_executor_agent.py`

- [ ] **Step 4.1: Write failing test for on_step callback**

```python
@pytest.mark.asyncio
async def test_execute_calls_on_step_for_each_tool(mock_db):
    from agents.executor_agent import ExecutorAgent
    from agents.models import ExecutionPlan, PlanStep, ToolName

    plan = ExecutionPlan(
        steps=[PlanStep(tool=ToolName.ANSWER_QUESTION, params={"answer": "hi"})],
        reasoning="test", locale="ja",
    )
    events = []
    async def on_step(tool, status, data):
        events.append((tool, status))

    agent = ExecutorAgent(mock_db)
    await agent.execute(plan, on_step=on_step)

    assert ("answer_question", "running") in events
    assert ("answer_question", "done") in events
```

- [ ] **Step 4.2: Run to verify failure**

```bash
pytest tests/unit/test_executor_agent.py -k "on_step" -v 2>&1 | tail -10
```

- [ ] **Step 4.3: Add on_step to ExecutorAgent.execute()**

In `agents/executor_agent.py`, update the step execution loop inside `execute()`:

```python
async def execute(
    self,
    plan: ExecutionPlan,
    context_block: dict[str, Any] | None = None,
    on_step: Callable[[str, str, dict[str, Any]], Awaitable[None]] | None = None,
) -> PipelineResult:
    ...
    for step in plan.steps:
        handler = self._dispatch.get(step.tool)
        if handler is None:
            step_results.append(StepResult(tool=step.tool.value, success=False,
                                           error=f"Unknown tool: {step.tool}"))
            continue
        if on_step:
            await on_step(step.tool.value, "running", {})
        step_result = await handler(step, context)
        if on_step:
            await on_step(step.tool.value, "done", step_result.data or {})
        step_results.append(step_result)
        if step_result.success and step_result.data:
            context[step.tool.value] = step_result.data
    ...
```

Add import at top of file: `from collections.abc import Awaitable, Callable`

- [ ] **Step 4.4: Thread on_step through pipeline.py**

```python
# agents/pipeline.py
async def run_pipeline(
    text: str,
    db: Any,
    *,
    model: Any = None,
    locale: str = "ja",
    context: dict[str, Any] | None = None,
    on_step: "Callable | None" = None,
) -> PipelineResult:
    plan = await ReActPlannerAgent(model).create_plan(text, locale=locale, context=context)
    ...
    result = await ExecutorAgent(db).execute(plan, context_block=context, on_step=on_step)
    ...
```

- [ ] **Step 4.5: Run all tests**

```bash
make test
```

- [ ] **Step 4.6: Commit**

```bash
git add agents/executor_agent.py agents/pipeline.py tests/unit/test_executor_agent.py
git commit -m "feat(sse): add on_step progress callback to ExecutorAgent.execute()"
```

---

## Task 5: F1c — SSE HTTP endpoint

**Files:**

- Modify: `interfaces/http_service.py`
- Test: `tests/integration/test_http_service.py`

- [ ] **Step 5.1: Write failing integration test for SSE endpoint**

```python
# tests/integration/test_http_service.py — add test
import json
import pytest
from aiohttp.test_utils import TestClient, TestServer
from interfaces.http_service import create_app

@pytest.mark.asyncio
async def test_runtime_stream_emits_sse_events(mock_db, mock_settings):
    app = create_app(settings=mock_settings, db=mock_db)
    async with TestClient(TestServer(app)) as client:
        resp = await client.post(
            "/v1/runtime/stream",
            json={"text": "test", "locale": "ja"},
            headers={"Authorization": "Bearer test-key"},
        )
        assert resp.status == 200
        assert "text/event-stream" in resp.headers["Content-Type"]
        body = await resp.text()
        # Must contain at least one data: line and a done event
        assert "data:" in body
        assert '"event":"done"' in body or "event: done" in body
```

- [ ] **Step 5.2: Run to verify failure**

```bash
make test-integration 2>&1 | grep "runtime_stream" | tail -5
```
Expected: 404 or connection refused

- [ ] **Step 5.3: Implement `_handle_runtime_stream` in http_service.py**

Add after the existing `_handle_runtime` function:

```python
async def _handle_runtime_stream(request: web.Request) -> web.StreamResponse:
    """POST /v1/runtime/stream — SSE streaming pipeline execution."""
    try:
        raw_payload = await request.json()
    except Exception:
        raise web.HTTPBadRequest(reason="Invalid JSON")

    try:
        api_request = PublicAPIRequest.model_validate(raw_payload)
    except Exception as exc:
        raise web.HTTPUnprocessableEntity(reason=str(exc))

    runtime_api: RuntimeAPI = request.app[_RUNTIME_API_KEY]

    resp = web.StreamResponse()
    # Set CORS and SSE headers BEFORE prepare() — middleware runs after,
    # but headers set post-prepare() are ignored.
    resp.headers["Content-Type"] = "text/event-stream; charset=utf-8"
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    # Copy CORS headers from request context if available
    origin = request.headers.get("Origin", "*")
    resp.headers["Access-Control-Allow-Origin"] = origin
    resp.headers["Access-Control-Allow-Credentials"] = "true"

    await resp.prepare(request)

    async def emit(event: str, data: dict[str, Any]) -> None:
        line = f"data: {json.dumps({'event': event, **data}, ensure_ascii=False)}\n\n"
        await resp.write(line.encode("utf-8"))

    async def on_step(tool: str, status: str, data: dict[str, Any]) -> None:
        await emit("step", {"tool": tool, "status": status})

    try:
        # Emit planning event before execution
        await emit("planning", {"status": "running"})
        api_response = await runtime_api.handle(api_request, on_step=on_step)
        await emit("done", api_response.model_dump(mode="json"))
    except Exception as exc:
        await emit("error", {"message": str(exc)})
    finally:
        await resp.write_eof()

    return resp
```

Register the route in `create_app()` / `_build_app()` alongside existing routes:

```python
app.router.add_post("/v1/runtime/stream", _handle_runtime_stream)
```

- [ ] **Step 5.4: Thread on_step through RuntimeAPI.handle()**

Update `RuntimeAPI.handle()` signature to accept and forward `on_step`:

```python
async def handle(
    self,
    request: PublicAPIRequest,
    on_step: "Callable | None" = None,
) -> PublicAPIResponse:
    ...
    result = await run_pipeline(
        request.text,
        self._db,
        model=request.model,
        locale=request.locale,
        context=context_block,
        on_step=on_step,
    )
    ...
```

- [ ] **Step 5.5: Run all tests**

```bash
make test-integration
make test
```

- [ ] **Step 5.6: Commit**

```bash
git add interfaces/http_service.py interfaces/public_api.py tests/integration/test_http_service.py
git commit -m "feat(sse): add POST /v1/runtime/stream SSE endpoint"
```

---

## Task 6: F1d — Frontend SSE client and StepTrace

**Files:**

- Modify: `frontend/lib/types.ts`, `frontend/lib/api.ts`, `frontend/hooks/useChat.ts`, `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 6.1: Add SSE types to frontend/lib/types.ts**

```typescript
// Add to existing types
export interface StepEvent {
  tool: string;
  status: "running" | "done";
}

// Extend ChatMessage
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  response?: RuntimeResponse;
  loading?: boolean;
  timestamp: number;
  steps?: StepEvent[];   // NEW: accumulated SSE step events
}
```

- [ ] **Step 6.2: Implement sendMessageStream in frontend/lib/api.ts**

```typescript
export async function sendMessageStream(
  text: string,
  sessionId: string | null | undefined,
  locale: RuntimeRequest["locale"] | undefined,
  onStep: (tool: string, status: "running" | "done") => void,
  signal?: AbortSignal,
): Promise<RuntimeResponse> {
  const headers = await getAuthHeaders();
  const res = await fetch("/v1/runtime/stream", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ text, session_id: sessionId, locale }),
    signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Stream error: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const raw = line.slice("data:".length).trim();
      const parsed = JSON.parse(raw);
      if (parsed.event === "step") {
        onStep(parsed.tool, parsed.status);
      } else if (parsed.event === "done") {
        return parsed as RuntimeResponse;
      } else if (parsed.event === "error") {
        throw new Error(parsed.message ?? "Stream error");
      }
    }
  }
  throw new Error("Stream ended without done event");
}
```

- [ ] **Step 6.3: Update useChat.ts to use streaming**

```typescript
// frontend/hooks/useChat.ts — replace the send() body
const send = useCallback(async (text: string) => {
  if (!text.trim() || sending) return;

  const userMsg: ChatMessage = { id: nextId(), role: "user", text: text.trim(), timestamp: Date.now() };
  const placeholderId = nextId();
  const placeholder: ChatMessage = { id: placeholderId, role: "assistant", text: "", loading: true, steps: [], timestamp: Date.now() };

  setMessages(prev => [...prev, userMsg, placeholder]);
  setSending(true);

  try {
    abortRef.current = new AbortController();

    const response = await sendMessageStream(
      text.trim(),
      sessionId,
      locale,
      (tool, status) => {
        setMessages(prev => prev.map(m =>
          m.id === placeholderId
            ? { ...m, steps: [...(m.steps ?? []).filter(s => s.tool !== tool || status === "running"), { tool, status }] }
            : m,
        ));
      },
      abortRef.current.signal,
    );

    if (response.session_id) onSessionId(response.session_id);
    setMessages(prev => prev.map(m =>
      m.id === placeholderId
        ? { ...m, text: response.message, response, loading: false }
        : m,
    ));
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    setMessages(prev => prev.map(m =>
      m.id === placeholderId
        ? { ...m, text: `Error: ${(err as Error).message}`, loading: false }
        : m,
    ));
  } finally {
    setSending(false);
    abortRef.current = null;
  }
}, [sessionId, sending, onSessionId, locale]);
```

- [ ] **Step 6.4: Replace ThinkingBar with StepTrace in MessageBubble.tsx**

```tsx
// Replace ThinkingBar function with StepTrace
const STEP_LABELS: Record<string, string> = {
  resolve_anime: "动漫识别",
  search_bangumi: "搜索取景地",
  search_nearby: "搜索附近景点",
  plan_route: "规划路线",
  answer_question: "生成回答",
};

function StepTrace({ steps }: { steps: StepEvent[] }) {
  if (steps.length === 0) {
    // Fallback shimmer when no steps yet
    return (
      <div className="relative h-px w-16 overflow-hidden bg-[var(--color-border)]">
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(90deg, transparent, var(--color-primary), transparent)",
            animation: "shimmer 1.4s ease-in-out infinite",
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {steps.map(s => (
        <span
          key={s.tool}
          className="text-[10px] text-[var(--color-muted-fg)] transition-opacity"
          style={{ opacity: s.status === "done" ? 0.6 : 1 }}
        >
          {s.status === "done" ? "✓" : "●"}{" "}
          {STEP_LABELS[s.tool] ?? s.tool}
        </span>
      ))}
    </div>
  );
}
```

In `MessageBubble`, replace the loading branch:

```tsx
{message.loading ? (
  <StepTrace steps={message.steps ?? []} />
) : ( ... )}
```

Add `StepEvent` to the import from `../../lib/types`.

- [ ] **Step 6.5: Build frontend and verify no TypeScript errors**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: no type errors, build succeeds

- [ ] **Step 6.6: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts frontend/hooks/useChat.ts frontend/components/chat/MessageBubble.tsx
git commit -m "feat(sse): SSE client + StepTrace component replacing ThinkingBar"
```

---

## Task 7: Final verification

- [ ] **Step 7.1: Run full test suite**

```bash
make test-all
```
Expected: all unit + integration tests pass

- [ ] **Step 7.2: Smoke test manually**

```bash
make serve
```

Open app, send "帮我规划一下京吹的取景地". Verify:

- StepTrace shows `● 动漫识别` → `✓ 动漫识别` → `● 搜索取景地` → etc. in real time
- Second message "再找附近的景点" — planner response includes `last_location` from context
- Route planning uses `last_location` as origin

- [ ] **Step 7.3: Check Cloudflare Worker SSE passthrough**

SSE requires the Worker not to buffer the response. Verify in `worker/worker.js` that the Container fetch result is returned directly without buffering (it is — `return env.CONTAINER.get(id).fetch(authedRequest)` at line 197 passes through transparently).

- [ ] **Step 7.4: Final commit**

```bash
git add .
git commit -m "chore(iter1): final wiring and smoke test verification"
```

---

## Acceptance Criteria Checklist

- [ ] User says "再找几个那附近的景点" → planner understands the referent from context
- [ ] `plan_route` uses `last_location` from context as route start when no explicit origin
- [ ] Frontend shows live step events (● → ✓) during pipeline execution via SSE
- [ ] `make test` is green throughout

---

## Known Constraints

- **CORS middleware and SSE:** CORS headers must be set on `StreamResponse` before `await resp.prepare()`. The existing `_cors_middleware` runs after `handler(request)` returns and cannot set headers on an already-prepared StreamResponse. The SSE handler sets its own CORS headers directly. This is intentional and documented.
- **`resolve_location` coverage:** `KNOWN_LOCATIONS` in `sql_agent.py` has ~25 entries. Origin strings not in the dict trigger an LLM call. Unknown origins that the LLM can't match return `None` → fallback to `rows[0]`.
- **Worker SSE passthrough:** Cloudflare Containers + Workers support streaming responses transparently. No Worker changes needed.
