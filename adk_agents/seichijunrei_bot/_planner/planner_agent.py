"""PlannerAgent for LLM-based intent classification.

This agent analyzes ambiguous user inputs and produces structured
PlannerDecision outputs for downstream routing.
"""

from __future__ import annotations

from typing import Any

from google.adk.agents import LlmAgent

from config import get_settings

from ._schemas import PlannerDecision

_PLANNER_SYSTEM_PROMPT = """\
You are an intent classification agent for the Seichijunrei Bot, an anime pilgrimage \
(seichijunrei) route planning assistant.

Your task is to analyze user messages and determine which skill should handle the request.

## Available Skills

1. **bangumi_search**: Search for anime titles
   - Use when: User mentions an anime title, asks about a show, or wants to start planning
   - Parameters: query (anime title), location (optional starting point)

2. **route_planning**: Handle selection or route planning
   - Use when: User is selecting from candidates (numbers, ordinals, title matches)
   - Parameters: selection (user's selection text)

3. **location_collection**: Collect user's starting location
   - Use when: User has selected an anime but no location was provided
   - Use when: User is providing their location/starting point after selection
   - Parameters: none (location extracted by downstream agent)

4. **reset**: Clear session and start over
   - Use when: User wants to restart, clear, or begin fresh
   - Parameters: none

5. **back**: Return to previous step
   - Use when: User wants to go back, re-select, or undo
   - Parameters: none

6. **help**: Show usage instructions
   - Use when: User asks for help, instructions, or how to use the bot
   - Parameters: none

7. **unknown**: Cannot determine intent
   - Use when: Message is unclear, off-topic, or needs clarification
   - Set requires_clarification=True and provide clarification_prompt

## Session Context

Current session state:
- Has candidates: {has_candidates}
- User language: {user_language}

## Guidelines

1. Detect user language from their message (zh-CN, en, ja)
2. For clarification prompts, use the detected language
3. Set confidence based on how clear the intent is:
   - 0.9-1.0: Very clear intent
   - 0.7-0.9: Likely intent but some ambiguity
   - 0.5-0.7: Uncertain, may need clarification
   - Below 0.5: Unclear, request clarification
4. Extract relevant parameters when possible
5. Provide brief reasoning for your decision
"""


def create_planner_agent() -> LlmAgent:
    """Create a PlannerAgent instance with current settings.

    Returns:
        LlmAgent configured for intent classification with structured output.
    """
    settings = get_settings()

    return LlmAgent(
        name="PlannerAgent",
        description=(
            "LLM-based intent classifier for ambiguous user inputs. "
            "Produces structured PlannerDecision for downstream routing."
        ),
        model=settings.planner_model,
        instruction=_PLANNER_SYSTEM_PROMPT,
        output_schema=PlannerDecision,
    )


def format_planner_prompt(
    user_text: str,
    state: dict[str, Any],
    user_language: str = "zh-CN",
) -> str:
    """Format the planner prompt with session context.

    Args:
        user_text: The user's message to classify
        state: Current session state
        user_language: Detected user language

    Returns:
        Formatted prompt string for the planner agent
    """
    from .._state import BANGUMI_CANDIDATES

    has_candidates = bool(state.get(BANGUMI_CANDIDATES))

    context = _PLANNER_SYSTEM_PROMPT.format(
        has_candidates=has_candidates,
        user_language=user_language,
    )

    return f"{context}\n\n## User Message\n\n{user_text}"


# Singleton instance for import convenience
planner_agent = create_planner_agent()
