"""Runner: execute the pilgrimage agent and adapt output to PipelineResult.

Separated from the agent definition so that the agent module stays small
and the tool module can import the agent object without circular deps.
"""

from __future__ import annotations

import structlog
from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings

import backend.agents.pilgrimage_tools as _tools  # noqa: F401
from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan

# Importing pilgrimage_tools triggers @tool registrations on the agent.
from backend.agents.pilgrimage_agent import pilgrimage_agent  # noqa: F401
from backend.agents.retriever import Retriever
from backend.agents.runtime_deps import OnStep, RuntimeDeps
from backend.agents.runtime_models import (
    ClarifyResponseModel,
    RouteResponseModel,
    SearchResponseModel,
)
from backend.domain.ports import DatabasePort

logger = structlog.get_logger(__name__)


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
    db: DatabasePort,
    locale: str,
    model: Model | str | None = None,
    context: dict[str, object] | None = None,
    on_step: OnStep | None = None,
    model_settings: ModelSettings | None = None,
) -> PipelineResult:
    """Run the main agent and adapt output into a PipelineResult."""
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
        model=model,
        model_settings=model_settings,
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
        "success": all(sr.success for sr in deps.step_results)
        if deps.step_results
        else True,
        "message": str(output.message),
    }

    if isinstance(output, ClarifyResponseModel):
        final_output["status"] = "needs_clarification"
        final_output.update(output.data.model_dump(mode="json"))
    elif isinstance(output, SearchResponseModel):
        tool_key = str(output.intent)
        tool_payload = deps.tool_state.get(tool_key)
        payload = (
            tool_payload
            if isinstance(tool_payload, dict)
            else output.data.results.model_dump(mode="json")
        )
        final_output["status"] = _status_from_payload(payload, fallback="ok")
        final_output["results"] = payload
    elif isinstance(output, RouteResponseModel):
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
