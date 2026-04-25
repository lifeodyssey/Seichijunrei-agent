"""Response builder clarify passthrough tests.

Verifies that pipeline_result_to_public_response preserves clarify stage
fields in the final public API response, instead of silently dropping them
with the old results/route-only dict comprehension.
"""

from __future__ import annotations

from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan
from backend.interfaces.response_builder import pipeline_result_to_public_response


def _make_plan() -> ExecutionPlan:
    return ExecutionPlan(steps=[], reasoning="test", locale="zh")


def test_response_builder_preserves_clarify_payload():
    """Clarify data must be present in response.data, not silently dropped."""
    result = PipelineResult(intent="clarify", plan=_make_plan())
    result.final_output = {
        "success": True,
        "status": "needs_clarification",
        "message": "你是指哪部凉宫？",
        "question": "你是指哪部凉宫？",
        "options": ["凉宫春日的忧郁", "凉宫春日的消失"],
        "candidates": [
            {
                "title": "涼宮ハルヒの憂鬱",
                "cover_url": None,
                "spot_count": 0,
                "city": "",
            },
        ],
    }

    response = pipeline_result_to_public_response(result, include_debug=False)

    assert response.intent == "clarify"
    assert response.status == "needs_clarification"
    assert response.message == "你是指哪部凉宫？"
    assert response.data["question"] == "你是指哪部凉宫？"
    assert response.data["options"] == ["凉宫春日的忧郁", "凉宫春日的消失"]
    assert len(response.data["candidates"]) == 1
    assert response.data["candidates"][0]["title"] == "涼宮ハルヒの憂鬱"


def test_response_builder_preserves_route_data():
    """Route data must be present in response.data."""
    result = PipelineResult(intent="plan_route", plan=_make_plan())
    result.final_output = {
        "success": True,
        "status": "ok",
        "message": "已规划路线",
        "route": {
            "ordered_points": [{"id": "p1", "name": "station"}],
            "point_count": 1,
            "timed_itinerary": {
                "stops": [],
                "legs": [],
                "total_minutes": 30,
                "total_distance_m": 2000,
            },
        },
    }

    response = pipeline_result_to_public_response(result, include_debug=False)

    assert response.intent == "plan_route"
    assert "route" in response.data
    assert response.data["route"]["point_count"] == 1
    assert response.data["route"]["timed_itinerary"]["total_minutes"] == 30


def test_response_builder_preserves_search_results():
    """Search results must be present in response.data."""
    result = PipelineResult(intent="search_bangumi", plan=_make_plan())
    result.final_output = {
        "success": True,
        "status": "ok",
        "message": "Found 5 spots",
        "results": {
            "rows": [{"id": "p1", "name": "spot1"}],
            "row_count": 5,
        },
    }

    response = pipeline_result_to_public_response(result, include_debug=False)

    assert response.intent == "search_bangumi"
    assert "results" in response.data
    assert response.data["results"]["row_count"] == 5
