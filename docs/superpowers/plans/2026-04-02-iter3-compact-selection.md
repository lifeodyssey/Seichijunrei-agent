# Iter 3: LLM Compact + Point Selection UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LLM-based session compression (F3b) so long conversations don't overwhelm context, and a point selection UI (F3a) so users can hand-pick which spots to include in a route.

**Architecture:** F3b is a pure backend addition — an async fire-and-forget task that compresses interactions ≥ 8 into a summary, stored in session state and injected via `_build_context_block`. F3a adds a new `plan_selected` executor tool (bypasses the planner entirely), a `PointSelectionContext` shared via React context, selection checkboxes on `PilgrimageGrid` and `NearbyMap`, and a `SelectionBar` in `ResultPanel`.

**Prerequisites:** Iter 1 (F1a–F1d) and Iter 2 (F2a–F2d) must be merged first.

**Tech Stack:** Python / Pydantic AI / aiohttp / Next.js (static export) / TypeScript / React context

**Spec:** `docs/superpowers/specs/2026-04-01-frontend-memory-arch.md` — Iter 3

**Save to:** `docs/superpowers/plans/2026-04-02-iter3-compact-selection.md`

---

## File Map

| File | Change |
|------|--------|
| `interfaces/public_api.py` | `_normalize_session_state` adds `summary`; `_compact_session_interactions` function; trigger in `handle()`; `_build_context_block` returns `summary`; `PublicAPIRequest` gains `selected_point_ids` + `origin`; bypass path in `handle()`; `_UI_MAP` adds `plan_selected` |
| `agents/models.py` | `ToolName.PLAN_SELECTED = "plan_selected"` |
| `agents/executor_agent.py` | `_execute_plan_selected` handler; dispatch table; `_build_output` reads PLAN_SELECTED context; `_infer_primary_tool` includes PLAN_SELECTED; `_MESSAGES` entries for plan_selected |
| `agents/pipeline.py` | `synthetic_plan: ExecutionPlan \| None = None` bypass param |
| `infrastructure/supabase/client.py` | `get_points_by_ids()` |
| `frontend/components/generative/registry.ts` | `intentToComponent` handles `"plan_selected"` |
| `frontend/contexts/PointSelectionContext.tsx` | New: context + provider |
| `frontend/hooks/usePointSelection.ts` | New: selection state hook |
| `frontend/components/generative/PilgrimageGrid.tsx` | Selection checkboxes overlay |
| `frontend/components/generative/NearbyMap.tsx` | Selection checkboxes on list items |
| `frontend/components/generative/SelectionBar.tsx` | New: count + departure input + Route button |
| `frontend/components/layout/ResultPanel.tsx` | Render `SelectionBar` when `selectedIds.size > 0` |
| `frontend/lib/api.ts` | `sendSelectedRoute()` |
| `frontend/components/layout/AppShell.tsx` | Provide `PointSelectionContext`; `handleRouteSelected` |
| `tests/unit/test_public_api.py` | Compact trigger tests; selected_point_ids bypass test |
| `tests/unit/test_executor_agent.py` | `_execute_plan_selected` tests |
| `tests/unit/test_supabase_client.py` | `get_points_by_ids` test |

---

## Part 1: F3b — LLM Compact

### Task 1: Session summary field + compact function

**Files:**
- Modify: `interfaces/public_api.py`
- Test: `tests/unit/test_public_api.py`

- [ ] **Step 1.1: Write failing tests**

```python
# tests/unit/test_public_api.py — add new class

from interfaces.public_api import _compact_session_interactions, _build_context_block
from infrastructure.session.memory import InMemorySessionStore

class TestCompact:
    async def test_compact_replaces_old_interactions_with_summary(self):
        """_compact_session_interactions keeps last 2 and writes summary."""
        store = InMemorySessionStore()
        session_id = "sess-compact"
        interactions = [
            {"text": f"query {i}", "intent": "search_bangumi", "status": "ok",
             "success": True, "created_at": "2026-04-01T00:00:00Z", "context_delta": {}}
            for i in range(8)
        ]
        state = {"interactions": interactions, "route_history": [], "last_intent": "search_bangumi",
                 "last_status": "ok", "last_message": "", "updated_at": "2026-04-01T00:00:00Z",
                 "summary": None}
        await store.set(session_id, state)

        with patch("interfaces.public_api._compact_session_interactions") as mock_compact:
            mock_compact.side_effect = _compact_session_interactions
            # Mock the LLM call
            with patch("agents.base.create_agent") as mock_agent_factory:
                mock_agent = MagicMock()
                mock_result = MagicMock()
                mock_result.output = "ユーザーは複数のアニメ聖地を検索しました。"
                mock_agent.run = AsyncMock(return_value=mock_result)
                mock_agent_factory.return_value = mock_agent
                await _compact_session_interactions(session_id, state, store)

        saved = await store.get(session_id)
        assert saved is not None
        assert len(saved["interactions"]) == 2          # last 2 kept
        assert saved["summary"] == "ユーザーは複数のアニメ聖地を検索しました。"

    async def test_compact_skips_when_fewer_than_8(self):
        store = InMemorySessionStore()
        state = {"interactions": [{"text": "q", "intent": "search_bangumi", "status": "ok",
                                   "success": True, "created_at": "x", "context_delta": {}}] * 5,
                 "summary": None}
        await store.set("s", state)
        with patch("agents.base.create_agent") as mock_factory:
            await _compact_session_interactions("s", state, store)
            mock_factory.assert_not_called()

    def test_build_context_block_includes_summary(self):
        state = {
            "interactions": [{"context_delta": {"bangumi_id": "253", "anime_title": "響け", "location": "宇治"}}],
            "summary": "ユーザーは京吹の聖地を検索しました。",
        }
        block = _build_context_block(state)
        assert block is not None
        assert block["summary"] == "ユーザーは京吹の聖地を検索しました。"

    def test_build_context_block_summary_none_when_absent(self):
        state = {
            "interactions": [{"context_delta": {"bangumi_id": "253", "anime_title": "響け", "location": "宇治"}}],
        }
        block = _build_context_block(state)
        assert block["summary"] is None
```

- [ ] **Step 1.2: Run — expect FAIL**

```bash
pytest tests/unit/test_public_api.py::TestCompact -v
```

Expected: `ImportError: cannot import name '_compact_session_interactions'`

- [ ] **Step 1.3: Add `summary` to `_normalize_session_state`**

In `interfaces/public_api.py`, in `_normalize_session_state`, add `"summary": None` to the `base` dict:

```python
base = {
    "interactions": [],
    "route_history": [],
    "last_intent": None,
    "last_status": None,
    "last_message": "",
    "summary": None,           # NEW
    "updated_at": datetime.now(UTC).isoformat(),
}
```

- [ ] **Step 1.4: Add `_compact_session_interactions` function**

Add to `interfaces/public_api.py` (module level, after `_generate_and_save_title` from Iter 2):

```python
async def _compact_session_interactions(
    session_id: str,
    session_state: dict[str, Any],
    session_store: SessionStore,
) -> None:
    """Background task: compress old interactions into a summary string.

    Keeps the 2 most recent interactions and replaces the rest with a summary.
    Triggered when len(interactions) >= 8. Writes back to the session store.
    """
    interactions = session_state.get("interactions") or []
    if len(interactions) < 8:
        return

    to_compact = interactions[:-2]
    fresh = interactions[-2:]

    history_text = "\n".join(
        f"{i + 1}. [{e.get('intent', '?')}] {e.get('text', '')[:80]}"
        for i, e in enumerate(to_compact)
    )

    from agents.base import create_agent
    agent = create_agent(
        "claude-haiku-4-5-20251001",
        system_prompt=(
            "Summarize these user search interactions into 1-2 sentences capturing "
            "what the user was researching. Use the same language as the interactions."
        ),
        retries=1,
    )
    try:
        result = await agent.run(history_text)
        summary = str(result.output).strip()[:300]
    except Exception:
        logger.warning("compact_llm_failed", session_id=session_id)
        return

    if not summary:
        return

    updated = {**session_state, "interactions": fresh, "summary": summary}
    try:
        await session_store.set(session_id, updated)
        logger.info("compact_complete", session_id=session_id, summary_len=len(summary))
    except Exception:
        logger.warning("compact_write_failed", session_id=session_id)
```

- [ ] **Step 1.5: Update `_build_context_block` to include `summary`**

In `_build_context_block` (added in Iter 1), add `summary` to the returned dict:

```python
return {
    "current_bangumi_id": current_bangumi_id,
    "current_anime_title": current_anime_title,
    "last_location": last_location,
    "last_intent": session_state.get("last_intent"),
    "visited_bangumi_ids": visited_bangumi_ids,
    "summary": session_state.get("summary"),   # NEW
}
```

- [ ] **Step 1.6: Run — expect PASS**

```bash
pytest tests/unit/test_public_api.py::TestCompact -v
```

- [ ] **Step 1.7: Run full suite**

```bash
make test
```

- [ ] **Step 1.8: Commit**

```bash
git add interfaces/public_api.py tests/unit/test_public_api.py
git commit -m "feat(api): add LLM compact — session summary when interactions >= 8"
```

---

### Task 2: Trigger compact in RuntimeAPI.handle + update prompt format

**Files:**
- Modify: `interfaces/public_api.py`
- Modify: `agents/planner_agent.py`
- Test: `tests/unit/test_public_api.py`

- [ ] **Step 2.1: Write failing test**

```python
# tests/unit/test_public_api.py — add to TestCompact

async def test_compact_triggered_at_8_interactions(self):
    """RuntimeAPI.handle creates compact task when session reaches 8 interactions."""
    import asyncio
    db = AsyncMock()
    db.upsert_session = AsyncMock()
    db.upsert_conversation = AsyncMock()
    db.upsert_user_memory = AsyncMock()
    db.get_user_memory = AsyncMock(return_value=None)
    db.insert_request_log = AsyncMock()

    store = InMemorySessionStore()
    # Pre-populate with 7 interactions (handle() will add the 8th)
    existing = [
        {"text": f"q{i}", "intent": "search_bangumi", "status": "ok",
         "success": True, "created_at": "x", "context_delta": {}}
        for i in range(7)
    ]
    session_id = "sess-trigger"
    await store.set(session_id, {
        "interactions": existing, "route_history": [], "last_intent": "search_bangumi",
        "last_status": "ok", "last_message": "", "summary": None,
        "updated_at": "2026-04-01T00:00:00Z",
    })

    created_tasks = []
    original_create_task = asyncio.create_task
    def capturing_create_task(coro, **kw):
        task = original_create_task(coro, **kw)
        created_tasks.append(task)
        return task

    api = RuntimeAPI(db, session_store=store)
    request = PublicAPIRequest(text="京吹", session_id=session_id)
    with patch("interfaces.public_api.asyncio.create_task", side_effect=capturing_create_task):
        await api.handle(request, user_id=None)

    assert len(created_tasks) >= 1  # compact task was created
```

- [ ] **Step 2.2: Run — expect FAIL**

```bash
pytest tests/unit/test_public_api.py::TestCompact::test_compact_triggered_at_8_interactions -v
```

- [ ] **Step 2.3: Add trigger in RuntimeAPI.handle**

In `interfaces/public_api.py`, inside `RuntimeAPI.handle`, after `await self._persist_session(session_id, session_state, response)`, add:

```python
import asyncio as _asyncio
if len(session_state.get("interactions", [])) >= 8:
    _asyncio.create_task(
        _compact_session_interactions(session_id, session_state, self._session_store)
    )
```

- [ ] **Step 2.4: Include summary in planner prompt prefix**

In `agents/planner_agent.py`, update `_format_context_block` (added in Iter 1). Find where the `[context]` block is formatted and add summary as first line when present:

```python
def _format_context_block(context: dict) -> str:
    lines = ["[context]"]
    if context.get("summary"):
        lines.append(f"summary: {context['summary']}")
    if context.get("current_anime_title") or context.get("current_bangumi_id"):
        anime = context.get("current_anime_title") or ""
        bid = context.get("current_bangumi_id") or ""
        lines.append(f"anime: {anime} (bangumi_id: {bid})")
    if context.get("last_location"):
        lines.append(f"last_location: {context['last_location']}")
    if context.get("last_intent"):
        lines.append(f"last_intent: {context['last_intent']}")
    if context.get("visited_bangumi_ids"):
        lines.append(f"visited_ids: {', '.join(context['visited_bangumi_ids'])}")
    return "\n".join(lines)
```

- [ ] **Step 2.5: Run — expect PASS**

```bash
pytest tests/unit/test_public_api.py::TestCompact -v
```

- [ ] **Step 2.6: Run full suite**

```bash
make test
```

- [ ] **Step 2.7: Commit**

```bash
git add interfaces/public_api.py agents/planner_agent.py tests/unit/test_public_api.py
git commit -m "feat(api): trigger compact task at 8 interactions; include summary in planner prefix"
```

---

## Part 2: F3a — Point Selection UI

### Task 3: get_points_by_ids in SupabaseClient

**Files:**
- Modify: `infrastructure/supabase/client.py`
- Test: `tests/unit/test_supabase_client.py`

- [ ] **Step 3.1: Write failing test**

```python
# tests/unit/test_supabase_client.py — add to existing file

class TestGetPointsByIds:
    async def test_returns_points_in_input_order(self, db):
        p1 = MagicMock(); p1.keys = MagicMock(return_value=["id"]); p1.__getitem__ = lambda s,k: "p1"
        p2 = MagicMock(); p2.keys = MagicMock(return_value=["id"]); p2.__getitem__ = lambda s,k: "p2"
        db.pool.fetch.return_value = [p1, p2]
        result = await db.get_points_by_ids(["p1", "p2"])
        assert len(result) == 2
        db.pool.fetch.assert_awaited_once()
        sql = db.pool.fetch.call_args.args[0]
        assert "unnest" in sql.lower() or "ANY" in sql

    async def test_returns_empty_for_empty_input(self, db):
        db.pool.fetch.return_value = []
        result = await db.get_points_by_ids([])
        assert result == []
```

- [ ] **Step 3.2: Run — expect FAIL**

```bash
pytest tests/unit/test_supabase_client.py::TestGetPointsByIds -v
```

- [ ] **Step 3.3: Add `get_points_by_ids` to SupabaseClient**

Add to `infrastructure/supabase/client.py` (in the `# --- Points ---` section):

```python
async def get_points_by_ids(self, point_ids: list[str]) -> list[asyncpg.Record]:
    """Fetch specific points by ID, preserving input order."""
    if not point_ids:
        return []
    return await self.pool.fetch(
        """
        SELECT p.*
        FROM points p
        JOIN unnest($1::text[]) WITH ORDINALITY AS t(id, ord) ON p.id = t.id
        ORDER BY t.ord
        """,
        point_ids,
    )
```

- [ ] **Step 3.4: Run — expect PASS**

```bash
pytest tests/unit/test_supabase_client.py::TestGetPointsByIds -v
```

- [ ] **Step 3.5: Commit**

```bash
git add infrastructure/supabase/client.py tests/unit/test_supabase_client.py
git commit -m "feat(db): add get_points_by_ids for direct point selection routing"
```

---

### Task 4: ToolName.PLAN_SELECTED + _execute_plan_selected

**Files:**
- Modify: `agents/models.py`
- Modify: `agents/executor_agent.py`
- Test: `tests/unit/test_executor_agent.py`

- [ ] **Step 4.1: Write failing tests**

```python
# tests/unit/test_executor_agent.py — add new class

class TestPlanSelected:
    async def test_routes_provided_point_ids(self, mock_db):
        """_execute_plan_selected fetches points by ID and sorts them."""
        points = [
            {"id": "p1", "latitude": 34.99, "longitude": 135.77,
             "name": "宇治橋", "name_cn": "宇治桥", "bangumi_id": "253",
             "episode": 1, "time_seconds": 0, "screenshot_url": "", "origin": None},
            {"id": "p2", "latitude": 35.01, "longitude": 135.80,
             "name": "平等院", "name_cn": "平等院", "bangumi_id": "253",
             "episode": 2, "time_seconds": 0, "screenshot_url": "", "origin": None},
        ]
        mock_db.get_points_by_ids = AsyncMock(return_value=[MagicMock(**{"__getitem__": lambda s,k: d[k], "keys": lambda: d.keys()}) for d in points])
        # Simpler: just return list of dicts via fetchrow-like
        mock_db.get_points_by_ids = AsyncMock(return_value=[
            type("Row", (), {**p, "keys": lambda self: p.keys(), "__getitem__": lambda self, k: p[k]})()
            for p in points
        ])

        from agents.models import ExecutionPlan, PlanStep, ToolName
        plan = ExecutionPlan(
            reasoning="test", locale="ja",
            steps=[PlanStep(tool=ToolName.PLAN_SELECTED,
                            params={"point_ids": ["p1", "p2"], "origin": None})]
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "plan_selected"
        assert result.success
        route = result.final_output.get("route", {})
        assert route.get("point_count") == 2

    async def test_returns_error_when_no_point_ids(self, mock_db):
        from agents.models import ExecutionPlan, PlanStep, ToolName
        plan = ExecutionPlan(
            reasoning="test", locale="ja",
            steps=[PlanStep(tool=ToolName.PLAN_SELECTED, params={"point_ids": []})]
        )
        result = await ExecutorAgent(mock_db).execute(plan)
        assert not result.success
```

- [ ] **Step 4.2: Run — expect FAIL**

```bash
pytest tests/unit/test_executor_agent.py::TestPlanSelected -v
```

Expected: `AttributeError` — `ToolName` has no `PLAN_SELECTED`.

- [ ] **Step 4.3: Add ToolName.PLAN_SELECTED to agents/models.py**

```python
class ToolName(str, Enum):
    RESOLVE_ANIME = "resolve_anime"
    SEARCH_BANGUMI = "search_bangumi"
    SEARCH_NEARBY = "search_nearby"
    PLAN_ROUTE = "plan_route"
    ANSWER_QUESTION = "answer_question"
    PLAN_SELECTED = "plan_selected"    # NEW
```

- [ ] **Step 4.4: Add `_execute_plan_selected` to ExecutorAgent**

Add to `agents/executor_agent.py` after `_execute_plan_route`:

```python
async def _execute_plan_selected(
    self, step: PlanStep, context: dict[str, Any]
) -> StepResult:
    """Route a user-specified list of point IDs, ordered by nearest-neighbor."""
    point_ids: list[str] = step.params.get("point_ids") or []
    if not point_ids:
        return StepResult(tool="plan_selected", success=False, error="point_ids is required")

    get_points = getattr(self._db, "get_points_by_ids", None)
    if get_points is None:
        return StepResult(tool="plan_selected", success=False, error="get_points_by_ids not available")

    rows = await get_points(point_ids)
    rows_dicts = [dict(r) for r in rows]
    origin: str | None = step.params.get("origin")
    ordered = await _nearest_neighbor_sort(rows_dicts, origin=origin)  # async since Iter 1
    with_coords = [r for r in ordered if r.get("latitude") and r.get("longitude")]

    return StepResult(
        tool="plan_selected",
        success=True,
        data={
            "ordered_points": ordered,
            "point_count": len(ordered),
            "status": "ok" if ordered else "empty",
            "summary": {
                "point_count": len(ordered),
                "with_coordinates": len(with_coords),
                "without_coordinates": len(ordered) - len(with_coords),
            },
        },
    )
```

- [ ] **Step 4.5: Register handler + update _build_output + _infer_primary_tool + _MESSAGES**

In `_execute_step` dispatch table, add:
```python
ToolName.PLAN_SELECTED: self._execute_plan_selected,
```

In `_infer_primary_tool`, add `ToolName.PLAN_SELECTED` after `ToolName.PLAN_ROUTE`:
```python
for priority in (
    ToolName.PLAN_ROUTE,
    ToolName.PLAN_SELECTED,
    ToolName.SEARCH_BANGUMI,
    ToolName.SEARCH_NEARBY,
    ToolName.ANSWER_QUESTION,
):
```

In `_build_output`, update route_data to also read from PLAN_SELECTED context:
```python
route_data = context.get(ToolName.PLAN_ROUTE.value) or context.get(ToolName.PLAN_SELECTED.value)
```

And update count calculation so plan_selected (which has no query_data) gets count from route:
```python
count = (query_data or {}).get("row_count", 0)
if count == 0 and route_data:
    count = route_data.get("point_count", 0)
```

In `_MESSAGES`, add:
```python
("plan_selected", "ja"): "{count}件の選択スポットでルートを作成しました。",
("plan_selected", "zh"): "已为{count}处选定取景地规划路线。",
("plan_selected", "en"): "Created a route with {count} selected stops.",
```

- [ ] **Step 4.6: Run — expect PASS**

```bash
pytest tests/unit/test_executor_agent.py::TestPlanSelected -v
```

- [ ] **Step 4.7: Run full suite**

```bash
make test
```

- [ ] **Step 4.8: Commit**

```bash
git add agents/models.py agents/executor_agent.py tests/unit/test_executor_agent.py
git commit -m "feat(executor): add plan_selected tool for direct point-ID routing"
```

---

### Task 5: PublicAPIRequest.selected_point_ids + pipeline bypass

**Files:**
- Modify: `interfaces/public_api.py`
- Modify: `agents/pipeline.py`
- Test: `tests/unit/test_public_api.py`

- [ ] **Step 5.1: Write failing tests**

```python
# tests/unit/test_public_api.py

class TestSelectedPointIdsBypass:
    async def test_selected_point_ids_bypasses_planner(self):
        """When selected_point_ids is set, run_pipeline is called with synthetic_plan."""
        db = AsyncMock()
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.upsert_user_memory = AsyncMock()
        db.get_user_memory = AsyncMock(return_value=None)
        db.insert_request_log = AsyncMock()

        captured = {}
        async def fake_pipeline(text, db_arg, *, model=None, locale="ja",
                                 context=None, synthetic_plan=None):
            captured["synthetic_plan"] = synthetic_plan
            return _make_result()

        api = RuntimeAPI(db, session_store=InMemorySessionStore())
        request = PublicAPIRequest(
            text="",
            selected_point_ids=["p1", "p2"],
            origin="宇治駅",
        )
        with patch("interfaces.public_api.run_pipeline", side_effect=fake_pipeline):
            await api.handle(request, user_id=None)

        assert captured["synthetic_plan"] is not None
        assert captured["synthetic_plan"].steps[0].tool.value == "plan_selected"
        assert captured["synthetic_plan"].steps[0].params["point_ids"] == ["p1", "p2"]
        assert captured["synthetic_plan"].steps[0].params["origin"] == "宇治駅"

    def test_text_can_be_empty_when_selected_point_ids_present(self):
        req = PublicAPIRequest(text="", selected_point_ids=["p1"])
        assert req.text == ""
        assert req.selected_point_ids == ["p1"]

    def test_text_cannot_be_empty_without_selected_point_ids(self):
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="")
```

- [ ] **Step 5.2: Run — expect FAIL**

```bash
pytest tests/unit/test_public_api.py::TestSelectedPointIdsBypass -v
```

- [ ] **Step 5.3: Add fields to PublicAPIRequest**

In `interfaces/public_api.py`, update `PublicAPIRequest`:

```python
from pydantic import BaseModel, Field, model_validator

class PublicAPIRequest(BaseModel):
    text: str = Field(default="", description="User message to process")
    session_id: str | None = Field(default=None, ...)
    model: str | None = Field(default=None, ...)
    locale: Literal["ja", "zh", "en"] = Field(default="ja", ...)
    include_debug: bool = Field(default=False, ...)
    selected_point_ids: list[str] | None = Field(
        default=None,
        description="If set, bypass planner and route these point IDs directly.",
    )
    origin: str | None = Field(
        default=None,
        description="Departure location for selected-point routing.",
    )

    @model_validator(mode="after")
    def validate_text_or_selection(self) -> "PublicAPIRequest":
        self.text = self.text.strip()
        if not self.text and not self.selected_point_ids:
            raise ValueError("text cannot be blank unless selected_point_ids is provided")
        return self
```

Remove the old `@field_validator("text")` and `min_length=1` from the `text` Field.

- [ ] **Step 5.4: Add `synthetic_plan` bypass to run_pipeline**

In `agents/pipeline.py`:

```python
from agents.executor_agent import ExecutorAgent, PipelineResult
from agents.models import ExecutionPlan
from agents.planner_agent import ReActPlannerAgent

async def run_pipeline(
    text: str,
    db: Any,
    *,
    model: Any = None,
    locale: str = "ja",
    context: dict | None = None,
    synthetic_plan: ExecutionPlan | None = None,
) -> PipelineResult:
    """Run the full agent pipeline: plan → execute.

    If synthetic_plan is provided, skip the planner and execute it directly.
    Used for selected-point routing (F3a) where intent is unambiguous.
    """
    executor = ExecutorAgent(db)
    if synthetic_plan is not None:
        return await executor.execute(synthetic_plan)
    plan = await ReActPlannerAgent(model).create_plan(text, locale=locale, context=context)
    logger.info(
        "plan_created",
        steps=[s.tool.value for s in plan.steps],
        reasoning=plan.reasoning[:120],
    )
    result = await executor.execute(plan)
    logger.info("pipeline_complete", intent=result.intent, success=result.success,
                steps_executed=len(result.step_results))
    return result
```

- [ ] **Step 5.5: Build synthetic plan in RuntimeAPI.handle**

In `interfaces/public_api.py`, inside `RuntimeAPI.handle`, before the `run_pipeline` call, add:

```python
from agents.models import ExecutionPlan as _ExecutionPlan, PlanStep as _PlanStep, ToolName as _ToolName

synthetic_plan = None
if request.selected_point_ids:
    synthetic_plan = _ExecutionPlan(
        steps=[_PlanStep(
            tool=_ToolName.PLAN_SELECTED,
            params={
                "point_ids": request.selected_point_ids,
                "origin": request.origin or ((context or {}).get("last_location")),
            },
        )],
        reasoning="User selected specific points for routing",
        locale=request.locale,
    )

result = await run_pipeline(
    request.text, self._db,
    model=request.model, locale=request.locale,
    context=context,
    synthetic_plan=synthetic_plan,
)
```

Also add `"plan_selected": "RouteVisualization"` to `_UI_MAP` in `public_api.py`.

- [ ] **Step 5.6: Run — expect PASS**

```bash
pytest tests/unit/test_public_api.py::TestSelectedPointIdsBypass -v
```

- [ ] **Step 5.7: Run full suite**

```bash
make test
```

- [ ] **Step 5.8: Commit**

```bash
git add interfaces/public_api.py agents/pipeline.py tests/unit/test_public_api.py
git commit -m "feat(api): add selected_point_ids bypass path for direct point routing"
```

---

### Task 6: Frontend — registry + PointSelectionContext + hook

**Files:**
- Modify: `frontend/components/generative/registry.ts`
- Create: `frontend/contexts/PointSelectionContext.tsx`
- Create: `frontend/hooks/usePointSelection.ts`

- [ ] **Step 6.1: Register plan_selected in registry.ts**

In `frontend/components/generative/registry.ts`, in `intentToComponent`:

```typescript
case "plan_route":
case "plan_selected":     // NEW
  return "RouteVisualization";
```

- [ ] **Step 6.2: Create PointSelectionContext**

```typescript
// frontend/contexts/PointSelectionContext.tsx
"use client";

import { createContext, useContext } from "react";

export interface PointSelectionContextValue {
  selectedIds: Set<string>;
  toggle: (id: string) => void;
  clear: () => void;
}

const defaultValue: PointSelectionContextValue = {
  selectedIds: new Set(),
  toggle: () => {},
  clear: () => {},
};

export const PointSelectionContext =
  createContext<PointSelectionContextValue>(defaultValue);

export function usePointSelectionContext() {
  return useContext(PointSelectionContext);
}
```

- [ ] **Step 6.3: Create usePointSelection hook**

```typescript
// frontend/hooks/usePointSelection.ts
"use client";

import { useState, useCallback } from "react";

export function usePointSelection() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, toggle, clear };
}
```

- [ ] **Step 6.4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 6.5: Commit**

```bash
git add frontend/components/generative/registry.ts \
        frontend/contexts/PointSelectionContext.tsx \
        frontend/hooks/usePointSelection.ts
git commit -m "feat(frontend): add PointSelectionContext and plan_selected intent routing"
```

---

### Task 7: PilgrimageGrid + NearbyMap selection mode

**Files:**
- Modify: `frontend/components/generative/PilgrimageGrid.tsx`
- Modify: `frontend/components/generative/NearbyMap.tsx`

- [ ] **Step 7.1: Add selection overlay to PilgrimageGrid**

Replace `PilgrimageGrid.tsx` with:

```tsx
"use client";

import type { SearchResultData } from "../../lib/types";
import { useDict } from "../../lib/i18n-context";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";

interface PilgrimageGridProps {
  data: SearchResultData;
}

export default function PilgrimageGrid({ data }: PilgrimageGridProps) {
  const { grid: t } = useDict();
  const { results } = data;
  const { selectedIds, toggle } = usePointSelectionContext();

  if (results.status === "empty" || results.rows.length === 0) {
    return (
      <div className="py-8 text-sm font-light text-[var(--color-muted-fg)]">
        {t.no_results}
      </div>
    );
  }

  const animeTitle = results.rows[0]?.title_cn || results.rows[0]?.title || "";

  return (
    <div className="space-y-5">
      <div className="flex items-baseline gap-4">
        {animeTitle && (
          <h2 className="font-[family-name:var(--app-font-display)] text-lg font-semibold text-[var(--color-fg)]">
            {animeTitle}
          </h2>
        )}
        <span className="text-xs font-light text-[var(--color-muted-fg)]">
          {t.count.replace("{count}", String(results.row_count))}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {results.rows.map((point, idx) => {
          const isSelected = selectedIds.has(point.id);
          return (
            <div
              key={point.id}
              onClick={() => toggle(point.id)}
              className={[
                "relative cursor-pointer overflow-hidden rounded-sm bg-[var(--color-muted)] transition",
                idx === 0 ? "col-span-2" : "",
                isSelected
                  ? "ring-2 ring-[var(--color-primary)]"
                  : "ring-0 hover:ring-1 hover:ring-[var(--color-primary)]/40",
              ].join(" ")}
              style={{ transitionDuration: "var(--duration-fast)" }}
            >
              {/* Selection badge */}
              <span
                className={[
                  "absolute right-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold transition",
                  isSelected
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-black/50 text-white/70",
                ].join(" ")}
                style={{ transitionDuration: "var(--duration-fast)" }}
              >
                {isSelected ? "✓" : "+"}
              </span>

              <div className={`relative bg-[var(--color-muted)] ${idx === 0 ? "aspect-video" : "aspect-[4/3]"}`}>
                {point.screenshot_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={point.screenshot_url}
                    alt={point.name_cn || point.name}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
              </div>

              {point.episode != null && point.episode !== 0 && (
                <span className="absolute bottom-2 left-2 rounded-sm bg-black/60 px-1.5 py-0.5 text-[10px] text-white/80">
                  {t.episode.replace("{ep}", String(point.episode))}
                </span>
              )}

              <div className="pb-2 pt-1.5">
                <p className="truncate text-xs font-light text-[var(--color-fg)]">
                  {point.name_cn || point.name}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Add selection checkboxes to NearbyMap list items**

In `NearbyMap.tsx`, add `usePointSelectionContext` import and update list item rendering:

```tsx
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";

// inside NearbyMap component, before return:
const { selectedIds, toggle } = usePointSelectionContext();

// In the list items section, replace:
<div key={point.id} className="flex items-center justify-between px-4 py-3">

// With:
<div
  key={point.id}
  onClick={() => toggle(point.id)}
  className={[
    "flex cursor-pointer items-center justify-between px-4 py-3 transition",
    selectedIds.has(point.id)
      ? "bg-[var(--color-primary)]/10"
      : "hover:bg-[var(--color-muted)]",
  ].join(" ")}
  style={{ transitionDuration: "var(--duration-fast)" }}
>
  {/* selection indicator */}
  <span className={[
    "mr-3 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold",
    selectedIds.has(point.id)
      ? "bg-[var(--color-primary)] text-white"
      : "border border-[var(--color-border)] text-[var(--color-muted-fg)]",
  ].join(" ")}>
    {selectedIds.has(point.id) ? "✓" : "+"}
  </span>
  {/* existing content (name + distance) unchanged */}
```

- [ ] **Step 7.3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 7.4: Commit**

```bash
git add frontend/components/generative/PilgrimageGrid.tsx \
        frontend/components/generative/NearbyMap.tsx
git commit -m "feat(frontend): add selection checkboxes to PilgrimageGrid and NearbyMap"
```

---

### Task 8: SelectionBar component + ResultPanel integration

**Files:**
- Create: `frontend/components/generative/SelectionBar.tsx`
- Modify: `frontend/components/layout/ResultPanel.tsx`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 8.1: Create SelectionBar**

```tsx
// frontend/components/generative/SelectionBar.tsx
"use client";

import { useState } from "react";

interface SelectionBarProps {
  count: number;
  defaultOrigin: string;
  onRoute: (origin: string) => void;
  onClear: () => void;
}

export default function SelectionBar({
  count,
  defaultOrigin,
  onRoute,
  onClear,
}: SelectionBarProps) {
  const [origin, setOrigin] = useState(defaultOrigin);

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] bg-[var(--color-card)] px-5 py-2.5">
      <span className="shrink-0 text-[11px] font-medium text-[var(--color-primary)]">
        {count} selected
      </span>
      <input
        value={origin}
        onChange={(e) => setOrigin(e.target.value)}
        placeholder="Departure…"
        className="min-w-0 flex-1 rounded-sm bg-[var(--color-muted)] px-2 py-1 text-xs text-[var(--color-fg)] outline-none placeholder:text-[var(--color-muted-fg)] focus:ring-1 focus:ring-[var(--color-primary)]/40"
      />
      <button
        onClick={() => onRoute(origin)}
        className="shrink-0 rounded-sm bg-[var(--color-primary)] px-3 py-1 text-[11px] font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        style={{ transitionDuration: "var(--duration-fast)" }}
        disabled={count === 0}
      >
        Route
      </button>
      <button
        onClick={onClear}
        className="shrink-0 text-xs text-[var(--color-muted-fg)] hover:text-[var(--color-fg)]"
        style={{ transitionDuration: "var(--duration-fast)" }}
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 8.2: Update ResultPanel to show SelectionBar**

In `frontend/components/layout/ResultPanel.tsx`, add:

```tsx
import SelectionBar from "../generative/SelectionBar";
import { usePointSelectionContext } from "../../contexts/PointSelectionContext";
```

Update `ResultPanelProps`:
```typescript
interface ResultPanelProps {
  activeResponse: RuntimeResponse | null;
  onSuggest?: (text: string) => void;
  onRouteSelected?: (origin: string) => void;
  defaultOrigin?: string;
}
```

In the render, when `activeResponse !== null`, wrap content:

```tsx
const { selectedIds, clear } = usePointSelectionContext();

// Replace the existing single-branch render with:
if (!activeResponse) {
  // ...existing welcome screen unchanged...
}

return (
  <div className="flex h-full flex-col overflow-hidden">
    {selectedIds.size > 0 && (
      <SelectionBar
        count={selectedIds.size}
        defaultOrigin={defaultOrigin ?? ""}
        onRoute={(origin) => { onRouteSelected?.(origin); clear(); }}
        onClear={clear}
      />
    )}
    <div className="flex-1 overflow-y-auto p-6">
      <GenerativeUIRenderer response={activeResponse} onSuggest={onSuggest} />
    </div>
  </div>
);
```

- [ ] **Step 8.3: Add sendSelectedRoute to api.ts**

In `frontend/lib/api.ts`:

```typescript
export async function sendSelectedRoute(
  pointIds: string[],
  origin: string,
  sessionId?: string | null,
  locale?: RuntimeRequest["locale"],
): Promise<RuntimeResponse> {
  const body = {
    text: "",
    selected_point_ids: pointIds,
    origin: origin || undefined,
    session_id: sessionId || undefined,
    locale: locale || "ja",
  };
  const res = await fetch(`${RUNTIME_URL}/v1/runtime`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new Error(errBody?.error?.message ?? `Runtime error (${res.status})`);
  }
  return res.json() as Promise<RuntimeResponse>;
}
```

- [ ] **Step 8.4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 8.5: Commit**

```bash
git add frontend/components/generative/SelectionBar.tsx \
        frontend/components/layout/ResultPanel.tsx \
        frontend/lib/api.ts
git commit -m "feat(frontend): add SelectionBar and sendSelectedRoute API"
```

---

### Task 9: AppShell — provide context + wire handleRouteSelected

**Files:**
- Modify: `frontend/components/layout/AppShell.tsx`

- [ ] **Step 9.1: Wire up PointSelectionContext in AppShell**

In `AppShell.tsx`:

1. Add imports:
```tsx
import { usePointSelection } from "../../hooks/usePointSelection";
import { PointSelectionContext } from "../../contexts/PointSelectionContext";
import { sendSelectedRoute } from "../../lib/api";
```

2. Call hook:
```tsx
const { selectedIds, toggle, clear } = usePointSelection();
```

3. Derive `lastLocation` from the latest response:
```tsx
const lastLocation = useMemo(() => {
  const session = latestResponseMessage?.response?.session;
  // session.last_intent tells us the last tool; last_location is in context_block
  // For now: fall back to empty — user fills in the SelectionBar input
  return "";
}, [latestResponseMessage]);
```

4. Add `handleRouteSelected`:
```tsx
const handleRouteSelected = useCallback(
  async (origin: string) => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    clear();
    setActiveMessageId(null);

    const placeholderId = nextId();  // need to import nextId from useChat or duplicate
    // Simplest: delegate to the existing send() mechanism by calling sendSelectedRoute directly
    // and appending to messages manually via a small inline approach
    setSending(true);
    try {
      const response = await sendSelectedRoute(ids, origin, sessionId, locale);
      if (response.session_id) setSessionId(response.session_id);
      // Trigger upsertConversation same as regular send
      upsertConversation?.(response.session_id ?? "", ids.join(","));
      // Append response message
      setMessages?.((prev) => [
        ...prev,
        {
          id: nextMsgId(),
          role: "assistant" as const,
          text: response.message,
          response,
          loading: false,
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      // silent fail — user can retry
    } finally {
      setSending(false);
    }
  },
  [selectedIds, clear, sessionId, locale, setSessionId],
);
```

Note: `setMessages` and `setSending` need to be exposed from `useChat`. The cleanest way is to add an `appendMessage` callback to `useChat`. Alternatively, `useChat.send` can be adapted to accept a pre-built request object. Recommended: expose `appendMessage` from `useChat`:

```typescript
// In useChat.ts, add:
const appendMessage = useCallback((msg: ChatMessage) => {
  setMessages((prev) => [...prev, msg]);
}, []);

return { messages, send, sending, clear, appendMessage };
```

Then in AppShell use `appendMessage` from `useChat`:
```tsx
const { messages, send, sending, clear, appendMessage } = useChat(...);
```

5. Wrap the JSX return with `PointSelectionContext.Provider`:
```tsx
return (
  <PointSelectionContext.Provider value={{ selectedIds, toggle, clear }}>
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* ...existing layout... */}
      {/* pass onRouteSelected + defaultOrigin to ResultPanel: */}
      <ResultPanel
        activeResponse={activeResponse}
        onSuggest={handleSend}
        onRouteSelected={handleRouteSelected}
        defaultOrigin={lastLocation}
      />
    </div>
  </PointSelectionContext.Provider>
);
```

- [ ] **Step 9.2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 9.3: Run full suite**

```bash
make test
```

- [ ] **Step 9.4: Commit**

```bash
git add frontend/components/layout/AppShell.tsx \
        frontend/hooks/useChat.ts
git commit -m "feat(frontend): wire PointSelectionContext and handleRouteSelected in AppShell"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|-----------------|------|
| F3b: compact triggered at ≥ 8 interactions | Task 1, 2 |
| F3b: async background task, no latency impact | Task 2 |
| F3b: summary written to session["summary"] | Task 1 |
| F3b: summary injected in context_block | Task 1, 2 |
| F3a: search → display with checkboxes | Task 7 |
| F3a: multi-select points | Task 6, 7 |
| F3a: ask departure (SelectionBar input) | Task 8 |
| F3a: generate route for selected only | Task 4, 5 |
| F3a: new plan_selected tool | Task 4 |
| F3a: bypass planner for selected routing | Task 5 |

All requirements covered.
