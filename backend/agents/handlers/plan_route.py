"""Handler: plan_route — sort search results into an optimised walking route."""

from __future__ import annotations

from backend.agents.handlers._helpers import optimize_route
from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep, ToolName
from backend.agents.route_area_splitter import AreaSplitResult, split_into_areas
from backend.agents.sql_agent import resolve_location


def _build_clarify_candidates(labels: list[str]) -> list[dict[str, object]]:
    """Build minimal clarify candidates for ambiguous route origins."""
    return [
        {
            "title": label,
            "cover_url": None,
            "spot_count": 0,
            "city": "",
        }
        for label in labels
    ]


def _build_multi_area_route(
    rows: list[dict[str, object]],
    split: AreaSplitResult,
    params: dict[str, object],
    origin: str | None,
) -> HandlerResult:
    """Build route with multiple areas, each optimised independently."""
    visit_order = split.recommended_order or list(range(len(split.areas)))
    areas_data: list[dict[str, object]] = []
    all_ordered_points: list[dict[str, object]] = []

    for order_idx, area_idx in enumerate(visit_order):
        if area_idx >= len(split.areas):
            continue
        area = split.areas[area_idx]
        area_rows = [rows[i] for i in area.point_indices if i < len(rows)]
        if not area_rows:
            continue
        area_origin = origin if order_idx == 0 else None
        area_result = optimize_route(
            area_rows, params, area_origin, tool_name="plan_route"
        )
        area_info: dict[str, object] = {
            "name": area.name,
            "station": area.station,
            "point_count": len(area_rows),
            "order": order_idx,
        }
        if area_result.success and area_result.data:
            area_info["route"] = area_result.data
            ordered = area_result.data.get("ordered_points", [])
            if isinstance(ordered, list):
                all_ordered_points.extend(ordered)
        areas_data.append(area_info)

    return HandlerResult.ok(
        "plan_route",
        {
            "areas": areas_data,
            "ordered_points": all_ordered_points,
            "point_count": len(all_ordered_points),
            "total_areas": len(areas_data),
            "source": "llm",
            "status": "ok",
            "summary": {
                "point_count": len(all_ordered_points),
                "total_areas": len(areas_data),
                "total_points_input": len(rows),
            },
        },
    )


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Sort search results into an optimised walking route."""
    query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
        ToolName.SEARCH_NEARBY.value
    )
    query_payload = query_data if isinstance(query_data, dict) else {}
    rows = query_payload.get("rows", [])
    if not rows:
        return HandlerResult.fail("plan_route", "No points to route")

    params = step.params or {}

    # Coordinate origin takes precedence over text origin — skip LLM-based resolution
    coord_lat = context.get("origin_lat")
    coord_lng = context.get("origin_lng")
    if isinstance(coord_lat, (int, float)) and isinstance(coord_lng, (int, float)):
        origin: str | None = f"{coord_lat},{coord_lng}"
        return await _route_with_area_split(rows, params, origin)

    origin_raw = params.get("origin") or context.get("last_location")
    origin = origin_raw if isinstance(origin_raw, str) else None

    # Resolve origin for geocoding clarification before optimizing
    if origin:
        resolved = await resolve_location(origin)
        if isinstance(resolved, list):
            options = [c.label for c in resolved]
            return HandlerResult.ok(
                "clarify",
                {
                    "question": f"「{origin}」に複数の候補があります。どちらですか？",
                    "options": options,
                    "candidates": _build_clarify_candidates(options),
                    "status": "needs_clarification",
                },
            )

    return await _route_with_area_split(rows, params, origin)


async def _route_with_area_split(
    rows: list[dict[str, object]],
    params: dict[str, object],
    origin: str | None,
) -> HandlerResult:
    """Try LLM area splitting for large sets, fall back to single-area."""
    if len(rows) > 10:
        split = await split_into_areas(rows)
        if split is not None and len(split.areas) > 1:
            return _build_multi_area_route(rows, split, params, origin)
    return optimize_route(rows, params, origin, tool_name="plan_route")
