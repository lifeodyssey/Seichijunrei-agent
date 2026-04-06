"""Tests for ReAct loop pipeline."""
import pytest
from unittest.mock import AsyncMock, MagicMock

from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)
from backend.agents.executor_agent import StepResult
from backend.agents.pipeline import react_loop, ReactStepEvent


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
        tool="resolve_anime", success=True,
        data={"bangumi_id": "115908", "title": "響け！ユーフォニアム"},
    )
    result2 = StepResult(
        tool="search_bangumi", success=True,
        data={"row_count": 577, "status": "ok", "rows": []},
    )
    mock_executor._execute_step = AsyncMock(side_effect=[result1, result2])
    mock_executor.format_observation = MagicMock(side_effect=[
        Observation(tool="resolve_anime", success=True, summary="Got 115908"),
        Observation(tool="search_bangumi", success=True, summary="577 spots"),
    ])

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
        text="test", planner=mock_planner, executor=mock_executor,
        locale="ja", max_steps=3,
    ):
        events.append(event)

    # Should stop at max_steps + 1 forced done event
    assert events[-1].type == "done"
    step_events = [e for e in events if e.type == "step"]
    # Each step produces 2 events (running + done), max_steps=3 means 6 step events
    assert len(step_events) <= 6
