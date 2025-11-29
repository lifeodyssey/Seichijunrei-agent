"""Stage 1 workflow: extract query + search Bangumi for candidates.

This SequentialAgent wires:
1. ExtractionAgent          – parse bangumi name and user location
2. BangumiCandidatesAgent   – call Bangumi search and build a candidate list
3. UserPresentationAgent    – generate user-friendly text presentation

Following ADK best practices, we separate data processing (with output_schema)
from presentation (natural language output).
"""

from google.adk.agents import SequentialAgent

from .._agents.bangumi_candidates_agent import bangumi_candidates_agent
from .._agents.extraction_agent import extraction_agent
from .._agents.user_presentation_agent import user_presentation_agent

bangumi_search_workflow = SequentialAgent(
    name="BangumiSearchWorkflow",
    description=(
        "Stage 1 workflow for Seichijunrei: extract bangumi name and location "
        "from the user query, search Bangumi, format candidates, and present "
        "a user-friendly selection prompt."
    ),
    sub_agents=[
        extraction_agent,  # Step 1: Extract bangumi_name + location
        bangumi_candidates_agent,  # Step 2: Search + format candidate list
        user_presentation_agent,  # Step 3: Generate user-friendly presentation
    ],
)
