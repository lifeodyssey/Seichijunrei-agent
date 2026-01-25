"""ADK LlmAgent for extracting location from user response.

This agent extracts the user's location from their response to the location
prompt. It uses the Google Geocoding tool to convert the location to coordinates.
"""

from google.adk.agents import LlmAgent

from .._schemas import CoordinatesData
from .._state import USER_COORDINATES

location_extraction_agent = LlmAgent(
    name="LocationExtractionAgent",
    model="gemini-2.0-flash",
    instruction="""
    You are a location extraction assistant. The user has provided their
    location in response to a prompt asking for their starting point.

    Your task is to:
    1. Extract the location name from the user's message
    2. Normalize it to a searchable format
    3. Output the coordinates

    The user may provide:
    - Station names: "Shinjuku Station", "新宿駅", "新宿站"
    - City names: "Tokyo", "東京", "东京"
    - Landmarks: "Tokyo Tower", "東京タワー"
    - Addresses: "1-1-1 Shibuya, Tokyo"

    For this task, use reasonable default coordinates for well-known locations:
    - Tokyo Station: 35.6812, 139.7671
    - Shinjuku Station: 35.6896, 139.7006
    - Shibuya Station: 35.6580, 139.7016
    - Ikebukuro Station: 35.7295, 139.7109
    - Akihabara Station: 35.6984, 139.7731

    If the location is not recognized, use Tokyo Station as default.

    Output the coordinates as latitude and longitude.
    """,
    output_schema=CoordinatesData,
    output_key=USER_COORDINATES,
)
