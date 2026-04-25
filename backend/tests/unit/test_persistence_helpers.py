"""Unit tests for persistence helper functions."""

from __future__ import annotations

from unittest.mock import AsyncMock

from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.interfaces.persistence import (
    _safe_insert_message,
    build_response_session,
    extract_plan_steps,
    get_plan_params,
    infer_bangumi_id,
)


async def test_safe_insert_message_succeeds() -> None:
    fn = AsyncMock()
    await _safe_insert_message(fn, "sess-1", "user", "hello", label="test")
    fn.assert_awaited_once_with("sess-1", "user", "hello")


async def test_safe_insert_message_handles_os_error() -> None:
    fn = AsyncMock(side_effect=OSError("connection lost"))
    await _safe_insert_message(fn, "sess-1", "user", "hello", label="test")


async def test_safe_insert_message_skips_non_callable() -> None:
    await _safe_insert_message(None, "sess-1", label="test")


def test_build_response_session_with_route_history() -> None:
    state = {
        "interactions": [],
        "route_history": [{"route_id": "r1"}],
        "updated_at": "2026-01-01T00:00:00",
    }
    session, rh = build_response_session(state)
    assert isinstance(session, dict)
    assert len(rh) == 1


def test_build_response_session_with_no_route_history() -> None:
    state = {
        "interactions": [],
        "route_history": None,
        "updated_at": "2026-01-01T00:00:00",
    }
    _, rh = build_response_session(state)
    assert rh == []


def test_get_plan_params_returns_first_step_params() -> None:
    result = _make_result(
        steps=[
            PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "test"}),
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "123"}),
        ]
    )
    params = get_plan_params(result)
    assert params == {"title": "test"}


def test_get_plan_params_returns_empty_when_no_params() -> None:
    result = _make_result(steps=[PlanStep(tool=ToolName.GREET_USER, params={})])
    assert get_plan_params(result) == {}


def test_infer_bangumi_id_from_results() -> None:
    results = {"rows": [{"bangumi_id": "253"}]}
    assert infer_bangumi_id(results) == "253"


def test_infer_bangumi_id_returns_none_for_empty() -> None:
    assert infer_bangumi_id({}) is None
    assert infer_bangumi_id({"rows": []}) is None
    assert infer_bangumi_id(None) is None
    assert infer_bangumi_id({"rows": ["not_a_dict"]}) is None


def test_extract_plan_steps_with_tools() -> None:
    result = _make_result(
        steps=[
            PlanStep(tool=ToolName.RESOLVE_ANIME),
            PlanStep(tool=ToolName.SEARCH_BANGUMI),
        ]
    )
    steps = extract_plan_steps(result)
    assert steps == ["resolve_anime", "search_bangumi"]


def test_extract_plan_steps_returns_none_for_none() -> None:
    assert extract_plan_steps(None) is None


def _make_result(
    intent: str = "search_bangumi",
    steps: list[PlanStep] | None = None,
) -> PipelineResult:
    plan = ExecutionPlan(
        steps=steps or [],
        reasoning="test",
        locale="ja",
    )
    return PipelineResult(intent=intent, plan=plan)
