"""ReActPlannerAgent — LLM-driven plan generation.

Replaces the old dict-lookup PlannerAgent. Uses Pydantic AI structured output
to produce an ExecutionPlan from free-text user input.
"""

from __future__ import annotations

from pydantic_ai.models import Model

from backend.agents.base import create_agent, get_default_model
from backend.agents.models import ExecutionPlan, Observation, ReactStep

PLANNER_SYSTEM_PROMPT = """\
You are a planning agent for an anime pilgrimage (聖地巡礼) search app.

Your job: understand the user's request and output a structured execution plan.

## Available tools

- resolve_anime(title: str)
  Resolve an anime title to a bangumi_id (DB-first, then Bangumi.tv API).
  Use this whenever the user mentions an anime by name.
  Do NOT hardcode bangumi IDs in your plan.

- search_bangumi(bangumi_id: str | None, episode: int | None, force_refresh: bool = false)
  Find pilgrimage filming locations for a specific anime.
  Set bangumi_id to null if a resolve_anime step precedes this.
  Set force_refresh to true ONLY when the user explicitly asks to refresh or
  re-fetch pilgrimage data.

- search_nearby(location: str, radius: int | None)
  Find pilgrimage locations near a station, city, or area.
  Use when the user asks about a geographic area rather than a specific anime.

- plan_route(origin: str | None = None)
  Sort the results of a preceding search_bangumi step into an optimal walking order.
  Include origin when the user names a starting point.

- greet_user(message: str)
  For greetings and identity questions about Seichijunrei itself.
  Fill the message field with a short, localized introduction and 2-3 example asks.

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
4. If the user names a departure point, put it in plan_route.origin.
   If no new origin is provided and the context block has last_location,
   you may leave origin null — runtime will reuse the remembered location.
5. Use greet_user(message: str) for greetings such as hi, hello, 你好, こんにちは.
6. Use greet_user(message: str) for identity questions such as 你是谁, what are you,
   and what can you do.
7. Do not use it for real pilgrimage queries, even if they begin with a greeting.
   Example: 你好，宇治站附近有哪些取景地？ should be search_nearby.
   Example: hello, plan a route for Your Name in Tokyo should be a real search/route plan.
8. For pure greetings or identity asks, emit exactly one greet_user step.
   Keep params.message to roughly 2-4 sentences.
9. Set locale in the plan to match the user's language.
10. Keep plans minimal — the fewest steps that satisfy the request.
11. Fill reasoning with your chain-of-thought (for logging/debugging).

## Clarification rules

- clarify(question: str, options: list[str] = [])
  Ask the user a question when you cannot proceed confidently.

12. When a search query matches multiple anime titles and you cannot determine which
    one the user means, emit a single clarify step with the question and candidate
    titles as options. Do NOT guess.
13. When the user asks for route planning but provides no departure location, AND
    no last_location exists in the context block, emit clarify asking where they are.
14. When the query is clear and unambiguous, NEVER emit a clarify step. Just proceed.
15. A plan must contain EITHER clarify steps OR tool steps, never both.
    If you clarify, the plan has exactly one clarify step and nothing else.

## Sparse geo results

16. If search_nearby returns fewer than 5 results and the user did not specify an
    anime title, emit a clarify step asking which anime they are looking for.
    Suggest anime titles known to have spots near the searched location.
    Example: "この辺りには以下のアニメの聖地があります。どのアニメですか？"

## locale values
- "ja" for Japanese queries
- "zh" for Chinese queries
- "en" for English queries
"""


def _format_context_block(context: dict[str, object] | None) -> str:
    """Render a compact context block for planner prompt injection."""
    if not context:
        return ""

    lines = ["[context]"]
    summary = context.get("summary")
    current_title = context.get("current_anime_title")
    current_bangumi_id = context.get("current_bangumi_id")
    last_location = context.get("last_location")
    last_intent = context.get("last_intent")
    visited_ids = context.get("visited_bangumi_ids")

    if summary:
        lines.append(f"summary: {summary}")

    if current_title and current_bangumi_id:
        lines.append(f"anime: {current_title} (bangumi_id: {current_bangumi_id})")
    elif current_title:
        lines.append(f"anime: {current_title}")
    elif current_bangumi_id:
        lines.append(f"bangumi_id: {current_bangumi_id}")

    if last_location:
        lines.append(f"last_location: {last_location}")
    if last_intent:
        lines.append(f"last_intent: {last_intent}")
    if isinstance(visited_ids, (list, tuple, set)) and visited_ids:
        lines.append(f"visited_ids: {', '.join(str(item) for item in visited_ids)}")

    return "\n".join(lines) if len(lines) > 1 else ""


REACT_SYSTEM_PROMPT = (
    PLANNER_SYSTEM_PROMPT
    + """

## ReAct mode

You are operating in ReAct (Reason + Act) mode. Each turn, you:
1. Think about what to do next based on the user's request and any observations so far
2. Either emit an action (tool call) or signal done

When you have enough information to respond to the user, set `done` with the final message.
When you need more information, set `action` with the next tool to call.

Never emit both `action` and `done` in the same turn.
Maximum 8 turns per conversation.
"""
)


def _format_react_history(history: list[Observation]) -> str:
    """Format observation history for planner prompt injection."""
    if not history:
        return ""
    lines: list[str] = []
    for i, obs in enumerate(history, 1):
        status = "✓" if obs.success else "✗"
        lines.append(f"Observation {i} [{obs.tool} {status}]: {obs.summary}")
    return "\n".join(lines)


class ReActPlannerAgent:
    """LLM-driven planner with ReAct loop support.

    Two modes:
    - create_plan(): one-shot, returns full ExecutionPlan (backward compat)
    - step(): single-step ReAct, returns ReactStep with thought + action/done
    """

    def __init__(self, model: Model | str | None = None) -> None:
        selected_model: Model | str = get_default_model() if model is None else model
        self._plan_agent = create_agent(
            selected_model,
            system_prompt=PLANNER_SYSTEM_PROMPT,
            output_type=ExecutionPlan,
            retries=2,
        )
        self._step_agent = create_agent(
            selected_model,
            system_prompt=REACT_SYSTEM_PROMPT,
            output_type=ReactStep,
            retries=2,
        )

    async def create_plan(
        self,
        text: str,
        locale: str = "ja",
        context: dict[str, object] | None = None,
    ) -> ExecutionPlan:
        """One-shot plan generation (backward compat)."""
        context_prefix = _format_context_block(context)
        prompt = (
            f"{context_prefix}\n[locale={locale}] {text}"
            if context_prefix
            else f"[locale={locale}] {text}"
        )
        result = await self._plan_agent.run(prompt)
        return result.output

    async def step(
        self,
        text: str,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        history: list[Observation] | None = None,
    ) -> ReactStep:
        """Single ReAct step: observe history, emit next action or done."""
        context_prefix = _format_context_block(context)
        history_prefix = _format_react_history(history or [])

        parts: list[str] = []
        if context_prefix:
            parts.append(context_prefix)
        if history_prefix:
            parts.append(history_prefix)
        parts.append(f"[locale={locale}] {text}")

        prompt = "\n".join(parts)
        result = await self._step_agent.run(prompt)
        return result.output
