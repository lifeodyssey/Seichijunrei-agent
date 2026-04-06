"""Tests for ReActPlannerAgent single-step mode."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)
from backend.agents.planner_agent import ReActPlannerAgent


@pytest.fixture
def mock_agent():
    """Create a planner with a mocked LLM agent."""
    with patch("backend.agents.planner_agent.create_agent") as mock_create:
        mock_inner = MagicMock()
        mock_create.return_value = mock_inner
        planner = ReActPlannerAgent.__new__(ReActPlannerAgent)
        planner._plan_agent = mock_inner
        # Create a separate mock for the step agent
        planner._step_agent = MagicMock()
        yield planner


@pytest.mark.asyncio
async def test_step_returns_action(mock_agent):
    """First step should return an action (PlanStep)."""
    expected = ReactStep(
        thought="User wants Hibike spots",
        action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "響け"}),
    )
    mock_result = MagicMock()
    mock_result.output = expected
    mock_agent._step_agent.run = AsyncMock(return_value=mock_result)

    result = await mock_agent.step(
        text="響けの聖地", locale="ja", history=[]
    )
    assert result.action is not None
    assert result.action.tool == ToolName.RESOLVE_ANIME
    assert result.done is None


@pytest.mark.asyncio
async def test_step_returns_done_after_observations(mock_agent):
    """After enough observations, planner should signal done."""
    expected = ReactStep(
        thought="Have all the data, returning results",
        done=DoneSignal(message="Found 577 pilgrimage spots."),
    )
    mock_result = MagicMock()
    mock_result.output = expected
    mock_agent._step_agent.run = AsyncMock(return_value=mock_result)

    history = [
        Observation(tool="resolve_anime", success=True, summary="Resolved to 115908"),
        Observation(tool="search_bangumi", success=True, summary="Found 577 spots"),
    ]
    result = await mock_agent.step(
        text="響けの聖地", locale="ja", history=history
    )
    assert result.done is not None
    assert result.action is None


def test_format_history_empty():
    """Empty history should produce no observation lines."""
    from backend.agents.planner_agent import _format_react_history
    assert _format_react_history([]) == ""


def test_format_history_with_observations():
    """History should format as Observation blocks."""
    from backend.agents.planner_agent import _format_react_history
    history = [
        Observation(tool="resolve_anime", success=True, summary="Got 115908"),
    ]
    formatted = _format_react_history(history)
    assert "Observation" in formatted
    assert "resolve_anime" in formatted
    assert "115908" in formatted
