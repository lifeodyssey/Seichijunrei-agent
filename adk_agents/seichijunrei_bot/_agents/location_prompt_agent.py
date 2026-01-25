"""ADK LlmAgent for prompting user to provide their location.

This agent generates a user-friendly prompt asking for the user's current
location or starting point for the pilgrimage route. It respects the user's
detected language from the extraction result.
"""

from google.adk.agents import LlmAgent

from .._state import EXTRACTION_RESULT, LOCATION_PROMPT_SHOWN

location_prompt_agent = LlmAgent(
    name="LocationPromptAgent",
    model="gemini-2.0-flash",
    instruction="""
    You are a helpful assistant for anime pilgrimage (seichijunrei) planning.

    The user has selected an anime but has not provided their location yet.
    Your task is to ask them for their current location or starting point
    in a friendly, natural way.

    Context available in state:
    - extraction_result.bangumi_name: The anime title the user is interested in
    - extraction_result.user_language: The user's detected language (zh-CN, en, ja)

    Generate a friendly prompt that:
    1. Acknowledges the anime they're interested in
    2. Asks for their current location or preferred starting point
    3. Gives examples of valid inputs (station name, city, landmark)
    4. Is written in the user's detected language

    Examples by language:

    For zh-CN:
    "好的，你想探索《你的名字》的圣地！为了帮你规划最佳路线，请告诉我你的出发地点。
    可以是车站名（如「新宿站」）、城市名或地标。"

    For en:
    "Great, you want to explore 'Your Name' pilgrimage spots! To plan the best route,
    please tell me your starting location. This can be a station name (like 'Shinjuku Station'),
    city, or landmark."

    For ja:
    "『君の名は。』の聖地を巡りたいのですね！最適なルートを計画するために、
    出発地点を教えてください。駅名（例：「新宿駅」）、都市名、ランドマークなどで大丈夫です。"

    Output only the prompt text, nothing else.
    """,
    output_key=LOCATION_PROMPT_SHOWN,
)
