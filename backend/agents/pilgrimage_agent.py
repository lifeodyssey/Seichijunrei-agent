"""Main PydanticAI-native runtime agent.

This agent owns the frontend journey contract:
- clarify: ask a question with enriched candidates
- search: return results for grid/map panels
- route: return a complete route (including timed_itinerary)
- qa/greet: return a simple answer payload

Deterministic work is done in tools (DB/retriever/route optimizer). The LLM is
responsible for choosing tools and producing the final stage message.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import structlog
from pydantic_ai import Agent, RunContext
from pydantic_ai.models import Model
from pydantic_ai.output import ToolOutput

from backend.agents.base import resolve_model
from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.handlers import (
    execute_answer_question,
    execute_greet_user,
    execute_plan_route,
    execute_resolve_anime,
    execute_search_bangumi,
    execute_search_nearby,
)
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.agents.retriever import Retriever
from backend.agents.runtime_deps import RuntimeDeps
from backend.agents.runtime_models import (
    ClarifyResponseModel,
    GreetingResponseModel,
    QAResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from backend.agents.tools import enrich_clarify_candidates
from backend.agents.translation import translate_title

logger = structlog.get_logger(__name__)


_OnStep = Callable[[str, str, dict[str, object], str, str], Awaitable[None]]


_INSTRUCTIONS = """\
You are the runtime agent for Seichijunrei (聖地巡礼), an anime pilgrimage search \
and route planning app. Users ask about real-world locations from anime.

## Your job
Call tools to fetch real data, then return exactly ONE typed response. \
Never fabricate locations, coordinates, or routes — always use tool outputs.

## Response types (pick exactly one)
- clarify_response — when you need more info from the user
- search_response — when returning pilgrimage point results
- route_response — when returning a planned walking route
- qa_response — when answering general questions about pilgrimage etiquette/tips
- greeting_response — when responding to greetings or "what can you do?"

## Workflow rules

### Anime search (most common)
1. Call resolve_anime(title) FIRST to get a bangumi_id
2. If resolve_anime returns "ambiguous": true with multiple candidates → \
you MUST call clarify() with those candidates. Do NOT guess.
3. If resolve_anime returns a single bangumi_id → call search_bangumi(bangumi_id)

### Location/nearby search
- Call search_nearby(location, radius) when the user mentions a place name
- Do NOT call resolve_anime for location queries

### Route planning
- When the user asks for a route/itinerary/walking plan:
  1. Call resolve_anime first
  2. Call search_bangumi to get points
  3. Call plan_route to create the optimized route
  ALL THREE steps are required. Do not stop after search.

### Greetings vs QA
- greet_user: "hi", "hello", "你好", "what can you do?", "你是谁", "thanks"
- general_qa: pilgrimage etiquette, tips, costs, travel advice, planning help
- If a greeting is followed by a real query (e.g., "你好，宇治站附近有什么？"), \
  treat it as the real query (search_nearby), NOT as a greeting.

## Translation & Web Search
- Use translate_anime_title when you need an anime title in a different language
- Use web_search to look up information you're unsure about
- ALWAYS respond in the user's locale (ja/zh/en) — use translation tools if needed
- When showing anime titles in clarify candidates, include both original and
  the user's language if they differ

## Examples

User: "凉宫" → resolve_anime("凉宫") → ambiguous (多部匹配) → clarify()
User: "君の名は の聖地" → resolve_anime("君の名は") → bangumi_id → search_bangumi()
User: "宇治站附近" → search_nearby("宇治駅")
User: "帮我规划響け路线" → resolve_anime → search_bangumi → plan_route()
User: "圣地巡礼注意事项" → general_qa()
User: "你好" → greet_user()
User: "你好，京都有什么圣地" → search_nearby("京都")  (NOT greet_user)
User: "haruhi spots" → web_search("Haruhi Suzumiya anime") → resolve_anime → search_bangumi()
"""


pilgrimage_agent = Agent(
    resolve_model(None),
    deps_type=RuntimeDeps,
    output_type=[
        ToolOutput(ClarifyResponseModel, name="clarify_response"),
        ToolOutput(SearchResponseModel, name="search_response"),
        ToolOutput(RouteResponseModel, name="route_response"),
        ToolOutput(QAResponseModel, name="qa_response"),
        ToolOutput(GreetingResponseModel, name="greeting_response"),
    ],
    instructions=_INSTRUCTIONS,
    retries=2,
)


async def _emit_step(
    deps: RuntimeDeps,
    tool: str,
    status: str,
    data: dict[str, object],
    *,
    thought: str = "",
    observation: str = "",
) -> None:
    if deps.on_step is None:
        return
    await deps.on_step(tool, status, data, thought, observation)


def _record_plan_step(
    deps: RuntimeDeps, tool: ToolName, params: dict[str, object]
) -> None:
    deps.plan_steps.append(PlanStep(tool=tool, params=params))


def _record_step_result(
    deps: RuntimeDeps,
    *,
    tool: str,
    success: bool,
    data: object,
    error: str | None,
) -> None:
    deps.step_results.append(
        StepResult(tool=tool, success=success, data=data, error=error)
    )


async def _run_handler(
    ctx: RunContext[RuntimeDeps],
    *,
    tool: ToolName,
    params: dict[str, object],
    handler: Callable[
        [PlanStep, dict[str, object], object, object], Awaitable[dict[str, object]]
    ],
) -> dict[str, object]:
    deps = ctx.deps
    _record_plan_step(deps, tool, params)
    await _emit_step(deps, tool.value, "running", {})

    retriever = deps.retriever or Retriever(deps.db)
    deps.retriever = retriever
    raw = await handler(
        PlanStep(tool=tool, params=params),
        deps.tool_state,
        deps.db,
        retriever,
    )

    tool_name = raw.get("tool")
    success = bool(raw.get("success", False))
    data = raw.get("data")
    error = raw.get("error")
    _record_step_result(
        deps,
        tool=str(tool_name) if isinstance(tool_name, str) else tool.value,
        success=success,
        data=data,
        error=str(error) if isinstance(error, str) else None,
    )

    payload = data if isinstance(data, dict) else {}
    if success and isinstance(data, dict):
        deps.tool_state[tool.value] = data
        await _emit_step(deps, tool.value, "done", payload)
    else:
        await _emit_step(deps, tool.value, "failed", payload)

    return payload


@pilgrimage_agent.tool
async def resolve_anime(ctx: RunContext[RuntimeDeps], title: str) -> dict[str, object]:
    """Look up an anime by title and return its unique database identifier.

    Call this FIRST whenever the user mentions an anime by name.

    Returns on success: {"bangumi_id": "262243", "title": "君の名は。"}
    Returns on ambiguity: {"ambiguous": true, "candidates": [{"title": ..., "bangumi_id": ...}, ...]}
    Returns on failure: {"error": "Could not resolve anime: 'xyz'"}

    If the result contains "ambiguous": true, you MUST call clarify() with the
    candidate titles. Do NOT guess which anime the user means.

    Args:
        title: The anime title in any language. Examples: "君の名は", "你的名字",
               "Your Name", "響け", "凉宫"
    """
    return await _run_handler(
        ctx,
        tool=ToolName.RESOLVE_ANIME,
        params={"title": title},
        handler=execute_resolve_anime,
    )


@pilgrimage_agent.tool
async def search_bangumi(
    ctx: RunContext[RuntimeDeps],
    bangumi_id: str | None = None,
    *,
    episode: int | None = None,
    force_refresh: bool = False,
) -> dict[str, object]:
    """Find real-world pilgrimage filming locations for a specific anime.

    Call this AFTER resolve_anime returns a bangumi_id.
    If bangumi_id is None, it will be read from the previous resolve_anime result.

    Returns: {"rows": [...points...], "row_count": 5, "status": "ok"}
    Each row contains: id, name, name_cn, latitude, longitude, episode, screenshot_url

    If no points are found in the database, the system will automatically try to
    fetch them from the Anitabi API and write them to the database.

    Args:
        bangumi_id: The anime's unique ID from resolve_anime. Leave None if
                    resolve_anime was called in a previous step.
        episode: Optional episode number to filter results.
        force_refresh: Set True only if the user explicitly asks to refresh data.
    """
    params: dict[str, object] = {"episode": episode, "force_refresh": force_refresh}
    if bangumi_id is not None:
        params["bangumi_id"] = bangumi_id
        params["bangumi"] = bangumi_id  # backward compat for context extractors
    return await _run_handler(
        ctx,
        tool=ToolName.SEARCH_BANGUMI,
        params=params,
        handler=execute_search_bangumi,
    )


@pilgrimage_agent.tool
async def search_nearby(
    ctx: RunContext[RuntimeDeps],
    *,
    location: str,
    radius: int | None = None,
) -> dict[str, object]:
    """Find anime pilgrimage spots near a real-world location using geo search.

    Use this for location-based queries like "宇治站附近", "spots near Kyoto".
    Do NOT call resolve_anime first — this tool searches by geography, not by anime.

    Returns: {"rows": [...points with distance_m...], "row_count": 3, "status": "ok"}
    Each row includes distance_m (meters from the search center).

    Args:
        location: A place name like "宇治駅", "Kyoto Station", "秋葉原", "Kamakura".
                  Use the most specific name the user provided.
        radius: Search radius in meters. Default is 5000 (5km). Use smaller radius
                for specific stations, larger for cities.
    """
    params: dict[str, object] = {"location": location}
    if radius is not None:
        params["radius"] = radius
    return await _run_handler(
        ctx,
        tool=ToolName.SEARCH_NEARBY,
        params=params,
        handler=execute_search_nearby,
    )


@pilgrimage_agent.tool
async def plan_route(
    ctx: RunContext[RuntimeDeps],
    *,
    origin: str | None = None,
    pacing: str | None = None,
    start_time: str | None = None,
) -> dict[str, object]:
    """Create an optimized walking route from the pilgrimage points found by search_bangumi.

    IMPORTANT: You must call search_bangumi BEFORE this tool. plan_route uses
    the search results to create a walking route with a timed itinerary.

    Returns: {"ordered_points": [...], "point_count": 5, "timed_itinerary": {...},
              "status": "ok"}
    The timed_itinerary includes stops, legs, total_minutes, total_distance_m.

    Args:
        origin: Optional departure station/location. Examples: "東京駅", "京都駅".
                If the user mentions a starting point, include it here.
        pacing: Walking pace — "chill" (slow), "normal", or "packed" (fast).
        start_time: Departure time as "HH:MM". Default is "09:00".
    """
    params: dict[str, object] = {}
    if origin is not None:
        params["origin"] = origin
    if pacing is not None:
        params["pacing"] = pacing
    if start_time is not None:
        params["start_time"] = start_time
    return await _run_handler(
        ctx,
        tool=ToolName.PLAN_ROUTE,
        params=params,
        handler=execute_plan_route,
    )


@pilgrimage_agent.tool
async def greet_user(ctx: RunContext[RuntimeDeps], message: str) -> dict[str, object]:
    """Respond to greetings and "what can you do?" questions.

    Use ONLY for: "hi", "hello", "你好", "こんにちは", "你是谁", "what can you do?",
    "thanks", "ありがとう", "谢谢", "goodbye".

    Do NOT use this if the greeting is followed by a real query.
    Example: "你好，宇治站附近有什么？" → use search_nearby, NOT greet_user.

    Args:
        message: A friendly introduction in the user's language (2-4 sentences).
                 Include 2-3 example queries the user can try.
    """
    return await _run_handler(
        ctx,
        tool=ToolName.GREET_USER,
        params={"message": message},
        handler=execute_greet_user,
    )


@pilgrimage_agent.tool
async def general_qa(ctx: RunContext[RuntimeDeps], answer: str) -> dict[str, object]:
    """Answer general questions about anime pilgrimage (etiquette, tips, costs, planning).

    Use for questions like:
    - "圣地巡礼有什么注意事项？" (pilgrimage etiquette)
    - "聖地巡礼のマナーを教えて" (pilgrimage manners)
    - "How much does an anime pilgrimage cost?"
    - "What should I bring for a pilgrimage trip?"

    Do NOT use this for anime-specific queries (use resolve_anime + search instead).
    Do NOT use this for greetings (use greet_user instead).

    Args:
        answer: Your helpful answer about pilgrimage in the user's language.
    """
    return await _run_handler(
        ctx,
        tool=ToolName.ANSWER_QUESTION,
        params={"answer": answer},
        handler=execute_answer_question,
    )


@pilgrimage_agent.tool
async def clarify(
    ctx: RunContext[RuntimeDeps],
    *,
    question: str,
    options: list[str] | None = None,
) -> dict[str, object]:
    """Ask the user a clarification question when you cannot proceed confidently.

    Use when:
    - resolve_anime returns "ambiguous": true (multiple anime match the query)
    - The user's query is too vague to determine intent
    - A nearby search needs a location but none was provided

    The tool will automatically enrich the candidate titles with cover art,
    spot count, and city information from the database.

    Args:
        question: The clarification question in the user's language.
                  Example: "你是指哪部凉宫？" or "Which anime do you mean?"
        options: List of candidate anime titles to show the user.
                 Example: ["涼宮ハルヒの憂鬱", "涼宮ハルヒの消失"]
    """
    deps = ctx.deps
    normalized_options = options or []
    _record_plan_step(
        deps, ToolName.CLARIFY, {"question": question, "options": normalized_options}
    )
    await _emit_step(deps, ToolName.CLARIFY.value, "running", {})

    candidates = await enrich_clarify_candidates(deps, normalized_options)
    payload: dict[str, object] = {
        "question": question,
        "options": normalized_options,
        "candidates": candidates,
        "status": "needs_clarification",
    }

    deps.tool_state[ToolName.CLARIFY.value] = payload
    _record_step_result(
        deps,
        tool=ToolName.CLARIFY.value,
        success=True,
        data=payload,
        error=None,
    )
    await _emit_step(deps, ToolName.CLARIFY.value, "done", payload)
    return payload


@pilgrimage_agent.tool
async def enrich_candidates(
    ctx: RunContext[RuntimeDeps],
    *,
    titles: list[str],
) -> list[dict[str, object]]:
    """Enrich anime title candidates for clarify cards (DB-first, gateway fallback)."""
    return await enrich_clarify_candidates(ctx.deps, titles)


@pilgrimage_agent.tool
async def web_search(
    ctx: RunContext[RuntimeDeps],
    *,
    query: str,
) -> str:
    """Search the web for information using DuckDuckGo.

    Use this when you need to:
    - Find the correct translation of an anime title (e.g., search "響け！ユーフォニアム English name")
    - Look up information about a pilgrimage location
    - Verify facts about an anime or location
    - Find community-accepted translations from 萌娘百科 or Wikipedia

    Args:
        query: The search query. Be specific. Include the language you want results in.
               Examples:
               - "響け！ユーフォニアム Chinese name 中文名"
               - "Your Name anime Japanese title"
               - "宇治駅 anime pilgrimage spots"

    Returns a text summary of the top search results.
    """
    from ddgs import DDGS

    with DDGS() as ddgs:
        results = list(ddgs.text(query, max_results=5))
    if not results:
        return f"No results found for: {query}"
    lines = []
    for r in results[:5]:
        title = r.get("title", "")
        body = r.get("body", "")
        href = r.get("href", "")
        lines.append(f"- {title}: {body} ({href})")
    return "\n".join(lines)


@pilgrimage_agent.tool
async def translate_anime_title(
    ctx: RunContext[RuntimeDeps],
    *,
    title: str,
    target_language: str,
) -> dict[str, object]:
    """Translate an anime title to a target language using authoritative sources.

    This tool searches Bangumi, 萌娘百科, and Wikipedia for the community-accepted
    translation. It does NOT hard-translate — it finds the official localized title.

    IMPORTANT: Always use this tool when you need to show an anime title in a
    different language from the original. Do not guess translations.

    Args:
        title: The anime title to translate. Can be in any language.
               Examples: "君の名は。", "Your Name", "你的名字"
        target_language: Target language code: "ja", "zh", or "en"

    Returns: {"original": "...", "translated": "...", "source": "db|bangumi_api|web_search", "confidence": 0.0-1.0}
    """
    result = await translate_title(
        title,
        target_locale=target_language,
        db=ctx.deps.db,
    )
    return {
        "original": result.original,
        "translated": result.translated,
        "source": result.source,
        "confidence": result.confidence,
    }


def _seed_tool_state(deps: RuntimeDeps, context: dict[str, object] | None) -> None:
    deps.tool_state["locale"] = deps.locale
    if context is None:
        return
    last_location = context.get("last_location")
    if isinstance(last_location, str) and last_location:
        deps.tool_state["last_location"] = last_location
    origin_lat = context.get("origin_lat")
    origin_lng = context.get("origin_lng")
    if isinstance(origin_lat, int | float):
        deps.tool_state["origin_lat"] = float(origin_lat)
    if isinstance(origin_lng, int | float):
        deps.tool_state["origin_lng"] = float(origin_lng)

    raw = context.get("last_search_data")
    if not isinstance(raw, dict):
        return
    for key in ("search_bangumi", "search_nearby"):
        value = raw.get(key)
        if isinstance(value, dict):
            deps.tool_state[key] = value


def _status_from_payload(payload: object, *, fallback: str) -> str:
    if isinstance(payload, dict):
        value = payload.get("status")
        if isinstance(value, str) and value:
            return value
    return fallback


async def run_pilgrimage_agent(
    *,
    text: str,
    db: object,
    locale: str,
    model: Model | str | None = None,
    context: dict[str, object] | None = None,
    on_step: _OnStep | None = None,
    model_settings: object | None = None,
) -> PipelineResult:
    """Run the main agent and adapt output into a PipelineResult for persistence/debug."""
    retriever = Retriever(db)
    deps = RuntimeDeps(
        db=db,
        locale=locale,
        query=text,
        retriever=retriever,
        on_step=on_step,
    )
    _seed_tool_state(deps, context)

    run_result = await pilgrimage_agent.run(
        text,
        deps=deps,
        model=model,  # type: ignore[arg-type]
        model_settings=model_settings,  # type: ignore[arg-type]
    )
    raw_output = run_result.output
    if isinstance(raw_output, str):
        raise ValueError(
            f"Agent returned plain string instead of typed output: {raw_output[:200]}"
        )
    output = raw_output

    plan = ExecutionPlan(
        steps=list(deps.plan_steps),
        reasoning="pydanticai",
        locale=locale,
    )
    result = PipelineResult(intent=str(output.intent), plan=plan)
    result.step_results = list(deps.step_results)

    final_output: dict[str, object] = {
        "success": all(sr.success for sr in deps.step_results),
        "message": str(output.message),
    }

    from backend.agents.runtime_models import (
        ClarifyResponseModel as _Clarify,
    )
    from backend.agents.runtime_models import (
        RouteResponseModel as _Route,
    )
    from backend.agents.runtime_models import (
        SearchResponseModel as _Search,
    )

    if isinstance(output, _Clarify):
        final_output["status"] = "needs_clarification"
        final_output.update(output.data.model_dump(mode="json"))
    elif isinstance(output, _Search):
        tool_key = str(output.intent)
        tool_payload = deps.tool_state.get(tool_key)
        payload = (
            tool_payload
            if isinstance(tool_payload, dict)
            else output.data.results.model_dump(mode="json")
        )
        final_output["status"] = _status_from_payload(payload, fallback="ok")
        final_output["results"] = payload
    elif isinstance(output, _Route):
        tool_key = str(output.intent)
        tool_payload = deps.tool_state.get(tool_key)
        payload = (
            tool_payload
            if isinstance(tool_payload, dict)
            else output.data.route.model_dump(mode="json")
        )
        final_output["status"] = _status_from_payload(payload, fallback="ok")
        final_output["route"] = payload
    else:
        payload = output.data.model_dump(mode="json")
        payload["message"] = str(output.message)
        final_output["status"] = _status_from_payload(payload, fallback="info")
        final_output.update(payload)

    result.final_output = final_output
    logger.info(
        "pilgrimage_agent_complete",
        intent=result.intent,
        steps=len(result.plan.steps),
    )
    return result
