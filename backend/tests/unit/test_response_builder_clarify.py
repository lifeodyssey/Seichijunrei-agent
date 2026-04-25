"""Response builder clarify passthrough tests.

Verifies that agent_result_to_response preserves clarify stage
fields in the final public API response, instead of silently dropping them
with the old results/route-only dict comprehension.
"""

from __future__ import annotations

from backend.agents.agent_result import AgentResult
from backend.agents.runtime_models import (
    ClarifyDataModel,
    ClarifyResponseModel,
    ResultsMetaModel,
    RouteDataModel,
    RouteModel,
    RouteResponseModel,
    SearchDataModel,
    SearchResponseModel,
)
from backend.interfaces.response_builder import agent_result_to_response


def test_response_builder_preserves_clarify_payload():
    """Clarify data must be present in response.data, not silently dropped."""
    output = ClarifyResponseModel(
        intent="clarify",
        message="你是指哪部凉宫？",
        data=ClarifyDataModel(
            status="needs_clarification",
            question="你是指哪部凉宫？",
            options=["凉宫春日的忧郁", "凉宫春日的消失"],
            candidates=[
                {
                    "title": "涼宮ハルヒの憂鬱",
                    "cover_url": None,
                    "spot_count": 0,
                    "city": "",
                },
            ],
        ),
    )
    result = AgentResult(output=output, steps=[], tool_state={})

    response = agent_result_to_response(result, include_debug=False)

    assert response.intent == "clarify"
    assert response.status == "needs_clarification"
    assert response.message == "你是指哪部凉宫？"
    assert response.data["question"] == "你是指哪部凉宫？"
    assert response.data["options"] == ["凉宫春日的忧郁", "凉宫春日的消失"]
    assert len(response.data["candidates"]) == 1
    assert response.data["candidates"][0]["title"] == "涼宮ハルヒの憂鬱"


def test_response_builder_preserves_route_data():
    """Route data must be present in response.data."""
    output = RouteResponseModel(
        intent="plan_route",
        message="已规划路线",
        data=RouteDataModel(
            route=RouteModel(
                ordered_points=[
                    {
                        "id": "p1",
                        "name": "station",
                        "latitude": 34.88,
                        "longitude": 135.80,
                    }
                ],
                point_count=1,
                timed_itinerary={
                    "stops": [],
                    "legs": [],
                    "total_minutes": 30,
                    "total_distance_m": 2000,
                },
            ),
        ),
    )
    result = AgentResult(output=output, steps=[], tool_state={})

    response = agent_result_to_response(result, include_debug=False)

    assert response.intent == "plan_route"
    assert "route" in response.data
    assert response.data["route"]["point_count"] == 1
    assert response.data["route"]["timed_itinerary"]["total_minutes"] == 30


def test_response_builder_preserves_search_results():
    """Search results must be present in response.data."""
    output = SearchResponseModel(
        intent="search_bangumi",
        message="Found 5 spots",
        data=SearchDataModel(
            results=ResultsMetaModel(
                rows=[
                    {
                        "id": "p1",
                        "name": "spot1",
                        "latitude": 34.88,
                        "longitude": 135.80,
                    }
                ],
                row_count=5,
            ),
        ),
    )
    result = AgentResult(output=output, steps=[], tool_state={})

    response = agent_result_to_response(result, include_debug=False)

    assert response.intent == "search_bangumi"
    assert "results" in response.data
    assert response.data["results"]["row_count"] == 5
