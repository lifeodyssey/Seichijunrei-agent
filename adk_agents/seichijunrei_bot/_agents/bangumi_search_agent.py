"""ADK SequentialAgent for searching Bangumi subjects and selecting the best match.

REFACTORED: Split into two LlmAgents to avoid ADK output_schema + tools bug.
See docs/adk_output_schema_tools_fix.md for details.
"""

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.tools import FunctionTool

from .._schemas import BangumiResult
from .._state import BANGUMI_RESULT
from ..tools import search_bangumi_subjects

# Step 1: Search for bangumi candidates using the tool
_bangumi_search_tool_agent = LlmAgent(
    name="BangumiSearchTool",
    model="gemini-2.0-flash",
    instruction="""
    You are an anime search assistant. Your job is to search for anime (bangumi)
    using the Bangumi API.

    Workflow:
    1. Read the bangumi_name field from {extraction_result}.
    2. Call search_bangumi_subjects(keyword=bangumi_name) to get candidate works.
    3. Return the complete search results to the next agent for selection.

    IMPORTANT: Do NOT select a work yourself. Your only job is to search and
    return ALL candidates. The selection will be done by the next agent.

    Example:
      Input: {extraction_result: {bangumi_name: "吹响！上低音号"}}
      Action: Call search_bangumi_subjects("吹响！上低音号")
      Output: Explain that you found X candidates and list them briefly.
    """,
    tools=[FunctionTool(search_bangumi_subjects)],
    # No output_schema - we want free-form text output
)


# Step 2: Select the best match and format as BangumiResult
_bangumi_selector_agent = LlmAgent(
    name="BangumiSelector",
    model="gemini-2.0-flash",
    instruction="""
    You are an anime matching assistant. Your job is to select the most
    appropriate anime (bangumi) from a list of candidates.

    Context:
    - The previous agent has searched Bangumi and returned candidate works.
    - You must analyze those candidates and choose the single best match.

    Selection criteria:
    1. Title similarity (original Japanese title and localized titles)
    2. Relevance to the user's query
    3. If multiple seasons/movies exist, prefer:
       - First season (if no specific season mentioned)
       - TV series over movies (unless user asked for movie)

    Requirements:
    - If there is no reasonable candidate, set bangumi_id to null and
      bangumi_confidence to 0.
    - bangumi_confidence must be between 0 and 1:
      - 1.0: Perfect match (exact title)
      - 0.8-0.9: Very good match (synonym or common abbreviation)
      - 0.6-0.7: Good match (same series but different season)
      - 0.3-0.5: Possible match (similar title)
      - 0.0: No match

    Output format:
    - bangumi_id: The selected work's Bangumi subject ID (or null)
    - bangumi_title: Original Japanese title
    - bangumi_title_cn: Chinese title (if available)
    - bangumi_confidence: Match confidence score
    """,
    output_schema=BangumiResult,
    output_key=BANGUMI_RESULT,
    # No tools - pure selection and formatting
)


# Export as SequentialAgent
bangumi_search_agent = SequentialAgent(
    name="BangumiSearchAgent",
    description="""
    Searches Bangumi for anime and selects the best matching work.

    This is a two-step process:
    1. Search Bangumi API for candidate works
    2. Select the most appropriate match and format as BangumiResult
    """,
    sub_agents=[
        _bangumi_search_tool_agent,
        _bangumi_selector_agent,
    ],
)
