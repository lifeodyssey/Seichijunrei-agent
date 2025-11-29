"""ADK SequentialAgent for Bangumi search + candidate formatting.

This agent replaces the older single-result bangumi_search_agent in the new
Capstone design. It:

1. Uses a tool-enabled LlmAgent to call the Bangumi search API.
2. Uses a second LlmAgent with output_schema to turn raw results into a
   structured BangumiCandidatesResult persisted in session state.

Following ADK best practices, the tool call and structured JSON output are
split into two separate LlmAgents to avoid combining tools + output_schema.
"""

from google.adk.agents import LlmAgent, SequentialAgent
from google.adk.tools import FunctionTool

from .._schemas import BangumiCandidatesResult
from ..tools import search_bangumi_subjects

_bangumi_searcher = LlmAgent(
    name="BangumiSearcher",
    model="gemini-2.0-flash",
    instruction="""
    You are an anime (bangumi) search assistant.

    Your job in this step is ONLY to call the Bangumi search tool and surface
    its results for the next agent. Do not try to pick a single best match.

    Workflow:
    1. Read the extracted bangumi name from {extraction_result.bangumi_name}
       in the session state.
    2. Call the `search_bangumi_subjects` tool with that keyword.
    3. Briefly summarize how many candidates were found and list them in a
       compact, machine-readable way (ID, titles, air date, summary).

    Important:
    - Do NOT choose a single work here.
    - Preserve as much information from the tool result as possible so the
      next agent can build a high-quality candidate list.
    """,
    tools=[FunctionTool(search_bangumi_subjects)],
    # No output_schema / output_key: this agent is purely tool + reasoning.
)


_candidates_formatter = LlmAgent(
    name="BangumiCandidatesFormatter",
    model="gemini-2.0-flash",
    instruction="""
    You are a ranking and formatting assistant for Bangumi search results.

    Context:
    - The previous agent has called the Bangumi search tool and printed out
      the raw results (including IDs, titles, air dates, summaries, etc.).
    - The user's inferred search keyword is available as
      {extraction_result.bangumi_name}.

    Your task:
    1. From the raw search results, select the 3–5 MOST relevant anime works.
       - Prefer anime TV series and main seasons over side stories or extras.
       - Prefer the first season if no specific season is implied.
    2. For each selected work, construct a BangumiCandidate:
       - bangumi_id: subject ID from the tool result
       - title: original Japanese title
       - title_cn: Chinese title if available, otherwise null
       - air_date: first air date in "YYYY-MM" if available, otherwise null
       - summary: a concise 1–2 sentence description to help the user choose
    3. Fill BangumiCandidatesResult:
       - candidates: your 3–5 formatted BangumiCandidate objects
       - query: the search keyword you used (bangumi_name)
       - total: total number of works returned by the Bangumi API (not just
         the 3–5 you selected).

    Requirements:
    - Only use IDs and metadata that actually exist in the tool output.
    - Do not fabricate works that were not returned by the API.
    - If the API returned no results, set candidates to [] and total to 0.
    """,
    output_schema=BangumiCandidatesResult,
    output_key="bangumi_candidates",
)


bangumi_candidates_agent = SequentialAgent(
    name="BangumiCandidatesAgent",
    description=(
        "Searches Bangumi for anime works using a tool-enabled LlmAgent and "
        "then formats the top 3–5 results into a structured list of "
        "Bangumi candidates for the user to choose from."
    ),
    sub_agents=[
        _bangumi_searcher,
        _candidates_formatter,
    ],
)
