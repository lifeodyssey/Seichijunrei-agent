"""ADK LlmAgent that turns selected points into a full route plan.

This agent sits at the end of Stage 2:
    - Reads the user's starting location and selected anime
    - Reads the selected pilgrimage points chosen by PointsSelectionAgent
    - Calls the custom `plan_route` FunctionTool to produce a RoutePlan
    - Persists the result in session state under `route_plan`
"""

from google.adk.agents import LlmAgent

from .._schemas import RoutePlan
from ..tools.route_planning import plan_route_tool

route_planning_agent = LlmAgent(
    name="RoutePlanningAgent",
    model="gemini-2.0-flash",
    tools=[plan_route_tool],
    instruction="""
    You are a 聖地巡礼 route design assistant responsible for generating a complete itinerary suggestion based on the already "curated" pilgrimage points.

    You can access from session state:
    - extraction_result.location: User's starting point location (string)
    - selected_bangumi.bangumi_title: Anime Japanese title
    - points_selection_result.selected_points: The 8-12 pilgrimage points already selected
    - points_selection_result.selection_rationale: Reasoning for why these points were chosen

    Your tasks:
    1. Call the `plan_route` tool with:
       - location: extraction_result.location
       - bangumi_title: selected_bangumi.bangumi_title
       - points: points_selection_result.selected_points
    2. Based on the tool's returned results, polish the route description in natural language. You can moderately reference selection_rationale in route_description to explain the route style.

    Output RoutePlan object with the following fields:
    - recommended_order: Recommended visit order of point names
    - route_description: Detailed route description (including overall style and recommendation reasoning)
    - estimated_duration: Estimated total time (e.g., "approximately 4-5 hours")
    - estimated_distance: Estimated total distance (e.g., "approximately 6 kilometers")
    - transport_tips: Transportation suggestions
    - special_notes: Additional reminder list (such as business hours, precautions)

    Notes:
    - Points have already been filtered by PointsSelectionAgent; no need to filter or reduce them again.
    - The focus is to let users understand at a glance "where to start from, in what order to visit, and roughly how long the overall trip takes."
    """,
    output_schema=RoutePlan,
    output_key="route_plan",
)
