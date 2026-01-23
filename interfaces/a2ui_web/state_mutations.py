"""Deterministic state mutations for the A2UI web UI.

These helpers modify the ADK-style session state dict in-place and keep
derived fields (like `route_plan`) consistent, without invoking the LLM.
"""

from __future__ import annotations

from typing import Any

from application.use_cases import PlanRoute
from services.route_planner_gateway import SimpleRoutePlannerGateway


def _replan_route(
    *, origin: str, anime: str, points: list[dict[str, Any]]
) -> dict[str, Any]:
    use_case = PlanRoute(planner=SimpleRoutePlannerGateway())
    return use_case(origin=origin, anime=anime, points=points)


def remove_selected_point_by_index(state: dict[str, Any], *, index_0: int) -> bool:
    """Remove a selected point (0-based) and recompute the route plan.

    Returns:
        True if the point was removed and `route_plan` updated, otherwise False.
    """
    points_selection = state.get("points_selection_result")
    if not isinstance(points_selection, dict):
        return False

    selected_points = points_selection.get("selected_points")
    if not isinstance(selected_points, list):
        return False

    if index_0 < 0 or index_0 >= len(selected_points):
        return False

    selected_points.pop(index_0)
    points_selection["selected_points"] = selected_points

    total_available = points_selection.get("total_available")
    if not isinstance(total_available, int):
        all_points = state.get("all_points")
        total_available = len(all_points) if isinstance(all_points, list) else 0
        points_selection["total_available"] = total_available
    points_selection["rejected_count"] = max(0, total_available - len(selected_points))

    # Mark manual override so future UIs can communicate that selection changed.
    rationale = points_selection.get("selection_rationale")
    if isinstance(rationale, str) and "User manually adjusted" not in rationale:
        points_selection["selection_rationale"] = (
            rationale + "\n\n(User manually adjusted the selection in the UI.)"
        )

    state["points_selection_result"] = points_selection

    extraction = state.get("extraction_result") or {}
    selected = state.get("selected_bangumi") or {}
    origin = extraction.get("location") if isinstance(extraction, dict) else ""
    origin = origin if isinstance(origin, str) else ""
    anime = selected.get("bangumi_title") if isinstance(selected, dict) else ""
    anime = anime if isinstance(anime, str) else ""

    state["route_plan"] = _replan_route(
        origin=origin, anime=anime, points=selected_points
    )
    return True
