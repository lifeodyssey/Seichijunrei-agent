"""Tests for ExecutorAgent.format_observation."""
from backend.agents.executor_agent import ExecutorAgent, StepResult


def test_format_observation_resolve_anime():
    result = StepResult(
        tool="resolve_anime",
        success=True,
        data={"bangumi_id": "115908", "title": "響け！ユーフォニアム"},
    )
    obs = ExecutorAgent.format_observation(result)
    assert obs.tool == "resolve_anime"
    assert obs.success is True
    assert "115908" in obs.summary
    assert "響け" in obs.summary


def test_format_observation_search_with_count():
    result = StepResult(
        tool="search_bangumi",
        success=True,
        data={
            "row_count": 577,
            "status": "ok",
            "rows": [{"name": "宇治橋"}],
        },
    )
    obs = ExecutorAgent.format_observation(result)
    assert "577" in obs.summary
    assert obs.success is True


def test_format_observation_failure():
    result = StepResult(
        tool="resolve_anime",
        success=False,
        error="No anime found matching 'asdfghjkl'",
    )
    obs = ExecutorAgent.format_observation(result)
    assert obs.success is False
    assert "No anime found" in obs.summary


def test_format_observation_plan_route():
    result = StepResult(
        tool="plan_route",
        success=True,
        data={
            "timed_itinerary": {"spot_count": 12, "total_minutes": 150},
            "point_count": 12,
        },
    )
    obs = ExecutorAgent.format_observation(result)
    assert "12" in obs.summary
    assert obs.success is True
