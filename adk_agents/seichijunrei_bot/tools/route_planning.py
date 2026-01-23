from google.adk.tools import FunctionTool

from application.use_cases import PlanRoute
from services.route_planner_gateway import SimpleRoutePlannerGateway
from utils.logger import get_logger

logger = get_logger(__name__)


def plan_route(
    location: str,
    bangumi_title: str,
    points: list[dict],
) -> dict:
    """
    Generate a simplified seichijunrei route plan for the selected anime.

    This custom tool is intentionally lightweight: it delegates to
    SimpleRoutePlanner to sort points heuristically and to build a
    human-readable description, demonstrating ADK custom tool integration.
    """
    logger.info(
        "route_planning_tool_called",
        location=location,
        bangumi=bangumi_title,
        points_count=len(points),
    )

    use_case = PlanRoute(planner=SimpleRoutePlannerGateway())

    try:
        plan = use_case(
            origin=location,
            anime=bangumi_title,
            points=points,
        )
        logger.info(
            "route_plan_generated",
            duration=plan.get("estimated_duration"),
            distance=plan.get("estimated_distance"),
        )
        return plan
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.error(
            "route_planning_failed",
            error=str(exc),
            exc_info=True,
        )
        # Fallback: basic suggestion using first few points
        fallback_order = [p.get("name", "") for p in points[:10]]
        return {
            "recommended_order": fallback_order,
            "route_description": (
                f"Starting from {location}, visit the 聖地巡礼 points of '{bangumi_title}' in approximate order."
            ),
            "estimated_duration": "approximately half a day",
            "estimated_distance": "varies by point distribution",
            "transport_tips": "Recommend combining walking with public transportation.",
            "special_notes": [
                "Please confirm opening hours and accessibility of each point in advance."
            ],
        }


# ADK's FunctionTool derives the tool name and description from the function
# signature and docstring, so we only need to wrap the callable.
plan_route_tool = FunctionTool(plan_route)
