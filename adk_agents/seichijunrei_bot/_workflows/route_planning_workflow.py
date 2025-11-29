"""Stage 2 workflow: selection + points search + intelligent filtering.

This SequentialAgent represents the second stage of the simplified Capstone
architecture. It assumes that:
    - Stage 1 has already populated `bangumi_candidates` in session state.
    - The current user input expresses a choice among those candidates.

Planned sub-agents (final design):
    1. UserSelectionAgent      – interpret user choice into selected_bangumi
    2. PointsSearchAgent       – fetch ALL Anitabi points for that bangumi
    3. PointsSelectionAgent    – LLM selection of the best 8–12 points
    4. RoutePlanningAgent      – call a custom tool to generate final route

In this step we wire the first three; RoutePlanningAgent will be added once
the route planning tool is implemented in a later phase.
"""

from google.adk.agents import SequentialAgent

from .._agents.points_search_agent import points_search_agent
from .._agents.points_selection_agent import points_selection_agent
from .._agents.route_planning_agent import route_planning_agent
from .._agents.user_selection_agent import user_selection_agent

route_planning_workflow = SequentialAgent(
    name="RoutePlanningWorkflow",
    description=(
        "Stage 2 workflow for Seichijunrei: interpret the user's selection "
        "from the Bangumi candidates list, fetch all pilgrimage points from "
        "Anitabi, let an LLM intelligently select the best 8–12 points, and "
        "then generate a full natural-language route plan."
    ),
    sub_agents=[
        user_selection_agent,
        points_search_agent,
        points_selection_agent,
        route_planning_agent,
    ],
)
