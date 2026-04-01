"""ReActPlannerAgent — LLM-driven plan generation.

Replaces the old dict-lookup PlannerAgent. Uses Pydantic AI structured output
to produce an ExecutionPlan from free-text user input.
"""
from __future__ import annotations

from typing import Any

from agents.base import create_agent, get_default_model
from agents.models import ExecutionPlan

PLANNER_SYSTEM_PROMPT = """\
You are a planning agent for an anime pilgrimage (聖地巡礼) search app.

Your job: understand the user's request and output a structured execution plan.

## Available tools

- resolve_anime(title: str)
  Resolve an anime title to a bangumi_id (DB-first, then Bangumi.tv API).
  Use this whenever the user mentions an anime by name.
  Do NOT hardcode bangumi IDs in your plan.

- search_bangumi(bangumi_id: str | None, episode: int | None)
  Find pilgrimage filming locations for a specific anime.
  Set bangumi_id to null if a resolve_anime step precedes this.

- search_nearby(location: str, radius: int | None)
  Find pilgrimage locations near a station, city, or area.
  Use when the user asks about a geographic area rather than a specific anime.

- plan_route(params: {})
  Sort the results of a preceding search_bangumi step into an optimal walking order.
  Only include this after a search_bangumi step.

- answer_question(answer: str)
  For general QA about anime pilgrimage (etiquette, tips, etc.).
  Fill the answer field with a short, helpful response.

## Rules

1. For any anime query: ALWAYS emit resolve_anime first, then search_bangumi.
   Never hardcode bangumi IDs. The DB grows automatically.
2. For location queries: use search_nearby only. No resolve_anime needed.
3. plan_route is ONLY for explicit route/itinerary requests (ルート, 路线, route,
   行程, 回る, plan a route, walking order). Merely asking for "spots" or
   "locations" or "pilgrimage sites" does NOT need plan_route — that is search_bangumi.
4. Set locale in the plan to match the user's language.
5. Keep plans minimal — the fewest steps that satisfy the request.
6. Fill reasoning with your chain-of-thought (for logging/debugging).

## locale values
- "ja" for Japanese queries
- "zh" for Chinese queries
- "en" for English queries
"""


class ReActPlannerAgent:
    """LLM-driven planner: user text → ExecutionPlan.

    Uses Pydantic AI structured output with retries=2.
    """

    def __init__(self, model: Any = None) -> None:
        self._agent = create_agent(
            model or get_default_model(),
            system_prompt=PLANNER_SYSTEM_PROMPT,
            output_type=ExecutionPlan,
            retries=2,
        )

    async def create_plan(self, text: str, locale: str = "ja") -> ExecutionPlan:
        """Generate an ExecutionPlan from user text."""
        prompt = f"[locale={locale}] {text}"
        result = await self._agent.run(prompt)
        return result.output
