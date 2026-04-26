"""Handler: plan_selected — route a user-selected list of point IDs."""

from __future__ import annotations

from backend.agents.handlers._helpers import optimize_route
from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep
from backend.infrastructure.supabase.client import SupabaseClient


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Route a user-selected list of point IDs."""
    params = step.params or {}
    raw_point_ids = params.get("point_ids")
    if not isinstance(raw_point_ids, list):
        raw_point_ids = []
    point_ids = [
        str(point_id).strip() for point_id in raw_point_ids if str(point_id).strip()
    ]
    if not point_ids:
        return HandlerResult.fail("plan_selected", "point_ids is required")

    if not isinstance(db, SupabaseClient):
        return HandlerResult.fail("plan_selected", "get_points_by_ids not available")

    rows: list[dict[str, object]] = [
        dict(row) for row in await db.points.get_points_by_ids(point_ids)
    ]
    origin_raw = params.get("origin") or context.get("last_location")
    origin = origin_raw if isinstance(origin_raw, str) else None
    return optimize_route(rows, params, origin, tool_name="plan_selected")
