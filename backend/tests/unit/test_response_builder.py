"""Unit tests for backend.interfaces.response_builder."""

from __future__ import annotations

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.application.errors import InvalidInputError
from backend.interfaces.response_builder import (
    _UI_MAP,
    application_error_response,
    pipeline_result_to_public_response,
    serialize_step_result,
)


def _make_plan(
    steps: list[PlanStep] | None = None,
    locale: str = "ja",
) -> ExecutionPlan:
    return ExecutionPlan(
        reasoning="test",
        locale=locale,
        steps=steps
        or [PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "1"})],
    )


def _make_result(
    intent: str = "search_bangumi",
    final_output: dict[str, object] | None = None,
    step_results: list[StepResult] | None = None,
    steps: list[PlanStep] | None = None,
) -> PipelineResult:
    plan = _make_plan(steps=steps)
    result = PipelineResult(intent=intent, plan=plan)
    result.final_output = final_output or {}
    if step_results is not None:
        result.step_results = step_results
    return result


class TestPipelineResultToPublicResponse:
    def test_search_intent_with_results(self) -> None:
        result = _make_result(
            intent="search_bangumi",
            final_output={
                "success": True,
                "status": "ok",
                "message": "Found 3 spots.",
                "results": {"rows": [{"id": "1"}], "row_count": 1},
            },
        )
        resp = pipeline_result_to_public_response(result, include_debug=False)

        assert resp.success is True
        assert resp.status == "ok"
        assert resp.intent == "search_bangumi"
        assert "results" in resp.data
        assert resp.ui == {"component": "PilgrimageGrid"}
        assert resp.errors == []

    def test_route_intent_with_route(self) -> None:
        result = _make_result(
            intent="plan_route",
            steps=[PlanStep(tool=ToolName.PLAN_ROUTE, params={"origin": "X"})],
            final_output={
                "success": True,
                "status": "ok",
                "message": "Route ready.",
                "route": {"ordered_points": [], "point_count": 0},
            },
        )
        resp = pipeline_result_to_public_response(result, include_debug=False)

        assert resp.success is True
        assert "route" in resp.data
        assert "results" not in resp.data
        assert resp.ui == {"component": "RoutePlannerWizard"}

    def test_error_results_produce_error_list(self) -> None:
        result = _make_result(
            final_output={
                "success": False,
                "status": "error",
                "message": "",
                "errors": ["db down", "timeout"],
            },
        )
        resp = pipeline_result_to_public_response(result, include_debug=False)

        assert resp.success is False
        assert resp.status == "error"
        assert len(resp.errors) == 2
        assert resp.errors[0].code == "pipeline_error"
        assert resp.errors[0].message == "A processing step failed."

    def test_error_results_include_detail_in_debug_mode(self) -> None:
        result = _make_result(
            final_output={
                "success": False,
                "status": "error",
                "errors": ["db down"],
            },
        )
        resp = pipeline_result_to_public_response(result, include_debug=True)

        assert resp.errors[0].message == "db down"

    def test_empty_results_produce_empty_status(self) -> None:
        result = _make_result(
            final_output={
                "success": True,
                "status": "empty",
                "message": "No results.",
                "results": {"rows": [], "row_count": 0},
            },
        )
        resp = pipeline_result_to_public_response(result, include_debug=False)

        assert resp.success is True
        assert resp.status == "empty"
        assert "results" in resp.data

    def test_empty_final_output(self) -> None:
        result = _make_result(final_output={})
        # step_results empty => success is True (vacuously)
        resp = pipeline_result_to_public_response(result, include_debug=False)

        assert resp.success is True
        assert resp.data == {}

    def test_debug_includes_plan_and_steps(self) -> None:
        steps = [
            PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "test"}),
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "1"}),
        ]
        result = _make_result(
            steps=steps,
            step_results=[
                StepResult(
                    tool="resolve_anime", success=True, data={"bangumi_id": "1"}
                ),
                StepResult(tool="search_bangumi", success=True, data={"rows": []}),
            ],
            final_output={"success": True, "status": "ok", "message": "ok"},
        )
        resp = pipeline_result_to_public_response(result, include_debug=True)

        assert resp.debug is not None
        assert resp.debug["plan"]["steps"] == ["resolve_anime", "search_bangumi"]
        assert len(resp.debug["step_results"]) == 2

    def test_non_list_errors_ignored(self) -> None:
        result = _make_result(
            final_output={
                "success": False,
                "status": "error",
                "errors": "string-error",
            },
        )
        resp = pipeline_result_to_public_response(result, include_debug=False)
        assert resp.errors == []


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
        result = _make_result(
            intent="totally_unknown",
            final_output={"success": True, "status": "ok"},
        )
        resp = pipeline_result_to_public_response(result, include_debug=False)
        assert resp.ui is None


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


class TestSerializeStepResult:
    def test_serializes_all_fields(self) -> None:
        step = StepResult(
            tool="resolve_anime",
            success=True,
            data={"bangumi_id": "1"},
            error=None,
        )
        out = serialize_step_result(step)
        assert out == {
            "tool": "resolve_anime",
            "success": True,
            "error": None,
            "data": {"bangumi_id": "1"},
        }

    def test_serializes_failed_step(self) -> None:
        step = StepResult(tool="search_bangumi", success=False, error="not found")
        out = serialize_step_result(step)
        assert out["success"] is False
        assert out["error"] == "not found"
        assert out["data"] is None
