"""Response building utilities for the public API surface.

Converts internal ``PipelineResult`` / ``ApplicationError`` instances into
the stable ``PublicAPIResponse`` contract that HTTP adapters return.
"""

from __future__ import annotations

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.application.errors import ApplicationError
from backend.interfaces.schemas import PublicAPIError, PublicAPIResponse

_UI_MAP: dict[str, str] = {
    "search_bangumi": "PilgrimageGrid",
    "search_nearby": "NearbyMap",
    "plan_route": "RoutePlannerWizard",
    "plan_selected": "RoutePlannerWizard",
    "general_qa": "GeneralAnswer",
    "answer_question": "GeneralAnswer",
    "greet_user": "GeneralAnswer",
    "unclear": "Clarification",
    "clarify": "Clarification",
}


def pipeline_result_to_public_response(
    result: PipelineResult,
    *,
    include_debug: bool,
) -> PublicAPIResponse:
    """Map a ``PipelineResult`` to the stable ``PublicAPIResponse``."""
    final_output = result.final_output or {}
    raw_errors = final_output.get("errors", [])
    error_list = raw_errors if isinstance(raw_errors, list) else []
    errors = [
        PublicAPIError(
            code="pipeline_error",
            message="A processing step failed." if not include_debug else str(error),
        )
        for error in error_list
    ]
    component = _UI_MAP.get(result.intent)
    ui = {"component": component} if component else None
    data = {
        key: value
        for key, value in final_output.items()
        if key not in {"success", "intent", "errors", "status", "message"}
        and value is not None
    }
    response = PublicAPIResponse(
        success=bool(final_output.get("success", result.success)),
        status=str(final_output.get("status", "ok" if result.success else "error")),
        intent=result.intent,
        message=str(final_output.get("message") or ""),
        data=data,
        errors=errors,
        ui=ui,
    )

    if include_debug:
        response.debug = {
            "plan": {
                "intent": result.intent,
                "reasoning": result.plan.reasoning,
                "steps": [
                    getattr(step.tool, "value", str(step.tool))
                    for step in result.plan.steps
                ],
            },
            "step_results": [
                serialize_step_result(step) for step in result.step_results
            ],
        }

    return response


def application_error_response(exc: ApplicationError) -> PublicAPIResponse:
    """Map an ``ApplicationError`` to a failed ``PublicAPIResponse``."""
    return PublicAPIResponse(
        success=False,
        status="error",
        intent="unknown",
        message=exc.message,
        errors=[
            PublicAPIError(
                code=exc.error_code.value,
                message=exc.message,
                details=exc.details,
            )
        ],
    )


def serialize_step_result(step: StepResult) -> dict[str, object]:
    """Serialize a single ``StepResult`` for debug output."""
    return {
        "tool": step.tool,
        "success": step.success,
        "error": step.error,
        "data": step.data,
    }
