"""PlannerAgent — deterministic intent-to-plan mapper.

Maps IntentOutput to an ExecutionPlan (ordered list of steps).
This is a rule-based planner; LLM-based planning comes in ITER-2.

Usage:
    from agents.planner_agent import create_plan

    plan = create_plan(intent_output)
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from agents.intent_agent import IntentOutput


class StepType(str, Enum):
    """Types of execution steps."""

    QUERY_DB = "query_db"
    PLAN_ROUTE = "plan_route"
    FORMAT_RESPONSE = "format_response"


class ExecutionStep(BaseModel):
    """A single step in an execution plan."""

    step_type: StepType
    description: str
    params: dict[str, Any] = Field(default_factory=dict)


class ExecutionPlan(BaseModel):
    """Ordered list of steps to execute for a user request."""

    intent: str
    steps: list[ExecutionStep]
    rationale: str


# ── Plan templates ────────────────────────────────────────────────

_PLAN_MAP: dict[str, list[tuple[StepType, str]]] = {
    "search_by_bangumi": [
        (StepType.QUERY_DB, "Query points by bangumi ID"),
        (StepType.FORMAT_RESPONSE, "Format bangumi search results"),
    ],
    "search_by_location": [
        (StepType.QUERY_DB, "Query points near location (PostGIS)"),
        (StepType.FORMAT_RESPONSE, "Format location search results"),
    ],
    "plan_route": [
        (StepType.QUERY_DB, "Fetch points for route planning"),
        (StepType.PLAN_ROUTE, "Compute optimized walking route"),
        (StepType.FORMAT_RESPONSE, "Format route with directions"),
    ],
    "general_qa": [
        (StepType.FORMAT_RESPONSE, "Generate QA response"),
    ],
    "unclear": [
        (StepType.FORMAT_RESPONSE, "Ask user for clarification"),
    ],
}


def create_plan(intent: IntentOutput) -> ExecutionPlan:
    """Create an execution plan from classified intent.

    Args:
        intent: Output from IntentAgent.

    Returns:
        ExecutionPlan with ordered steps.
    """
    template = _PLAN_MAP.get(intent.intent)

    if template is None:
        return ExecutionPlan(
            intent=intent.intent,
            steps=[
                ExecutionStep(
                    step_type=StepType.FORMAT_RESPONSE,
                    description="Unknown intent — ask for clarification",
                ),
            ],
            rationale=f"No plan template for intent: {intent.intent}",
        )

    steps = [
        ExecutionStep(
            step_type=step_type,
            description=desc,
            params=intent.extracted_params.model_dump(exclude_none=True),
        )
        for step_type, desc in template
    ]

    return ExecutionPlan(
        intent=intent.intent,
        steps=steps,
        rationale=f"Deterministic plan for {intent.intent} (confidence={intent.confidence})",
    )
