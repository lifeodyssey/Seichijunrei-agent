"""ExecutorAgent — deterministic plan step execution.

Accepts an ExecutionPlan from ReActPlannerAgent and executes each step using
the appropriate handler. No LLM calls — all responses use static message
templates. Steps communicate via context dict (each step deposits its output).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import cast

import structlog

from backend.agents.handlers import (
    execute_answer_question,
    execute_greet_user,
    execute_plan_route,
    execute_plan_selected,
    execute_resolve_anime,
    execute_search_bangumi,
    execute_search_nearby,
)
from backend.agents.handlers.answer_question import execute_clarify
from backend.agents.messages import build_message
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.agents.retriever import Retriever

logger = structlog.get_logger(__name__)

_HandlerFn = Callable[
    [PlanStep, dict[str, object], object, object], Awaitable[dict[str, object]]
]
_HANDLER_MAP: dict[ToolName, _HandlerFn] = {
    ToolName.RESOLVE_ANIME: execute_resolve_anime,
    ToolName.SEARCH_BANGUMI: execute_search_bangumi,
    ToolName.SEARCH_NEARBY: execute_search_nearby,
    ToolName.PLAN_ROUTE: execute_plan_route,
    ToolName.PLAN_SELECTED: execute_plan_selected,
    ToolName.GREET_USER: execute_greet_user,
    ToolName.ANSWER_QUESTION: execute_answer_question,
    ToolName.CLARIFY: execute_clarify,
}

_PRIMARY_TOOL_PRIORITY = (
    ToolName.CLARIFY,
    ToolName.PLAN_ROUTE,
    ToolName.PLAN_SELECTED,
    ToolName.SEARCH_BANGUMI,
    ToolName.SEARCH_NEARBY,
    ToolName.ANSWER_QUESTION,
    ToolName.GREET_USER,
)


@dataclass
class StepResult:
    tool: str
    success: bool
    data: object = None
    error: str | None = None


@dataclass
class PipelineResult:
    intent: str
    plan: ExecutionPlan
    step_results: list[StepResult] = field(default_factory=list)
    final_output: dict[str, object] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return all(r.success for r in self.step_results)


class ExecutorAgent:
    """Executes ExecutionPlan steps deterministically."""

    def __init__(self, db: object) -> None:
        from backend.domain.ports import DatabasePort

        self._retriever = Retriever(cast(DatabasePort, db))
        self._db = db

    async def execute(
        self,
        plan: ExecutionPlan,
        context_block: Mapping[str, object] | None = None,
        on_step: Callable[[str, str, dict[str, object], str, str], Awaitable[None]]
        | None = None,
    ) -> PipelineResult:
        """Execute all steps in the plan and return a PipelineResult."""
        primary_tool = _infer_primary_tool(plan)
        result = PipelineResult(intent=primary_tool, plan=plan)
        context: dict[str, object] = {"locale": getattr(plan, "locale", "ja")}
        if context_block:
            if context_block.get("last_location"):
                context["last_location"] = context_block["last_location"]
            if context_block.get("origin_lat") is not None:
                context["origin_lat"] = context_block["origin_lat"]
            if context_block.get("origin_lng") is not None:
                context["origin_lng"] = context_block["origin_lng"]
        for step in plan.steps:
            tool_name = getattr(getattr(step, "tool", None), "value", "unknown")
            if on_step is not None:
                await on_step(tool_name, "running", {}, "", "")
            step_result = await self._execute_step(step, context)
            result.step_results.append(step_result)
            if on_step is not None:
                payload = step_result.data if isinstance(step_result.data, dict) else {}
                await on_step(tool_name, "done", payload, "", "")
            tool = getattr(step, "tool", None)
            if not step_result.success:
                logger.warning("step_failed", tool=tool, error=step_result.error)
                break
            if tool is not None:
                context[tool.value] = step_result.data
        result.final_output = _build_output(result, context, primary_tool)
        return result

    async def _execute_step(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        tool: ToolName | None = getattr(step, "tool", None)
        tool_name = (
            tool.value
            if tool is not None
            else str(getattr(step, "step_type", "unknown"))
        )
        handler = _HANDLER_MAP.get(tool) if isinstance(tool, ToolName) else None
        if handler is None:
            return StepResult(
                tool=tool_name, success=False, error=f"No handler for tool: {tool_name}"
            )
        try:
            raw = await handler(step, context, self._db, self._retriever)
            return StepResult(
                tool=str(raw.get("tool", tool_name)),
                success=bool(raw.get("success", False)),
                data=raw.get("data"),
                error=cast(str | None, raw.get("error")),
            )
        except (OSError, RuntimeError, ValueError, TypeError) as exc:
            logger.error("step_execution_error", tool=tool_name, error=str(exc))
            return StepResult(tool=tool_name, success=False, error=str(exc))


def _infer_primary_tool(plan: ExecutionPlan) -> str:
    """Return the primary tool name for intent labelling and message selection."""
    tools = [
        t
        for t in (getattr(s, "tool", None) for s in plan.steps)
        if isinstance(t, ToolName)
    ]
    for p in _PRIMARY_TOOL_PRIORITY:
        if p in tools:
            return str(p.value)
    return str(tools[0].value) if tools else "unknown"


def _build_output(
    result: PipelineResult, context: Mapping[str, object], primary_tool: str
) -> dict[str, object]:
    locale_raw = context.get("locale", "ja")
    locale = locale_raw if isinstance(locale_raw, str) else "ja"
    query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
        ToolName.SEARCH_NEARBY.value
    )
    route_data = context.get(ToolName.PLAN_ROUTE.value) or context.get(
        ToolName.PLAN_SELECTED.value
    )
    qa_p = context.get(ToolName.ANSWER_QUESTION.value)
    gr_p = context.get(ToolName.GREET_USER.value)
    cl_p = context.get(ToolName.CLARIFY.value)
    qa_p = qa_p if isinstance(qa_p, dict) else {}
    gr_p = gr_p if isinstance(gr_p, dict) else {}
    cl_p = cl_p if isinstance(cl_p, dict) else {}
    qp = query_data if isinstance(query_data, dict) else {}
    rp = route_data if isinstance(route_data, dict) else {}
    count = int(qp.get("row_count", 0) or 0)
    if count == 0 and rp:
        count = int(rp.get("point_count", 0) or 0)
    status = "error" if not result.success else ("empty" if count == 0 else "ok")
    output: dict[str, object] = {
        "intent": primary_tool,
        "success": result.success,
        "status": status,
        "message": build_message(primary_tool, count, locale),
    }
    if query_data:
        output["results"] = query_data
    if route_data:
        output["route"] = route_data
    if qa_p:
        output["message"] = qa_p.get("message", "")
        output["status"] = qa_p.get("status", "info")
    if gr_p:
        output["message"] = gr_p.get("message", "")
        output["status"] = gr_p.get("status", "info")
    if cl_p:
        output["intent"] = "clarify"
        output["message"] = cl_p.get("question", "")
        output["status"] = "needs_clarification"
        output["options"] = cl_p.get("options", [])
    if not result.success:
        output["errors"] = [r.error for r in result.step_results if r.error]
    return output
