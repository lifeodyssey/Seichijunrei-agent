"""Stage 2 deterministic route planning agent.

The route planning step is deterministic (SimpleRoutePlanner + PlanRoute use case),
so we don't need an LLM to "call a tool" and then "format a schema".

This BaseAgent reads the required inputs from session state, generates a RoutePlan
dict, validates it against the RoutePlan schema, and writes it to `route_plan`.
"""

from __future__ import annotations

from typing import Any

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from utils.logger import get_logger

from .._schemas import RoutePlan
from .._state import (
    EXTRACTION_RESULT,
    POINTS_SELECTION_RESULT,
    ROUTE_PLAN,
    SELECTED_BANGUMI,
)
from ..tools.route_planning import plan_route


class RoutePlanningAgent(BaseAgent):
    """Generate a deterministic route plan and store it in session state."""

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    def __init__(self) -> None:
        super().__init__(name="RoutePlanningAgent")
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        state: dict[str, Any] = ctx.session.state

        extraction = state.get(EXTRACTION_RESULT) or {}
        selected_bangumi = state.get(SELECTED_BANGUMI) or {}
        points_selection = state.get(POINTS_SELECTION_RESULT) or {}

        origin = extraction.get("location") if isinstance(extraction, dict) else ""
        origin = origin if isinstance(origin, str) else ""

        anime = (
            selected_bangumi.get("bangumi_title")
            if isinstance(selected_bangumi, dict)
            else ""
        )
        anime = anime if isinstance(anime, str) else ""

        selected_points = (
            points_selection.get("selected_points")
            if isinstance(points_selection, dict)
            else []
        )
        if not isinstance(selected_points, list):
            selected_points = []

        self.logger.info(
            "[RoutePlanningAgent] Generating route plan",
            origin=origin,
            anime=anime,
            points_count=len(selected_points),
        )

        plan_dict = plan_route(
            location=origin, bangumi_title=anime, points=selected_points
        )
        plan = RoutePlan.model_validate(plan_dict).model_dump()
        state[ROUTE_PLAN] = plan

        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=None,
            actions=EventActions(escalate=False),
        )


route_planning_agent = RoutePlanningAgent()
