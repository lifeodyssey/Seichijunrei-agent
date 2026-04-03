"""Integration acceptance tests for the runtime and public API facade."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from pydantic_ai.models.test import TestModel

from agents.models import ExecutionPlan, PlanStep, ToolName
from agents.pipeline import run_pipeline
from infrastructure.session.memory import InMemorySessionStore
from interfaces.public_api import PublicAPIRequest, handle_public_request

_BASELINE_PATH = Path(__file__).parent / "cases" / "runtime_acceptance_baseline.json"


def _load_cases() -> list[dict[str, object]]:
    with _BASELINE_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


_CASES = _load_cases()


def _build_plan(scenario: str) -> ExecutionPlan:
    if scenario == "empty_search":
        return ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.SEARCH_BANGUMI,
                    params={"bangumi_id": "160209"},
                )
            ],
            reasoning="acceptance test bangumi search",
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
        return ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.SEARCH_BANGUMI,
                    params={"bangumi_id": "115908", "origin": "京都站"},
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
                    params={"message": "你好！我是圣地巡礼，可以帮你找动漫取景地并规划路线。"},
                )
            ],
            reasoning="acceptance test greeting",
            locale="zh",
        )

    raise ValueError(f"Unknown acceptance scenario: {scenario}")


def _build_model(scenario: str) -> TestModel:
    return TestModel(custom_output_args=_build_plan(scenario))


def _build_db(scenario: str) -> MagicMock:
    db = MagicMock()
    pool = AsyncMock()
    db.pool = pool
    db.upsert_session = AsyncMock()
    db.save_route = AsyncMock(return_value="route-1")

    if scenario == "empty_search":
        pool.fetch = AsyncMock(return_value=[])
        db.search_points_by_location = AsyncMock(return_value=[])
        return db

    if scenario == "geo_search":
        pool.fetch = AsyncMock(return_value=[])
        db.search_points_by_location = AsyncMock(
            return_value=[
                {
                    "id": "1",
                    "bangumi_id": "115908",
                    "distance_m": 100,
                    "name": "宇治桥",
                }
            ]
        )
        return db

    if scenario == "route_planning":
        pool.fetch = AsyncMock(
            return_value=[
                {
                    "id": "1",
                    "bangumi_id": "115908",
                    "name": "A",
                    "latitude": 34.88,
                    "longitude": 135.80,
                },
                {
                    "id": "2",
                    "bangumi_id": "115908",
                    "name": "B",
                    "latitude": 34.89,
                    "longitude": 135.81,
                },
            ]
        )
        db.search_points_by_location = AsyncMock(
            return_value=[
                {"id": "1", "bangumi_id": "115908", "distance_m": 100},
                {"id": "2", "bangumi_id": "115908", "distance_m": 80},
            ]
        )
        return db

    if scenario == "unclear":
        pool.fetch = AsyncMock(return_value=[])
        db.search_points_by_location = AsyncMock(return_value=[])
        return db

    raise ValueError(f"Unknown acceptance scenario: {scenario}")


@pytest.mark.parametrize(
    ("case"),
    _CASES,
    ids=[str(case["name"]) for case in _CASES],
)
async def test_runtime_acceptance_baseline(case: dict[str, object]) -> None:
    scenario = str(case["scenario"])
    expected = dict(case["expected"])
    text = str(case["text"])
    locale = "zh"

    db = _build_db(scenario)
    pipeline_result = await run_pipeline(
        text,
        db,
        model=_build_model(scenario),
        locale=locale,
    )
    public_response = await handle_public_request(
        PublicAPIRequest(text=text, locale=locale),
        db,
        model=_build_model(scenario),
        session_store=InMemorySessionStore(),
    )

    assert pipeline_result.intent == expected["intent"]
    assert pipeline_result.final_output["status"] == expected["status"]
    assert pipeline_result.success is expected["success"]
    assert [step.tool.value for step in pipeline_result.plan.steps] == expected[
        "plan_steps"
    ]

    assert public_response.intent == expected["intent"]
    assert public_response.status == expected["status"]
    assert public_response.success is expected["success"]
    assert public_response.message == pipeline_result.final_output.get("message", "")

    if "result_count" in expected:
        results_payload = public_response.data.get("results", [])
        if isinstance(results_payload, dict):
            result_count = int(
                results_payload.get("row_count", len(results_payload.get("items", [])))
            )
        else:
            result_count = len(results_payload)
        assert result_count == expected["result_count"]

    if "route_point_count" in expected:
        ordered_points = public_response.data["route"]["ordered_points"]
        assert len(ordered_points) == expected["route_point_count"]
        assert len(public_response.route_history) == expected["route_history_count"]

    if "strategy" in expected:
        assert pipeline_result.step_results[0].data["strategy"] == expected["strategy"]
