"""Pydantic schemas for the Planner module.

These schemas define structured outputs for the LLM-based planner,
enabling type-safe intent classification and parameter extraction.
"""

from typing import Literal

from pydantic import BaseModel, Field


class PlannerParameters(BaseModel):
    """Parameters extracted by the planner for skill execution.

    Uses explicit fields instead of dict to avoid additionalProperties
    in JSON schema, which Gemini's structured output doesn't support.
    """

    query: str | None = Field(
        default=None,
        description="Anime title or search query for bangumi_search skill.",
    )
    location: str | None = Field(
        default=None,
        description="Optional location filter for bangumi_search skill.",
    )
    selection: str | None = Field(
        default=None,
        description="User's selection text for route_planning skill.",
    )


class PlannerDecision(BaseModel):
    """Structured decision output from the PlannerAgent.

    This schema is used as the output_schema for the LlmAgent,
    ensuring consistent JSON structure for downstream processing.
    """

    skill_id: Literal[
        "bangumi_search",
        "route_planning",
        "location_collection",
        "reset",
        "back",
        "help",
        "unknown",
    ] = Field(
        description=(
            "The skill to execute based on user intent. "
            "'bangumi_search' for anime title queries, "
            "'route_planning' for selection/route requests, "
            "'location_collection' for gathering user location, "
            "'reset' to clear session, "
            "'back' to return to previous step, "
            "'help' for usage instructions, "
            "'unknown' when intent is unclear."
        )
    )

    parameters: PlannerParameters = Field(
        default_factory=PlannerParameters,
        description=(
            "Extracted parameters for the skill. "
            "For bangumi_search: set query and optionally location. "
            "For route_planning: set selection. "
            "Leave all None for reset/back/help/unknown."
        ),
    )

    reasoning: str = Field(
        description=(
            "Brief explanation of why this skill was chosen. "
            "Helps with debugging and transparency."
        )
    )

    confidence: float = Field(
        ge=0.0,
        le=1.0,
        description=(
            "Confidence score between 0 and 1. "
            "Higher values indicate clearer user intent. "
            "Below threshold triggers clarification."
        ),
    )

    requires_clarification: bool = Field(
        default=False,
        description=(
            "Whether the planner needs more information from the user. "
            "Set to True when confidence is low or intent is ambiguous."
        ),
    )

    clarification_prompt: str | None = Field(
        default=None,
        description=(
            "Prompt to ask the user for clarification. "
            "Only set when requires_clarification is True. "
            "Should be in the user's detected language."
        ),
    )
