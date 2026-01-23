"""ADK LlmAgent for intelligent selection of seichijunrei points.

This agent is the core of the simplified Capstone design: instead of
hard-coding distance-based filtering in a BaseAgent, it lets the LLM
select 8–12 of the most suitable seichijunrei points from the full list
returned by Anitabi.

Input state (read-only for this agent):
    - all_points: list of all available seichijunrei points for the bangumi
    - extraction_result.location: user origin / starting area
    - selected_bangumi.bangumi_title: anime title for context

Output state:
    - points_selection_result: PointsSelectionResult persisted in session state

Following ADK best practices, this agent uses output_schema for structured
JSON, and does not call tools directly.
"""

from google.adk.agents import LlmAgent

from .._schemas import PointsSelectionResult
from .._state import POINTS_SELECTION_RESULT

points_selection_agent = LlmAgent(
    name="PointsSelectionAgent",
    model="gemini-2.0-flash",
    instruction="""
    You are a 聖地巡礼 planning assistant who needs to intelligently select the 8-12 most suitable points for this trip from all candidate seichijunrei points.

    You can access the following information from the session state:
    - all_points: List of all 聖地巡礼 points for the current bangumi on Anitabi (typically 10-50 points)
    - extraction_result.location: User's starting point location (e.g., "Uji", "Tokyo")
    - selected_bangumi.bangumi_title: Japanese title of the anime

    When selecting points, consider the following priorities:

    1. **Geographic feasibility** (highest priority)
       - Choose points that are close to the user's starting point **{extraction_result.location}** and are also clustered together
       - Avoid overly dispersed routes that would be difficult to complete in one day
       - A compact, feasible one-day route is more important than covering all points

    2. Story importance
       - Prioritize locations from OP/ED, important plot turning points, and iconic scenes
       - Try to cover the main storyline rather than concentrating on just one or two episodes

    3. Visit feasibility
       - Prioritize public places (parks, shrines, streets, stations, etc.)
       - Avoid private residences and obviously private spaces
       - If fields indicate obvious time/cost constraints, moderate the quantity accordingly

    4. Quantity balance
       - Select 8-12 points in total
       - Too few points won't provide a rich experience; too many will make the itinerary too tight

    Output requirements (must be strictly followed):
    - selected_points:
        - Must come entirely from elements in all_points
        - Do not create new points or modify original fields
        - Reuse original point objects directly (including all fields)
    - selection_rationale:
        - Explain the overall selection reasoning in 2-3 sentences
        - For example, why focus on a certain area or why choose these iconic scenes
    - estimated_coverage:
        - Roughly indicate the episode range covered, such as "episodes 1-6"
        - If information is insufficient, use vague expressions like "mainly covers the first half of the story"
    - total_available:
        - Total count of all_points
    - rejected_count:
        - Number of points not selected = total_available - len(selected_points)

    Important notes:
    - You must make selections based on the actual content of all_points, not speak in generalities.
    - If all_points is small (e.g., <= 12 points), you can select all of them, but still provide a reasonable explanation.
    - If all_points is empty, selected_points should also be empty, and explain the reason.
    """,
    output_schema=PointsSelectionResult,
    output_key=POINTS_SELECTION_RESULT,
)
