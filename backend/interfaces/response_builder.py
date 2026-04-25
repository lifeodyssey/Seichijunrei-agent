"""Response building utilities for the public API surface.

Converts ``AgentResult`` / ``ApplicationError`` instances into
the stable ``PublicAPIResponse`` contract that HTTP adapters return.
"""

from __future__ import annotations

from backend.agents.agent_result import AgentResult, StepRecord
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


def _status_from_payload(payload: object, *, fallback: str) -> str:
    if isinstance(payload, dict):
        value = payload.get("status")
        if isinstance(value, str) and value:
            return value
    return fallback


def agent_result_to_response(
    result: AgentResult,
    *,
    include_debug: bool,
) -> PublicAPIResponse:
    """Map an ``AgentResult`` to the stable ``PublicAPIResponse``."""
    from backend.agents.runtime_models import (
        ClarifyResponseModel,
        RouteResponseModel,
        SearchResponseModel,
    )

    output = result.output
    component = _UI_MAP.get(result.intent)
    ui = {"component": component} if component else None

    # Build data dict from typed output + tool_state
    data: dict[str, object] = {}
    status = "ok"

    if isinstance(output, ClarifyResponseModel):
        status = "needs_clarification"
        data = output.data.model_dump(mode="json")
    elif isinstance(output, SearchResponseModel):
        tool_key = str(output.intent)
        tool_payload = result.tool_state.get(tool_key)
        payload = (
            tool_payload
            if isinstance(tool_payload, dict)
            else output.data.results.model_dump(mode="json")
        )
        status = _status_from_payload(payload, fallback="ok")
        data["results"] = payload
    elif isinstance(output, RouteResponseModel):
        tool_key = str(output.intent)
        tool_payload = result.tool_state.get(tool_key)
        payload = (
            tool_payload
            if isinstance(tool_payload, dict)
            else output.data.route.model_dump(mode="json")
        )
        status = _status_from_payload(payload, fallback="ok")
        data["route"] = payload
    else:
        payload = output.data.model_dump(mode="json")
        status = _status_from_payload(payload, fallback="info")
        data.update(payload)

    errors: list[PublicAPIError] = []
    failed_steps = [s for s in result.steps if not s.success and s.error]
    if failed_steps:
        errors = [
            PublicAPIError(
                code="pipeline_error",
                message=(
                    "A processing step failed." if not include_debug else str(s.error)
                ),
            )
            for s in failed_steps
        ]

    response = PublicAPIResponse(
        success=result.success,
        status=status,
        intent=result.intent,
        message=result.message,
        data=data,
        errors=errors,
        ui=ui,
    )

    if include_debug:
        response.debug = {
            "steps": [serialize_step_record(s) for s in result.steps],
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


def serialize_step_record(step: StepRecord) -> dict[str, object]:
    """Serialize a single ``StepRecord`` for debug output."""
    return {
        "tool": step.tool,
        "success": step.success,
        "error": step.error,
        "data": step.data,
    }
