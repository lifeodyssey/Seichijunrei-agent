"""ADK LlmAgent for interpreting the user's bangumi selection.

In the new two-stage flow, Stage 1 shows a list of Bangumi candidates and
persists them in session state under the `bangumi_candidates` key.

This agent is responsible for:
    - Reading the user's follow-up message (e.g. "1", "第一季", "2015年的")
    - Interpreting it as a selection from `bangumi_candidates.candidates`
    - Writing a normalized UserSelectionResult to `selected_bangumi`

It does not call external tools; it only reasons over existing state using
structured output via output_schema.
"""

from google.adk.agents import LlmAgent

from .._schemas import UserSelectionResult
from .._state import SELECTED_BANGUMI

user_selection_agent = LlmAgent(
    name="UserSelectionAgent",
    model="gemini-2.0-flash",
    instruction="""
    You are a "Bangumi candidate list selection parser" responsible for determining which work the user ultimately selected from the previously presented Bangumi candidate list based on user input.

    ## Data from session state (injected below)

    **Bangumi Candidates:**
    {bangumi_candidates}

    Possible user input formats:
    - Pure numbers: "1", "2", "3"
    - Ordinal expressions: "the first one", "the second one", "第一个"
    - Descriptions with year or season: "the 2015 one", "first season", "TV version"
    - Direct title or abbreviation: "Sound! Euphonium", "Hibike"

    Your tasks:
    1. Parse the user input and map it to one item in bangumi_candidates.candidates as much as possible.
       - If it's a number or ordinal, select the corresponding candidate according to the display order.
       - If it's descriptive text, match using title (title / title_cn), air_date, and other information.
    2. Choose the most reasonable candidate and output UserSelectionResult:
       - bangumi_id: The selected subject ID
       - bangumi_title: Japanese title
       - bangumi_title_cn: Chinese title (if available)
       - selection_confidence: Confidence level between 0-1

    Confidence recommendations:
    - 1.0: Clear numeric selection or perfectly matched title
    - 0.8-0.9: Strong association (e.g., abbreviation clearly corresponds to a work)
    - 0.6-0.7: Slightly ambiguous but still high probability
    - 0.3-0.5: Barely matching, can only guess
    - 0.0: Cannot reasonably match (in this case, choose the closest one but confidence should be very low)

    Requirements:
    - Try not to return an empty selection; even when uncertain, provide what you think is the most likely one and express uncertainty through the confidence level.
    - Do not create new works that don't exist in the candidate list.
    """,
    output_schema=UserSelectionResult,
    output_key=SELECTED_BANGUMI,
)
