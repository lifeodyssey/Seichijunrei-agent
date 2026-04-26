"""Unit tests for the PydanticAI-native pilgrimage agent wrapper."""

from __future__ import annotations

from unittest.mock import MagicMock

from pydantic_ai.models.test import TestModel

from backend.agents.pilgrimage_runner import run_pilgrimage_agent
from backend.agents.runtime_models import (
    ClarifyResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)


async def test_run_pilgrimage_agent_returns_clarify_agent_result() -> None:
    db = MagicMock()
    model = TestModel(
        call_tools=[],
        seed=0,  # ClarifyResponseModel output tool
        custom_output_args={
            "intent": "clarify",
            "message": "你是指哪部凉宫？",
            "data": {
                "status": "needs_clarification",
                "question": "你是指哪部凉宫？",
                "options": ["凉宫春日的忧郁", "凉宫春日的消失"],
                "candidates": [
                    {
                        "title": "凉宫春日的忧郁",
                        "cover_url": "",
                        "spot_count": 0,
                        "city": "",
                    }
                ],
            },
            "ui": {"component": "Clarification"},
        },
    )

    result = await run_pilgrimage_agent(
        text="凉宫",
        db=db,
        locale="zh",
        model=model,
    )

    assert result.intent == "clarify"
    assert isinstance(result.output, ClarifyResponseModel)
    assert result.output.data.status == "needs_clarification"
    assert result.output.data.question


async def test_run_pilgrimage_agent_returns_search_agent_result() -> None:
    db = MagicMock()
    model = TestModel(
        call_tools=[],
        seed=1,  # SearchResponseModel output tool
        custom_output_args={
            "intent": "search_nearby",
            "message": "宇治站附近有 1 处相关圣地。",
            "data": {
                "results": {
                    "rows": [],
                    "row_count": 0,
                    "strategy": "geo",
                    "status": "empty",
                    "metadata": {"radius_m": 5000},
                    "nearby_groups": [],
                }
            },
            "ui": {"component": "NearbyBubble"},
        },
    )

    result = await run_pilgrimage_agent(
        text="宇治站附近有什么圣地？",
        db=db,
        locale="zh",
        model=model,
    )

    assert result.intent == "search_nearby"
    assert isinstance(result.output, SearchResponseModel)


async def test_run_pilgrimage_agent_returns_route_agent_result() -> None:
    db = MagicMock()
    model = TestModel(
        call_tools=[],
        seed=2,  # RouteResponseModel output tool
        custom_output_args={
            "intent": "plan_route",
            "message": "已为你规划好路线。",
            "data": {
                "route": {
                    "ordered_points": [],
                    "point_count": 0,
                    "status": "ok",
                    "timed_itinerary": {},
                }
            },
            "ui": {"component": "RoutePlannerWizard"},
        },
    )

    result = await run_pilgrimage_agent(
        text="规划路线",
        db=db,
        locale="zh",
        model=model,
    )

    assert result.intent == "plan_route"
    assert isinstance(result.output, RouteResponseModel)


async def test_run_pilgrimage_agent_returns_qa_agent_result() -> None:
    db = MagicMock()
    model = TestModel(
        call_tools=[],
        seed=3,  # QAResponseModel output tool
        custom_output_args={
            "intent": "general_qa",
            "message": "建议你避开居民区大声喧哗。",
            "data": {"status": "info", "message": "建议你避开居民区大声喧哗。"},
            "ui": {"component": "GeneralAnswer"},
        },
    )

    result = await run_pilgrimage_agent(
        text="巡礼礼仪？",
        db=db,
        locale="zh",
        model=model,
    )

    assert result.intent == "general_qa"
    assert isinstance(result.output, QAResponseModel)
    assert result.message
