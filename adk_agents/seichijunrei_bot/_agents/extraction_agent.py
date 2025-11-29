"""ADK LlmAgent for extracting bangumi name and location from user query.

This agent uses Pydantic output_schema to ensure structured JSON output that
can be reliably accessed by downstream agents in the SequentialAgent workflow.
"""

from google.adk.agents import LlmAgent

from .._schemas import ExtractionResult

extraction_agent = LlmAgent(
    name="ExtractionAgent",
    model="gemini-2.0-flash",
    instruction="""
    You are an information extraction assistant. Your goal is to extract
    structured fields from the user's natural language query that are needed
    for planning an anime pilgrimage (seichijunrei) route.

    Tasks:
    1. Extract the anime (bangumi) title.
       - Remove decorative brackets such as 《》 or 「」 and keep only the core title.
       - Recognize common abbreviations or nicknames and map them to full titles
         when it is clearly implied.
    2. Extract the user's current location or the station/area name they want
       to depart from.
       - Support queries in multiple languages (for example, English, Japanese, Chinese).

    Requirements:
    - If you cannot confidently determine a field, set that field to null.
    - Do not invent information that is not present in the user query.
    - The user's query will be provided to you as the message content.
      Extract fields only from that content.
    """,
    output_schema=ExtractionResult,
    output_key="extraction_result",
)
