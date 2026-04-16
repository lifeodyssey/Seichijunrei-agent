"""Handler: plan_route — sort search results into an optimised walking route."""

from __future__ import annotations

from backend.agents.handlers._helpers import optimize_route
from backend.agents.models import PlanStep, ToolName
from backend.agents.sql_agent import resolve_location


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    """Sort search results into an optimised walking route.

    Returns a dict with keys: tool, success, data?, error?
    """
    query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
        ToolName.SEARCH_NEARBY.value
    )
    query_payload = query_data if isinstance(query_data, dict) else {}
    rows = query_payload.get("rows", [])
    if not rows:
        return {"tool": "plan_route", "success": False, "error": "No points to route"}

    params = step.params or {}

    # Coordinate origin takes precedence over text origin — skip LLM-based resolution
    coord_lat = context.get("origin_lat")
    coord_lng = context.get("origin_lng")
    if isinstance(coord_lat, (int, float)) and isinstance(coord_lng, (int, float)):
        # Forward coordinate as "lat,lng" string so it survives into route history
        origin: str | None = f"{coord_lat},{coord_lng}"
        return optimize_route(rows, params, origin, tool_name="plan_route")

    origin_raw = params.get("origin") or context.get("last_location")
    origin = origin_raw if isinstance(origin_raw, str) else None

    # Resolve origin for geocoding clarification before optimizing
    if origin:
        resolved = await resolve_location(origin)
        if isinstance(resolved, list):
            return {
                "tool": "clarify",
                "success": True,
                "data": {
                    "question": f"「{origin}」に複数の候補があります。どちらですか？",
                    "options": [c.label for c in resolved],
                    "status": "needs_clarification",
                },
            }

    return optimize_route(rows, params, origin, tool_name="plan_route")
