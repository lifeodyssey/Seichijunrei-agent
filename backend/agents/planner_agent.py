"""ReActPlannerAgent — LLM-driven plan generation.

Replaces the old dict-lookup PlannerAgent. Uses Pydantic AI structured output
to produce an ExecutionPlan from free-text user input.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from pydantic_ai import Agent, ModelRetry
from pydantic_ai.models import Model

from backend.agents.base import create_agent, resolve_model
from backend.agents.intent_classifier import QueryIntent
from backend.agents.models import (
    STEP_DEPENDENCIES,
    ExecutionPlan,
    Observation,
    ReactStep,
)


@dataclass
class ReActDeps:
    """Dependencies injected into the ReAct step agent."""

    history: list[Observation] = field(default_factory=list)
    classified_intent: QueryIntent = QueryIntent.AMBIGUOUS
    query: str = ""
    locale: str = "ja"


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

CRITICAL RULE: Your FIRST action for any anime-related query MUST be resolve_anime.
If the user's message mentions an anime title (in any language), you MUST call
resolve_anime BEFORE calling search_bangumi. Do NOT call search_bangumi without
a bangumi_id from a prior resolve_anime observation. Skipping resolve_anime causes
0 results and a broken user experience.

## Failure recovery

If a tool fails (you see a \u2717 observation), analyze the error and recover:
- plan_route failed "no points found": you need to run search_bangumi first to load spots
- resolve_anime failed: try an alternative spelling or the original language title
- search_bangumi failed "no bangumi_id": run resolve_anime first
- Any tool timed out: retry once with the same parameters

Do NOT give up after one failure. Try to recover by running prerequisite steps.
Maximum 2 consecutive failures before stopping.
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
        selected_model: Model = resolve_model(model)
        self._plan_agent = create_agent(
            selected_model,
            system_prompt=PLANNER_SYSTEM_PROMPT,
            output_type=ExecutionPlan,
            retries=2,
        )
        self._step_agent: Agent[ReActDeps, ReactStep] = Agent(
            selected_model,
            system_prompt=REACT_SYSTEM_PROMPT,
            output_type=ReactStep,
            deps_type=ReActDeps,
            retries=2,
        )

        @self._step_agent.output_validator
        async def validate_react_step(ctx: object, result: ReactStep) -> ReactStep:
            """Validate ReactStep: reject premature done, enforce prerequisites."""
            from pydantic_ai import RunContext

            if not isinstance(ctx, RunContext):
                raise TypeError(f"Expected RunContext, got {type(ctx).__name__}")
            deps: ReActDeps = ctx.deps
            history = deps.history
            intent = deps.classified_intent

            # 1. Reject premature "done" when required work isn't complete
            if result.done is not None:
                has_bangumi_search = any(
                    o.tool == "search_bangumi" and o.success for o in history
                )
                needs_bangumi_search = intent in (
                    QueryIntent.ANIME_SEARCH,
                    QueryIntent.ROUTE_PLAN,
                )

                if needs_bangumi_search and not has_bangumi_search:
                    raise ModelRetry(
                        "You resolved the anime but haven't searched for spots yet. "
                        "Call search_bangumi with the bangumi_id from your "
                        "resolve_anime observation."
                    )

                has_route = any(o.tool == "plan_route" and o.success for o in history)
                if (
                    intent == QueryIntent.ROUTE_PLAN
                    and not has_route
                    and has_bangumi_search
                ):
                    raise ModelRetry(
                        "The user asked for a route but you only searched for "
                        "spots. Call plan_route with the search results."
                    )

            # 2. Reject actions with unmet prerequisites
            if result.action is not None:
                tool = result.action.tool
                dep_list = STEP_DEPENDENCIES.get(tool, [])
                for dep in dep_list:
                    if not any(o.tool == dep.value and o.success for o in history):
                        raise ModelRetry(
                            f"{tool.value} requires {dep.value} to run first. "
                            f"Call {dep.value} before {tool.value}."
                        )

            return result

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
        classified_intent: QueryIntent = QueryIntent.AMBIGUOUS,
    ) -> ReactStep:
        """Single ReAct step: observe history, emit next action or done."""
        context_prefix = _format_context_block(context)
        obs_history = history or []
        history_prefix = _format_react_history(obs_history)

        parts: list[str] = []
        if context_prefix:
            parts.append(context_prefix)
        if history_prefix:
            parts.append(history_prefix)
        parts.append(f"[locale={locale}] {text}")

        prompt = "\n".join(parts)
        deps = ReActDeps(
            history=obs_history,
            classified_intent=classified_intent,
            query=text,
            locale=locale,
        )
        result = await self._step_agent.run(prompt, deps=deps)
        return result.output
