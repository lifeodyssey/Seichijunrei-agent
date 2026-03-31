"""Shared agent types — single source of truth for plan and retrieval models.

No LLM logic here. These models cross boundaries (planner -> executor -> retriever).
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ToolName(str, Enum):
    """Tool names used in ExecutionPlan steps."""

    RESOLVE_ANIME = "resolve_anime"
    SEARCH_BANGUMI = "search_bangumi"
    SEARCH_NEARBY = "search_nearby"
    PLAN_ROUTE = "plan_route"
    ANSWER_QUESTION = "answer_question"


class PlanStep(BaseModel):
    """One step in an execution plan produced by ReActPlannerAgent."""

    tool: ToolName
    params: dict[str, Any] = Field(default_factory=dict)
    parallel: bool = False


class ExecutionPlan(BaseModel):
    """Structured output of ReActPlannerAgent — consumed by ExecutorAgent."""

    steps: list[PlanStep]
    reasoning: str
    locale: str = "ja"


class RetrievalRequest(BaseModel):
    """Normalized retrieval request passed to Retriever and SQLAgent.

    Replaces IntentOutput throughout the retrieval stack.
    """

    tool: Literal["search_bangumi", "search_nearby"]
    bangumi_id: str | None = None
    episode: int | None = None
    location: str | None = None
    origin: str | None = None
    radius: int | None = None
