"""Unit tests for backend.interfaces.response_builder."""

from __future__ import annotations

from backend.agents.agent_result import AgentResult, StepRecord
from backend.agents.runtime_models import (
    QADataModel,
    QAResponseModel,
    ResultsMetaModel,
    RouteDataModel,
    RouteModel,
    RouteResponseModel,
    SearchDataModel,
    SearchResponseModel,
)
from backend.application.errors import InvalidInputError
from backend.interfaces.response_builder import (
    _UI_MAP,
    agent_result_to_response,
    application_error_response,
    serialize_step_record,
)


def _make_result(
    intent: str = "search_bangumi",
    tool_state: dict[str, object] | None = None,
    steps: list[StepRecord] | None = None,
    message: str = "",
) -> AgentResult:
    """Build a fake AgentResult for response_builder tests.

    The typed output uses default/empty models; the response_builder reads
    raw dicts from tool_state when present, so we do not model_validate
    the tool_state payload (it may contain partial/non-conforming data).
    """
    ts = tool_state or {}

    if intent in ("search_bangumi", "search_nearby"):
        output = SearchResponseModel(
            intent=intent,
            message=message,
            data=SearchDataModel(results=ResultsMetaModel()),
        )
    elif intent in ("plan_route", "plan_selected"):
        output = RouteResponseModel(
            intent=intent,
            message=message,
            data=RouteDataModel(route=RouteModel()),
        )
    else:
        output = QAResponseModel(
            intent="general_qa",
            message=message,
            data=QADataModel(message=message),
        )

    return AgentResult(
        output=output,
        steps=steps or [],
        tool_state=ts,
    )


class TestAgentResultToResponse:
    def test_search_intent_with_results(self) -> None:
        result = _make_result(
            intent="search_bangumi",
            message="Found 3 spots.",
            tool_state={
                "search_bangumi": {
                    "rows": [{"id": "1"}],
                    "row_count": 1,
                    "status": "ok",
                },
            },
        )
        resp = agent_result_to_response(result, include_debug=False)

        assert resp.success is True
        assert resp.status == "ok"
        assert resp.intent == "search_bangumi"
        assert "results" in resp.data
        assert resp.ui == {"component": "PilgrimageGrid"}
        assert resp.errors == []

    def test_route_intent_with_route(self) -> None:
        result = _make_result(
            intent="plan_route",
            message="Route ready.",
            tool_state={
                "plan_route": {
                    "ordered_points": [],
                    "point_count": 0,
                    "status": "ok",
                },
            },
        )
        resp = agent_result_to_response(result, include_debug=False)

        assert resp.success is True
        assert "route" in resp.data
        assert "results" not in resp.data
        assert resp.ui == {"component": "RoutePlannerWizard"}

    def test_error_results_produce_error_list(self) -> None:
        result = _make_result(
            intent="search_bangumi",
            steps=[
                StepRecord(tool="search_bangumi", success=False, error="db down"),
                StepRecord(tool="plan_route", success=False, error="timeout"),
            ],
        )
        resp = agent_result_to_response(result, include_debug=False)

        assert resp.success is False
        assert len(resp.errors) == 2
        assert resp.errors[0].code == "pipeline_error"
        assert resp.errors[0].message == "A processing step failed."

    def test_error_results_include_detail_in_debug_mode(self) -> None:
        result = _make_result(
            intent="search_bangumi",
            steps=[
                StepRecord(tool="search_bangumi", success=False, error="db down"),
            ],
        )
        resp = agent_result_to_response(result, include_debug=True)

        assert resp.errors[0].message == "db down"

    def test_empty_results_produce_empty_status(self) -> None:
        result = _make_result(
            intent="search_bangumi",
            message="No results.",
            tool_state={
                "search_bangumi": {
                    "rows": [],
                    "row_count": 0,
                    "status": "empty",
                },
            },
        )
        resp = agent_result_to_response(result, include_debug=False)

        assert resp.success is True
        assert resp.status == "empty"
        assert "results" in resp.data

    def test_empty_tool_state(self) -> None:
        result = _make_result(intent="search_bangumi")
        resp = agent_result_to_response(result, include_debug=False)

        assert resp.success is True
        assert "results" in resp.data

    def test_debug_includes_steps(self) -> None:
        result = _make_result(
            intent="search_bangumi",
            message="ok",
            steps=[
                StepRecord(
                    tool="resolve_anime",
                    success=True,
                    data={"bangumi_id": "1"},
                ),
                StepRecord(tool="search_bangumi", success=True, data={"rows": []}),
            ],
        )
        resp = agent_result_to_response(result, include_debug=True)

        assert resp.debug is not None
        assert len(resp.debug["steps"]) == 2


class TestUIMap:
    def test_search_bangumi_component(self) -> None:
        assert _UI_MAP["search_bangumi"] == "PilgrimageGrid"

    def test_search_nearby_component(self) -> None:
        assert _UI_MAP["search_nearby"] == "NearbyMap"

    def test_plan_route_component(self) -> None:
        assert _UI_MAP["plan_route"] == "RoutePlannerWizard"

    def test_plan_selected_component(self) -> None:
        assert _UI_MAP["plan_selected"] == "RoutePlannerWizard"

    def test_greet_user_component(self) -> None:
        assert _UI_MAP["greet_user"] == "GeneralAnswer"

    def test_answer_question_component(self) -> None:
        assert _UI_MAP["answer_question"] == "GeneralAnswer"

    def test_unclear_component(self) -> None:
        assert _UI_MAP["unclear"] == "Clarification"

    def test_unknown_intent_returns_no_ui(self) -> None:
        """Unknown intents fall through to general_qa, which maps to GeneralAnswer."""
        result = _make_result(intent="totally_unknown")
        resp = agent_result_to_response(result, include_debug=False)
        # Falls back to general_qa via QAResponseModel, which has a UI mapping
        assert resp.intent == "general_qa"
        assert resp.ui == {"component": "GeneralAnswer"}


class TestApplicationErrorResponse:
    def test_maps_error_to_failed_response(self) -> None:
        exc = InvalidInputError("bad request", field="text")
        resp = application_error_response(exc)

        assert resp.success is False
        assert resp.status == "error"
        assert resp.intent == "unknown"
        assert resp.message == "bad request"
        assert resp.errors[0].code == "invalid_input"
        assert resp.errors[0].details == {"field": "text"}


class TestSerializeStepRecord:
    def test_serializes_all_fields(self) -> None:
        step = StepRecord(
            tool="resolve_anime",
            success=True,
            data={"bangumi_id": "1"},
            error=None,
        )
        out = serialize_step_record(step)
        assert out == {
            "tool": "resolve_anime",
            "success": True,
            "error": None,
            "data": {"bangumi_id": "1"},
        }

    def test_serializes_failed_step(self) -> None:
        step = StepRecord(tool="search_bangumi", success=False, error="not found")
        out = serialize_step_record(step)
        assert out["success"] is False
        assert out["error"] == "not found"
        assert out["data"] is None
