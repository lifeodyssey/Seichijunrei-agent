"""Unit tests for to_response_data() on runtime models.

Each model exposes a to_response_data(tool_state) method that returns
(status, data_dict) — the same values the response builder needs.
"""

from __future__ import annotations

from backend.agents.runtime_models import (
    ClarifyCandidateModel,
    ClarifyDataModel,
    ClarifyResponseModel,
    GreetingResponseModel,
    QADataModel,
    QAResponseModel,
    ResultsMetaModel,
    RouteDataModel,
    RouteModel,
    RouteResponseModel,
    SearchDataModel,
    SearchResponseModel,
)


class TestClarifyResponseModelResponseData:
    def test_returns_needs_clarification_status(self) -> None:
        model = ClarifyResponseModel(
            intent="clarify",
            message="你是指哪部凉宫？",
            data=ClarifyDataModel(
                status="needs_clarification",
                question="你是指哪部凉宫？",
                options=["凉宫春日的忧郁", "凉宫春日的消失"],
                candidates=[
                    ClarifyCandidateModel(
                        title="涼宮ハルヒの憂鬱",
                        cover_url="",
                        spot_count=0,
                        city="",
                    ),
                ],
            ),
        )

        status, data = model.to_response_data({})

        assert status == "needs_clarification"
        assert data["question"] == "你是指哪部凉宫？"
        assert data["options"] == ["凉宫春日的忧郁", "凉宫春日的消失"]
        assert len(data["candidates"]) == 1
        assert data["candidates"][0]["title"] == "涼宮ハルヒの憂鬱"


class TestSearchResponseModelResponseData:
    def test_uses_tool_state_when_available(self) -> None:
        model = SearchResponseModel(
            intent="search_bangumi",
            message="Found spots",
            data=SearchDataModel(results=ResultsMetaModel()),
        )
        tool_state: dict[str, object] = {
            "search_bangumi": {
                "rows": [{"id": "1"}],
                "row_count": 1,
                "status": "ok",
            },
        }

        status, data = model.to_response_data(tool_state)

        assert status == "ok"
        assert "results" in data
        assert data["results"]["row_count"] == 1

    def test_falls_back_to_own_data(self) -> None:
        model = SearchResponseModel(
            intent="search_bangumi",
            message="Found spots",
            data=SearchDataModel(
                results=ResultsMetaModel(row_count=5, status="ok"),
            ),
        )

        status, data = model.to_response_data({})

        assert status == "ok"
        assert "results" in data
        assert data["results"]["row_count"] == 5

    def test_empty_status_from_tool_state(self) -> None:
        model = SearchResponseModel(
            intent="search_bangumi",
            message="No results",
            data=SearchDataModel(results=ResultsMetaModel()),
        )
        tool_state: dict[str, object] = {
            "search_bangumi": {
                "rows": [],
                "row_count": 0,
                "status": "empty",
            },
        }

        status, data = model.to_response_data(tool_state)

        assert status == "empty"


class TestRouteResponseModelResponseData:
    def test_uses_tool_state_when_available(self) -> None:
        model = RouteResponseModel(
            intent="plan_route",
            message="Route ready",
            data=RouteDataModel(route=RouteModel()),
        )
        tool_state: dict[str, object] = {
            "plan_route": {
                "ordered_points": [],
                "point_count": 0,
                "status": "ok",
            },
        }

        status, data = model.to_response_data(tool_state)

        assert status == "ok"
        assert "route" in data
        assert data["route"]["point_count"] == 0

    def test_falls_back_to_own_data(self) -> None:
        model = RouteResponseModel(
            intent="plan_route",
            message="Route ready",
            data=RouteDataModel(
                route=RouteModel(point_count=3, status="ok"),
            ),
        )

        status, data = model.to_response_data({})

        assert status == "ok"
        assert "route" in data
        assert data["route"]["point_count"] == 3

    def test_plan_selected_intent(self) -> None:
        model = RouteResponseModel(
            intent="plan_selected",
            message="Selected route",
            data=RouteDataModel(route=RouteModel()),
        )
        tool_state: dict[str, object] = {
            "plan_selected": {
                "ordered_points": [{"id": "p1"}],
                "point_count": 1,
                "status": "ok",
            },
        }

        status, data = model.to_response_data(tool_state)

        assert status == "ok"
        assert data["route"]["point_count"] == 1


class TestQAResponseModelResponseData:
    def test_returns_info_status(self) -> None:
        model = QAResponseModel(
            intent="general_qa",
            message="Some answer",
            data=QADataModel(status="info", message="Some answer"),
        )

        status, data = model.to_response_data({})

        assert status == "info"
        assert data["status"] == "info"
        assert data["message"] == "Some answer"

    def test_returns_needs_clarification_status(self) -> None:
        model = QAResponseModel(
            intent="general_qa",
            message="Need more info",
            data=QADataModel(
                status="needs_clarification",
                message="Need more info",
            ),
        )

        status, data = model.to_response_data({})

        assert status == "needs_clarification"


class TestGreetingResponseModelResponseData:
    def test_returns_info_status(self) -> None:
        model = GreetingResponseModel(
            intent="greet_user",
            message="Hello!",
            data=QADataModel(status="info", message="Hello!"),
        )

        status, data = model.to_response_data({})

        assert status == "info"
        assert data["status"] == "info"
        assert data["message"] == "Hello!"
