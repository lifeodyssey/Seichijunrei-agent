"""Tests for ReAct loop pipeline."""

from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)
from backend.agents.pipeline import ReactStepEvent, react_loop, run_pipeline


@pytest.mark.asyncio
async def test_react_loop_single_step_done():
    """Simple query that completes in one step."""
    mock_planner = MagicMock()
    mock_executor = MagicMock()

    # Planner immediately returns done
    step1 = ReactStep(
        thought="Just a greeting",
        done=DoneSignal(message="Hello! I can help with pilgrimage planning."),
    )
    mock_planner.step = AsyncMock(return_value=step1)

    events: list[ReactStepEvent] = []
    async for event in react_loop(
        text="hi",
        planner=mock_planner,
        executor=mock_executor,
        locale="en",
    ):
        events.append(event)

    assert len(events) == 1
    assert events[0].type == "done"
    assert "Hello" in events[0].message


@pytest.mark.asyncio
async def test_react_loop_multi_step():
    """Query requiring resolve → search → done."""
    mock_planner = MagicMock()
    mock_executor = MagicMock()

    # Step 1: resolve_anime
    step1 = ReactStep(
        thought="Need to resolve anime title",
        action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "響け"}),
    )
    # Step 2: search_bangumi
    step2 = ReactStep(
        thought="Now search for spots",
        action=PlanStep(tool=ToolName.SEARCH_BANGUMI, params={}),
    )
    # Step 3: done
    step3 = ReactStep(
        thought="Have the results",
        done=DoneSignal(message="Found 577 spots."),
    )
    mock_planner.step = AsyncMock(side_effect=[step1, step2, step3])

    # Executor results
    result1 = StepResult(
        tool="resolve_anime",
        success=True,
        data={"bangumi_id": "115908", "title": "響け！ユーフォニアム"},
    )
    result2 = StepResult(
        tool="search_bangumi",
        success=True,
        data={"row_count": 577, "status": "ok", "rows": []},
    )
    mock_executor._execute_step = AsyncMock(side_effect=[result1, result2])
    mock_executor.format_observation = MagicMock(
        side_effect=[
            Observation(tool="resolve_anime", success=True, summary="Got 115908"),
            Observation(tool="search_bangumi", success=True, summary="577 spots"),
        ]
    )

    events = []
    async for event in react_loop(
        text="響けの聖地",
        planner=mock_planner,
        executor=mock_executor,
        locale="ja",
    ):
        events.append(event)

    assert len(events) == 5  # running + done for each step + final done
    step_events = [e for e in events if e.type == "step"]
    done_events = [e for e in events if e.type == "done"]
    assert len(step_events) == 4  # running + done for 2 tools
    assert len(done_events) == 1
    assert step_events[0].tool == "resolve_anime"
    assert step_events[0].status == "running"
    assert step_events[1].tool == "resolve_anime"
    assert step_events[1].status == "done"
    assert step_events[2].tool == "search_bangumi"
    assert step_events[3].tool == "search_bangumi"


@pytest.mark.asyncio
async def test_react_loop_max_steps():
    """Loop stops after max_steps even if planner keeps emitting actions."""
    mock_planner = MagicMock()
    mock_executor = MagicMock()

    # Planner always returns an action (infinite loop)
    action = ReactStep(
        thought="Keep going",
        action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "x"}),
    )
    mock_planner.step = AsyncMock(return_value=action)

    result = StepResult(tool="resolve_anime", success=True, data={})
    mock_executor._execute_step = AsyncMock(return_value=result)
    mock_executor.format_observation = MagicMock(
        return_value=Observation(tool="resolve_anime", success=True, summary="ok")
    )

    events = []
    async for event in react_loop(
        text="test",
        planner=mock_planner,
        executor=mock_executor,
        locale="ja",
        max_steps=3,
    ):
        events.append(event)

    # Should stop at max_steps + 1 forced done event
    assert events[-1].type == "done"
    step_events = [e for e in events if e.type == "step"]
    # Each step produces 2 events (running + done), max_steps=3 means 6 step events
    assert len(step_events) <= 6


# ---------------------------------------------------------------------------
# Verify react_loop yields clarify event
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_react_loop_clarify_yields_clarify_event():
    """react_loop yields a clarify event when the planner emits a clarify action."""
    mock_planner = MagicMock()
    mock_executor = MagicMock()

    clarify_react = ReactStep(
        thought="Need more info",
        action=PlanStep(
            tool=ToolName.CLARIFY,
            params={"question": "Which city?", "options": ["京都", "宇治"]},
        ),
    )
    mock_planner.step = AsyncMock(return_value=clarify_react)

    step_result = StepResult(
        tool="clarify",
        success=True,
        data={"question": "Which city?", "options": ["京都", "宇治"]},
    )
    mock_executor._execute_step = AsyncMock(return_value=step_result)
    mock_executor.format_observation = MagicMock(
        return_value=Observation(tool="clarify", success=True, summary="Asked user")
    )

    events: list[ReactStepEvent] = []
    async for event in react_loop(
        text="どこで？",
        planner=mock_planner,
        executor=mock_executor,
        locale="ja",
    ):
        events.append(event)

    clarify_events = [e for e in events if e.type == "clarify"]
    assert clarify_events, (
        f"No clarify event yielded. Events: {[(e.type, e.tool) for e in events]}"
    )
    assert clarify_events[0].data.get("question") == "Which city?"


# ---------------------------------------------------------------------------
# AC tests: clarify event forwarding through run_pipeline
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    return db


async def _fake_react_loop_clarify(**kwargs: object) -> AsyncIterator[ReactStepEvent]:
    """Async generator replacement for react_loop that yields clarify events."""
    yield ReactStepEvent(
        type="clarify",
        tool="clarify",
        data={"question": "Which city?", "options": ["京都", "宇治"]},
        message="Which city?",
    )


async def _fake_react_loop_done(**kwargs: object) -> AsyncIterator[ReactStepEvent]:
    """Async generator replacement for react_loop that yields a done event."""
    yield ReactStepEvent(type="done", message="Hello!")


@pytest.mark.asyncio
async def test_run_pipeline_clarify_calls_on_step_with_clarify_tool(mock_db):
    """AC: clarify event -> on_step called with tool='clarify' + question/options data."""
    on_step = AsyncMock()
    mock_loop = MagicMock(side_effect=_fake_react_loop_clarify)

    with patch("backend.agents.pipeline.react_loop", new=mock_loop):
        await run_pipeline("どこで？", mock_db, on_step=on_step)

    # on_step must have been called with tool="clarify" AND status="needs_clarification"
    clarify_calls = [
        c
        for c in on_step.call_args_list
        if c.args[0] == "clarify" and c.args[1] == "needs_clarification"
    ]
    assert clarify_calls, (
        f"on_step was never called with tool='clarify', status='needs_clarification'. "
        f"Total calls: {on_step.await_count}. All: {on_step.call_args_list}"
    )
    # The data dict passed to on_step must contain question and options
    _, _, data, _, _ = clarify_calls[0].args
    assert "question" in data
    assert "options" in data


@pytest.mark.asyncio
async def test_run_pipeline_clarify_sets_intent_and_status(mock_db):
    """AC: PipelineResult for clarify has intent='clarify', status='needs_clarification'."""
    mock_loop = MagicMock(side_effect=_fake_react_loop_clarify)
    with patch("backend.agents.pipeline.react_loop", new=mock_loop):
        result = await run_pipeline("どこで？", mock_db)

    assert isinstance(result, PipelineResult)
    assert result.intent == "clarify"
    assert result.final_output.get("status") == "needs_clarification"


@pytest.mark.asyncio
async def test_run_pipeline_no_clarify_unchanged(mock_db):
    """AC: No clarify event -> pipeline behaviour unchanged."""
    mock_loop = MagicMock(side_effect=_fake_react_loop_done)
    with patch("backend.agents.pipeline.react_loop", new=mock_loop):
        result = await run_pipeline("hi", mock_db)

    assert isinstance(result, PipelineResult)
    # intent should NOT be "clarify" — falls back to default
    assert result.intent != "clarify"
    assert result.final_output.get("status") != "needs_clarification"


@pytest.mark.asyncio
async def test_run_pipeline_clarify_no_on_step_no_crash(mock_db):
    """AC: on_step is None + clarify fires -> no crash."""
    mock_loop = MagicMock(side_effect=_fake_react_loop_clarify)
    with patch("backend.agents.pipeline.react_loop", new=mock_loop):
        # Must not raise
        result = await run_pipeline("どこで？", mock_db, on_step=None)

    assert isinstance(result, PipelineResult)
