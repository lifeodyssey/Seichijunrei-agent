"""Tool registrations for the PydanticAI pilgrimage agent.

Each ``@pilgrimage_agent.tool`` is a deterministic wrapper around a handler
(DB/retriever/route), keeping tool docs close to the LLM-facing contract.

Trivial tools (greet_user, general_qa) are inlined directly here — they only
build a ``{"message": ..., "status": "info"}`` dict.  Search tools
(search_bangumi, search_nearby) use inline closures that call shared helpers
from ``_base_search``.  Complex tools (resolve_anime, plan_route) still
delegate to their handler modules via ``_run_handler``.

Import this module after ``pilgrimage_agent`` is created so the decorators
can attach to it.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import structlog
from pydantic_ai import ModelRetry, RunContext

from backend.agents.agent_result import StepRecord
from backend.agents.handlers import (
    HandlerResult,
    execute_plan_route,
    execute_resolve_anime,
)
from backend.agents.handlers._base_search import (
    build_bangumi_request,
    execute_retrieval,
)
from backend.agents.models import PlanStep, RetrievalRequest, ToolName
from backend.agents.pilgrimage_agent import pilgrimage_agent
from backend.agents.retriever import Retriever
from backend.agents.runtime_deps import RuntimeDeps
from backend.agents.tools import enrich_clarify_candidates

logger = structlog.get_logger(__name__)


# ── Internal helpers ──────────────────────────────────────────────────


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


def _record_step(
    deps: RuntimeDeps,
    *,
    tool: str,
    success: bool,
    params: dict[str, object],
    data: dict[str, object] | None,
    error: str | None,
) -> None:
    deps.steps.append(
        StepRecord(tool=tool, success=success, params=params, data=data, error=error)
    )


def _summarize_for_llm(tool: ToolName, data: dict[str, object]) -> dict[str, object]:
    """Return a compact summary of tool results for the LLM.

    Full data is kept in tool_state and SSE events for the frontend.
    The LLM only needs enough context to decide its next action.
    """
    if tool not in (ToolName.SEARCH_BANGUMI, ToolName.SEARCH_NEARBY):
        return data

    rows = data.get("rows")
    if not isinstance(rows, list) or len(rows) <= 5:
        return data

    row_count = data.get("row_count", len(rows))
    metadata = data.get("metadata")
    title = ""
    if isinstance(metadata, dict):
        title = str(metadata.get("anime_title", "") or "")

    preview_rows = [
        {k: row[k] for k in ("name", "episode") if k in row}
        for row in rows[:5]
        if isinstance(row, dict)
    ]
    return {
        "row_count": row_count,
        "status": data.get("status", "ok"),
        "metadata": metadata,
        "preview": preview_rows,
        "note": f"Found {row_count} pilgrimage spots{' for ' + title if title else ''}. "
        "Full data is available — proceed to return a search_response.",
    }


async def _run_handler(
    ctx: RunContext[RuntimeDeps],
    *,
    tool: ToolName,
    params: dict[str, object],
    handler: Callable[
        [PlanStep, dict[str, object], object, object], Awaitable[HandlerResult]
    ],
) -> dict[str, object]:
    deps = ctx.deps
    await _emit_step(deps, tool.value, "running", {})

    retriever = deps.retriever or Retriever(deps.db)
    deps.retriever = retriever
    result = await handler(
        PlanStep(tool=tool, params=params),
        deps.tool_state,
        deps.db,
        retriever,
    )

    _record_step(
        deps,
        tool=tool.value,
        success=result.success,
        params=params,
        data=result.data if result.data else None,
        error=result.error,
    )

    if result.success and result.data:
        deps.tool_state[tool.value] = result.data
        await _emit_step(deps, tool.value, "done", result.data)
    else:
        error_data: dict[str, object] = {"error": result.error or "Unknown error"}
        if result.data:
            error_data.update(result.data)
        await _emit_step(
            deps,
            tool.value,
            "failed",
            error_data,
            observation=result.error or "",
        )

    # Return compact summary to LLM; full data stays in tool_state + SSE
    return _summarize_for_llm(tool, result.data) if result.data else {}


# ── Tool registrations ────────────────────────────────────────────────


@pilgrimage_agent.tool
async def resolve_anime(ctx: RunContext[RuntimeDeps], title: str) -> dict[str, object]:
    """Look up an anime by title and return its unique database identifier.

    Call this FIRST whenever the user mentions an anime by name.

    Returns on success: {"bangumi_id": "262243", "title": "君の名は。", "candidates": [...]}
    Returns on ambiguity: {"ambiguous": true, "candidates": [{"title": ..., "bangumi_id": ...}, ...]}
    Returns on failure: {"error": "Could not resolve anime: 'xyz'"}

    The "candidates" list is ALWAYS present and shows all matching anime works
    found in the database and Bangumi API. Use it to judge whether the user's
    query is specific enough:
    - If "ambiguous": true → MUST call clarify() with the candidates.
    - If single bangumi_id returned but candidates has multiple entries AND the
      user's query is short/vague → call clarify() to let the user pick.
    - If query is specific (full title) → proceed with search_bangumi.

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
    bangumi_id: str = "",
    *,
    episode: int = -1,
    force_refresh: bool = False,
) -> dict[str, object]:
    """Find real-world pilgrimage filming locations for a specific anime.

    Call this AFTER resolve_anime returns a bangumi_id.
    If bangumi_id is empty, it will be read from the previous resolve_anime result.

    Returns: {"rows": [...points...], "row_count": 5, "status": "ok"}
    Each row contains: id, name, name_cn, latitude, longitude, episode, screenshot_url

    If no points are found in the database, the system will automatically try to
    fetch them from the Anitabi API and write them to the database.

    Args:
        bangumi_id: The anime's unique ID from resolve_anime. Leave empty if
                    resolve_anime was called in a previous step.
        episode: Episode number to filter results. Use -1 for all episodes.
        force_refresh: Set True only if the user explicitly asks to refresh data.
    """
    resolved_id = bangumi_id or None
    if not resolved_id:
        resolve_data = ctx.deps.tool_state.get("resolve_anime")
        if isinstance(resolve_data, dict):
            resolved_id = resolve_data.get("bangumi_id")
    if not resolved_id:
        raise ModelRetry(
            "Call resolve_anime(title) first to get a bangumi_id, "
            "then pass it to search_bangumi."
        )
    resolved_episode = episode if episode >= 0 else None
    params: dict[str, object] = {
        "episode": resolved_episode,
        "force_refresh": force_refresh,
        "bangumi_id": resolved_id,
        "bangumi": resolved_id,
    }

    async def _inline_search_bangumi(
        step: PlanStep,
        context: dict[str, object],
        db: object,
        retriever: object,
    ) -> HandlerResult:
        req = build_bangumi_request(resolved_id, step.params or {})
        return await execute_retrieval(req, retriever)

    return await _run_handler(
        ctx,
        tool=ToolName.SEARCH_BANGUMI,
        params=params,
        handler=_inline_search_bangumi,
    )


@pilgrimage_agent.tool
async def search_nearby(
    ctx: RunContext[RuntimeDeps],
    *,
    location: str,
    radius: int = 0,
) -> dict[str, object]:
    """Find anime pilgrimage spots near a real-world location using geo search.

    Use this for location-based queries like "宇治站附近", "spots near Kyoto".
    Do NOT call resolve_anime first — this tool searches by geography, not by anime.

    Returns: {"rows": [...points with distance_m...], "row_count": 3, "status": "ok"}
    Each row includes distance_m (meters from the search center).

    Args:
        location: A place name like "宇治駅", "Kyoto Station", "秋葉原", "Kamakura".
                  Use the most specific name the user provided.
        radius: Search radius in meters. Default is 5000 (5km). Use 0 for default.
                Use smaller radius for specific stations, larger for cities.
    """
    params: dict[str, object] = {"location": location}
    if radius > 0:
        params["radius"] = radius

    async def _inline_search_nearby(
        step: PlanStep,
        context: dict[str, object],
        db: object,
        retriever: object,
    ) -> HandlerResult:
        p = step.params or {}
        loc = p.get("location")
        req = RetrievalRequest(
            tool="search_nearby",
            location=loc if isinstance(loc, str) else "",
            radius=p.get("radius") if isinstance(p.get("radius"), int) else None,
        )
        return await execute_retrieval(req, retriever)

    return await _run_handler(
        ctx,
        tool=ToolName.SEARCH_NEARBY,
        params=params,
        handler=_inline_search_nearby,
    )


@pilgrimage_agent.tool
async def plan_route(
    ctx: RunContext[RuntimeDeps],
    *,
    origin: str = "",
    pacing: str = "",
    start_time: str = "",
) -> dict[str, object]:
    """Create an optimized walking route from the pilgrimage points found by search_bangumi.

    IMPORTANT: You must call search_bangumi BEFORE this tool. plan_route uses
    the search results to create a walking route with a timed itinerary.

    Returns: {"ordered_points": [...], "point_count": 5, "timed_itinerary": {...},
              "status": "ok"}
    The timed_itinerary includes stops, legs, total_minutes, total_distance_m.

    Args:
        origin: Departure station/location. Examples: "東京駅", "京都駅".
                Leave empty if the user doesn't mention a starting point.
        pacing: Walking pace — "chill" (slow), "normal", or "packed" (fast).
                Leave empty for default "normal" pace.
        start_time: Departure time as "HH:MM". Leave empty for default "09:00".
    """
    search_data = ctx.deps.tool_state.get("search_bangumi") or ctx.deps.tool_state.get(
        "search_nearby"
    )
    if not isinstance(search_data, dict) or not search_data.get("rows"):
        raise ModelRetry(
            "Call search_bangumi or search_nearby first to get pilgrimage points, "
            "then call plan_route to create the walking route."
        )
    params: dict[str, object] = {}
    if origin:
        params["origin"] = origin
    if pacing:
        params["pacing"] = pacing
    if start_time:
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
    deps = ctx.deps
    await _emit_step(deps, ToolName.GREET_USER.value, "running", {})
    data: dict[str, object] = {"message": message, "status": "info"}
    _record_step(
        deps,
        tool=ToolName.GREET_USER.value,
        success=True,
        params={"message": message},
        data=data,
        error=None,
    )
    deps.tool_state[ToolName.GREET_USER.value] = data
    await _emit_step(deps, ToolName.GREET_USER.value, "done", data)
    return data


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
    deps = ctx.deps
    await _emit_step(deps, ToolName.ANSWER_QUESTION.value, "running", {})
    data: dict[str, object] = {"message": answer, "status": "info"}
    _record_step(
        deps,
        tool=ToolName.ANSWER_QUESTION.value,
        success=True,
        params={"answer": answer},
        data=data,
        error=None,
    )
    deps.tool_state[ToolName.ANSWER_QUESTION.value] = data
    await _emit_step(deps, ToolName.ANSWER_QUESTION.value, "done", data)
    return data


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
    normalized_options = list(options) if options else []
    await _emit_step(deps, ToolName.CLARIFY.value, "running", {})

    candidates = await enrich_clarify_candidates(deps, normalized_options)
    payload: dict[str, object] = {
        "question": question,
        "options": normalized_options,
        "candidates": candidates,
        "status": "needs_clarification",
    }

    deps.tool_state[ToolName.CLARIFY.value] = payload
    _record_step(
        deps,
        tool=ToolName.CLARIFY.value,
        success=True,
        params={"question": question, "options": normalized_options},
        data=payload,
        error=None,
    )
    await _emit_step(deps, ToolName.CLARIFY.value, "done", payload)
    return payload
