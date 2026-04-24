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

logger = structlog.get_logger(__name__)


_OnStep = Callable[[str, str, dict[str, object], str, str], Awaitable[None]]


_INSTRUCTIONS = """\
You are the main runtime agent for an anime pilgrimage (聖地巡礼) app.

You must return exactly one stage response:
- clarify (needs user input)
- search_bangumi / search_nearby (panel handoff)
- plan_route / plan_selected (route completion)
- general_qa / greet_user (simple answer)

Rules:
1) Anime title queries: call resolve_anime first, then search_bangumi.
2) Nearby/location queries: call search_nearby with a location + radius when possible.
3) Route requests: call plan_route after search results are available.
4) If ambiguous, call clarify(question, options). The clarify tool will enrich candidates.
5) Prefer using tool outputs in your final response; do not fabricate rows or routes.
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
    """Resolve an anime title to bangumi_id (DB-first, gateway fallback)."""
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
    """Search pilgrimage points for a specific bangumi_id."""
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
    """Search pilgrimage points near a named location within a radius."""
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
    """Plan an optimized route from the current search results."""
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
    """Return an introduction / identity response (no retrieval)."""
    return await _run_handler(
        ctx,
        tool=ToolName.GREET_USER,
        params={"message": message},
        handler=execute_greet_user,
    )


@pilgrimage_agent.tool
async def answer_question(
    ctx: RunContext[RuntimeDeps], answer: str
) -> dict[str, object]:
    """Return a plain QA answer (no retrieval)."""
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
    """Ask a clarification question with enriched candidate cards."""
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

    run_result = await pilgrimage_agent.run(text, deps=deps, model=model)
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
