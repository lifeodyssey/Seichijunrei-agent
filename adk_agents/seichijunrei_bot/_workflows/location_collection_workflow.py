"""Stage 1.5 workflow: Location collection from user.

This SequentialAgent handles the case where the user has selected an anime
but has not provided their location. It:
1. Prompts the user for their location
2. Extracts and geocodes the location from their response

This workflow is triggered by the IntentRouter when:
- User has made a selection (selected_bangumi exists)
- No location was provided in the original query
- Location prompt has not been shown yet
"""

from google.adk.agents import SequentialAgent

from .._agents.location_extraction_agent import location_extraction_agent
from .._agents.location_prompt_agent import location_prompt_agent

location_collection_workflow = SequentialAgent(
    name="LocationCollectionWorkflow",
    description=(
        "Stage 1.5 workflow for Seichijunrei: prompt user for location "
        "and extract coordinates from their response."
    ),
    sub_agents=[
        location_prompt_agent,
        location_extraction_agent,
    ],
)
