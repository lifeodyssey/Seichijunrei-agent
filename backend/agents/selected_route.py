"""Direct selected-point route execution (no ExecutorAgent needed)."""

from __future__ import annotations

import structlog

from backend.agents.agent_result import AgentResult, StepRecord
from backend.agents.handlers._helpers import optimize_route
from backend.agents.messages import build_message
from backend.agents.runtime_deps import OnStep
from backend.agents.runtime_models import RouteDataModel, RouteModel, RouteResponseModel
from backend.infrastructure.supabase.client import SupabaseClient

logger = structlog.get_logger(__name__)


async def execute_selected_route(
    *,
    point_ids: list[str],
    origin: str | None,
    locale: str,
    db: object,
    on_step: OnStep | None = None,
) -> AgentResult:
    """Route user-selected point IDs directly, returning AgentResult."""
    if on_step is not None:
        await on_step("plan_selected", "running", {}, "", "")

    if not point_ids:
        return _error_result("point_ids is required", locale)

    if not isinstance(db, SupabaseClient):
        return _error_result("get_points_by_ids not available", locale)

    rows = [dict(row) for row in await db.points.get_points_by_ids(point_ids)]
    params: dict[str, object] = {"point_ids": point_ids}
    if origin:
        params["origin"] = origin

    raw = optimize_route(rows, params, origin, tool_name="plan_selected")
    success = bool(raw.get("success", False))
    data = raw.get("data")
    route_data = data if isinstance(data, dict) else {}

    step = StepRecord(
        tool="plan_selected",
        success=success,
        params=params,
        data=route_data or None,
        error=str(raw["error"]) if not success and raw.get("error") else None,
    )

    if on_step is not None:
        await on_step("plan_selected", "done", route_data, "", "")

    route_model = RouteModel.model_validate(route_data) if route_data else RouteModel()
    count = int(route_data.get("point_count", 0) or 0)
    message = build_message("plan_selected", count, locale)

    output = RouteResponseModel(
        intent="plan_selected",
        message=message,
        data=RouteDataModel(route=route_model),
    )
    return AgentResult(
        output=output,
        steps=[step],
        tool_state={"plan_selected": route_data} if route_data else {},
    )


def _error_result(error: str, locale: str) -> AgentResult:
    output = RouteResponseModel(
        intent="plan_selected",
        message=error,
        data=RouteDataModel(route=RouteModel()),
    )
    return AgentResult(
        output=output,
        steps=[StepRecord(tool="plan_selected", success=False, error=error)],
    )
