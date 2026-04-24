"""Unit tests for the PydanticAI-native pilgrimage agent wrapper."""

from __future__ import annotations

from unittest.mock import MagicMock

from pydantic_ai.models.test import TestModel

from backend.agents.pilgrimage_runner import run_pilgrimage_agent


async def test_run_pilgrimage_agent_adapts_clarify_output_to_pipeline_result() -> None:
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
                        "cover_url": None,
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
    assert result.final_output["status"] == "needs_clarification"
    assert "question" in result.final_output
    assert "candidates" in result.final_output


async def test_run_pilgrimage_agent_adapts_search_output_to_pipeline_result() -> None:
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
    assert result.final_output["status"] == "empty"
    assert "results" in result.final_output


async def test_run_pilgrimage_agent_adapts_route_output_to_pipeline_result() -> None:
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
    assert "route" in result.final_output
    assert "timed_itinerary" in result.final_output["route"]


async def test_run_pilgrimage_agent_adapts_qa_output_to_pipeline_result() -> None:
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
    assert result.final_output["status"] == "info"
    assert result.final_output["message"]
