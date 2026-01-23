"""Deterministic state mutations for the A2UI web UI.

These helpers modify the ADK-style session state dict in-place and keep
derived fields (like `route_plan`) consistent, without invoking the LLM.
"""

from __future__ import annotations

from typing import Any

from adk_agents.seichijunrei_bot._state import BANGUMI_CANDIDATES, SELECTED_BANGUMI
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


def select_candidate_by_index(state: dict[str, Any], *, index_1: int) -> bool:
    """Select a Bangumi candidate by 1-based index and update session state.

    This is a deterministic operation that:
    1. Validates the index against available candidates
    2. Sets SELECTED_BANGUMI from the candidate data
    3. Clears any existing Stage 2 state to prepare for route planning

    Args:
        state: Session state dict to modify in-place
        index_1: 1-based candidate index (matches UI display)

    Returns:
        True if selection succeeded, False if invalid index or no candidates
    """
    candidates_data = state.get(BANGUMI_CANDIDATES)
    if not isinstance(candidates_data, dict):
        return False

    candidates = candidates_data.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return False

    index_0 = index_1 - 1
    if index_0 < 0 or index_0 >= len(candidates):
        return False

    selected = candidates[index_0]

    # Build SELECTED_BANGUMI from candidate data
    # The candidate structure varies, so we normalize it
    bangumi_id = selected.get("id") or selected.get("bangumi_id")
    title = selected.get("title") or selected.get("name") or ""
    title_cn = selected.get("title_cn") or selected.get("name_cn") or title

    state[SELECTED_BANGUMI] = {
        "bangumi_id": bangumi_id,
        "bangumi_title": title_cn,
        "bangumi_title_original": title,
        "air_date": selected.get("air_date"),
        "summary": selected.get("summary"),
        "selection_index": index_1,
    }

    # Clear Stage 2 state keys so they're recomputed with new selection
    # (route_planning_agent will fill these in)
    for key in ["all_points", "points_meta", "points_selection_result", "route_plan"]:
        state.pop(key, None)

    return True
