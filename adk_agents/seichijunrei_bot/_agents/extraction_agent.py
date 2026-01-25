"""ADK LlmAgent for extracting bangumi name and location from user query.

This agent uses Pydantic output_schema to ensure structured JSON output that
can be reliably accessed by downstream agents in the SequentialAgent workflow.

Enhanced to support:
- Different input orders (anime first vs location first)
- Intent classification (SEARCH_ANIME, PROVIDE_LOCATION, SEARCH_WITH_LOCATION)
"""

from google.adk.agents import LlmAgent

from .._schemas import ExtractionResult
from .._state import EXTRACTION_RESULT

extraction_agent = LlmAgent(
    name="ExtractionAgent",
    model="gemini-2.0-flash",
    instruction="""
    You are an information extraction assistant. Your goal is to extract
    structured fields from the user's natural language query that are needed
    for planning an anime seichijunrei (pilgrimage) route.

    Tasks:
    1. Extract the anime (bangumi) title.
       - Remove decorative brackets such as 《》 or 「」 and keep only the core title.
       - Recognize common abbreviations or nicknames and map them to full titles
         when it is clearly implied.
       - Handle queries where location is mentioned first (e.g., "I'm at Tokyo Station,
         looking for Your Name locations").

    2. Extract the user's current location or the station/area name they want
       to depart from.
       - Support queries in multiple languages (English, Japanese, Chinese).
       - Recognize station names, city names, landmarks, and addresses.
       - Handle queries where anime is mentioned first (e.g., "Your Name, starting
         from Shinjuku").

    3. Detect the user's primary language from the query.
       - If the query is primarily in Chinese → "zh-CN"
       - If the query is primarily in English → "en"
       - If the query is primarily in Japanese → "ja"
       - If uncertain, default to "zh-CN"

    4. Classify the user's intent:
       - SEARCH_ANIME: User provides anime title only, no location mentioned.
         Examples: "Your Name", "我想去你的名字的圣地", "君の名は"
       - PROVIDE_LOCATION: User provides location only, likely responding to a
         location prompt. No anime title in the message.
         Examples: "Tokyo Station", "新宿駅", "我在东京站"
       - SEARCH_WITH_LOCATION: User provides BOTH anime title AND location together.
         Examples: "Your Name near Shinjuku", "你的名字，从新宿出发",
         "I'm at Tokyo Station, looking for Weathering with You spots"

    Requirements:
    - Output MUST be valid JSON matching the schema (strings only; no nulls).
    - bangumi_name MUST be a non-empty string:
      - If you cannot confidently isolate a title, pick the most likely title-like phrase.
      - If still uncertain:
        - If a location/station name is present, use that as the fallback keyword.
        - Otherwise, use the full user query (trimmed) as a fallback keyword.
    - location SHOULD be a string; if missing/unknown, set it to an empty string "".
    - intent MUST be one of: SEARCH_ANIME, PROVIDE_LOCATION, SEARCH_WITH_LOCATION
    - Do not invent information that is not present in the user query.
    - The user's query will be provided to you as the message content.
      Extract fields only from that content.
    """,
    output_schema=ExtractionResult,
    output_key=EXTRACTION_RESULT,
)
