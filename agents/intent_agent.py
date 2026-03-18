"""IntentAgent — classifies user intent (v2 skeleton).

Replaces the ADK intent recognition in adk_agents/_intent/.
Will be fully implemented in ITER-1 (STORY 1.2).

Intent categories:
    - search_by_location: User wants to find anime near a station/location
    - search_by_bangumi: User wants to visit locations from a specific anime
    - plan_route: User wants to generate an optimized walking route
    - general_qa: General questions about anime pilgrimage
    - unclear: Need clarification
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from agents.base import DEFAULT_MODEL, create_agent


class IntentOutput(BaseModel):
    """Structured output from intent classification."""

    intent: str = Field(
        ...,
        description="Classified intent: search_by_location, search_by_bangumi, plan_route, general_qa, unclear",
    )
    confidence: float = Field(..., ge=0.0, le=1.0, description="Classification confidence")
    extracted_params: dict = Field(
        default_factory=dict,
        description="Extracted parameters (e.g. station_name, bangumi_title, location)",
    )
    reasoning: str = Field(default="", description="Brief reasoning for the classification")


INTENT_SYSTEM_PROMPT = """\
You are an intent classifier for an anime pilgrimage (聖地巡礼) travel assistant.

Classify user messages into one of these intents:
- search_by_location: User mentions a station, city, or area and wants to find nearby anime locations
- search_by_bangumi: User mentions a specific anime title and wants to visit its real-world locations
- plan_route: User wants to generate an optimized walking route between pilgrimage points
- general_qa: General questions about anime pilgrimage
- unclear: Cannot determine intent, need clarification

Extract relevant parameters (station names, anime titles, locations) from the message.
Respond in the user's language (Japanese, Chinese, or English).
"""


def create_intent_agent(model: str = DEFAULT_MODEL) -> object:
    """Create an IntentAgent with structured output.

    Returns a Pydantic AI Agent configured for intent classification.
    Will be called by the PlannerAgent in the Plan-and-Execute pattern.
    """
    return create_agent(
        model,
        system_prompt=INTENT_SYSTEM_PROMPT,
        result_type=IntentOutput,
    )
