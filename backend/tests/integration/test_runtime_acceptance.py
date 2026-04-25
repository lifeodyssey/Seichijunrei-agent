"""Integration acceptance tests for the runtime executor against a real PostgreSQL DB.

Uses testcontainer PostgreSQL (with PostGIS) and seed data instead of MagicMock.
The planner is bypassed — tests exercise ExecutorAgent.execute() directly with
pre-built ExecutionPlans against a real SupabaseClient.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from backend.agents.agent_result import AgentResult, StepRecord
from backend.agents.executor_agent import ExecutorAgent, PipelineResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.agents.retriever import Retriever
from backend.agents.runtime_models import (
    GreetingResponseModel,
    QADataModel,
    ResultsMetaModel,
    RouteDataModel,
    RouteModel,
    RouteResponseModel,
    SearchDataModel,
    SearchResponseModel,
)
from backend.domain.entities import Point
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.response_builder import agent_result_to_response

_BASELINE_PATH = Path(__file__).parent / "cases" / "runtime_acceptance_baseline.json"


def _load_cases() -> list[dict[str, object]]:
    with _BASELINE_PATH.open(encoding="utf-8") as handle:
        raw = json.load(handle)
    return cast(list[dict[str, object]], raw)


_CASES = _load_cases()


def _expected(case: dict[str, object]) -> dict[str, object]:
    """Safely extract the 'expected' dict from a test case."""
    raw = case["expected"]
    assert isinstance(raw, dict)
    return dict(raw)


# ── Plan builders (same scenarios, updated to seed data IDs) ────────────────


def _build_plan(scenario: str) -> ExecutionPlan:
    if scenario == "empty_search":
        # bangumi_id not in seed → 0 results
        return ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.SEARCH_BANGUMI,
                    params={"bangumi_id": "160209"},
                )
            ],
            reasoning="acceptance test bangumi search (empty)",
            locale="zh",
        )

    if scenario == "geo_search":
        return ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.SEARCH_NEARBY,
                    params={"location": "宇治", "radius": 3000},
                )
            ],
            reasoning="acceptance test nearby search",
            locale="zh",
        )

    if scenario == "route_planning":
        # bangumi_id 120632 (Eupho) has 2 points in seed data
        return ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.SEARCH_BANGUMI,
                    params={"bangumi_id": "120632", "origin": "京都站"},
                ),
                PlanStep(
                    tool=ToolName.PLAN_ROUTE,
                    params={"origin": "京都站"},
                ),
            ],
            reasoning="acceptance test route planning",
            locale="zh",
        )

    if scenario == "unclear":
        return ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.GREET_USER,
                    params={
                        "message": "你好！我是圣地巡礼，可以帮你找动漫取景地并规划路线。"
                    },
                )
            ],
            reasoning="acceptance test greeting",
            locale="zh",
        )

    raise ValueError(f"Unknown acceptance scenario: {scenario}")


# ── Executor with no external API fallbacks ─────────────────────────────────


async def _noop_fetch_points(bangumi_id: str) -> list[Point]:
    """Stub: never call external Anitabi API in tests."""
    return []


async def _noop_get_subject(subject_id: int) -> dict[str, object]:
    """Stub: never call external Bangumi API in tests."""
    return {}


def _build_executor(db: SupabaseClient) -> ExecutorAgent:
    """Build an ExecutorAgent with external API fallbacks disabled."""
    executor = ExecutorAgent(db)
    # Override the retriever to disable write-through fallback to Anitabi/Bangumi
    executor._retriever = Retriever(
        db,
        fetch_bangumi_points=_noop_fetch_points,
        get_bangumi_subject=_noop_get_subject,
    )
    return executor


def _wrap_pipeline_result(pr: PipelineResult) -> AgentResult:
    """Convert legacy PipelineResult to AgentResult for response builder."""
    fo = pr.final_output
    intent = pr.intent

    if intent in ("search_bangumi", "search_nearby"):
        results_raw = fo.get("results", {})
        results = (
            ResultsMetaModel.model_validate(results_raw)
            if isinstance(results_raw, dict)
            else ResultsMetaModel()
        )
        output = SearchResponseModel(
            intent=intent,  # type: ignore[arg-type]
            message=str(fo.get("message", "")),
            data=SearchDataModel(results=results),
        )
    elif intent in ("plan_route", "plan_selected"):
        route_raw = fo.get("route", {})
        route = (
            RouteModel.model_validate(route_raw)
            if isinstance(route_raw, dict)
            else RouteModel()
        )
        output = RouteResponseModel(
            intent=intent,  # type: ignore[arg-type]
            message=str(fo.get("message", "")),
            data=RouteDataModel(route=route),
        )
    else:
        output = GreetingResponseModel(
            intent="greet_user",
            message=str(fo.get("message", "")),
            data=QADataModel(message=str(fo.get("message", ""))),
        )

    steps = [
        StepRecord(
            tool=sr.tool,
            success=sr.success,
            data=sr.data if isinstance(sr.data, dict) else None,
            error=sr.error,
        )
        for sr in pr.step_results
    ]
    tool_state = {k: v for k, v in fo.items() if isinstance(v, dict)}
    return AgentResult(output=output, steps=steps, tool_state=tool_state)


def _get_result_count(payload: object) -> int:
    """Extract result count from a results payload (dict or list)."""
    if isinstance(payload, dict):
        items = payload.get("items", [])
        items_len = len(items) if isinstance(items, list) else 0
        rc = payload.get("row_count", items_len)
        return int(rc) if isinstance(rc, (int, float)) else items_len
    if isinstance(payload, list):
        return len(payload)
    return 0


# ── Executor-level tests (bypass planner, hit real DB) ──────────────────────


@pytest.mark.parametrize(
    "case",
    _CASES,
    ids=[str(case["name"]) for case in _CASES],
)
async def test_executor_against_testcontainer(
    case: dict[str, object],
    tc_db: SupabaseClient,
) -> None:
    """Execute pre-built plans against the real testcontainer DB."""
    scenario = str(case["scenario"])
    expected = _expected(case)

    plan = _build_plan(scenario)
    executor = _build_executor(tc_db)
    result: PipelineResult = await executor.execute(plan)

    # Intent check
    assert result.intent == expected["intent"]

    # Success: all steps must succeed
    assert result.success is expected["success"]

    # Status check
    assert result.final_output["status"] == expected["status"]

    # Plan steps
    assert [step.tool.value for step in result.plan.steps] == expected["plan_steps"]

    # Result count (for search scenarios)
    if "result_count" in expected:
        results_payload = result.final_output.get("results", {})
        count = _get_result_count(results_payload)
        assert count == expected["result_count"]

    # Route checks
    if "route_point_count" in expected:
        route = result.final_output.get("route")
        assert isinstance(route, dict)
        ordered = route["ordered_points"]
        assert isinstance(ordered, list)
        assert len(ordered) == expected["route_point_count"]

    # Strategy check
    if "strategy" in expected:
        step_data = result.step_results[0].data
        assert isinstance(step_data, dict)
        assert step_data["strategy"] == expected["strategy"]


# ── Public API shape test (uses executor result → response builder) ─────────


@pytest.mark.parametrize(
    "case",
    _CASES,
    ids=[str(case["name"]) for case in _CASES],
)
async def test_public_response_shape(
    case: dict[str, object],
    tc_db: SupabaseClient,
) -> None:
    """Build public API response from executor results against real DB."""
    scenario = str(case["scenario"])
    expected = _expected(case)

    plan = _build_plan(scenario)
    executor = _build_executor(tc_db)
    pipeline_result = await executor.execute(plan)
    agent_result = _wrap_pipeline_result(pipeline_result)

    public_response = agent_result_to_response(agent_result, include_debug=False)

    assert public_response.intent == expected["intent"]
    assert public_response.status == expected["status"]
    assert public_response.success is expected["success"]
    assert public_response.message == pipeline_result.final_output.get("message", "")

    if "result_count" in expected:
        results_payload = public_response.data.get("results", [])
        result_count = _get_result_count(results_payload)
        assert result_count == expected["result_count"]

    if "route_point_count" in expected:
        route_data = public_response.data.get("route")
        assert isinstance(route_data, dict)
        ordered_points = route_data["ordered_points"]
        assert isinstance(ordered_points, list)
        assert len(ordered_points) == expected["route_point_count"]
