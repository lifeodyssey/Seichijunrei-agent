"""Pipeline — ReAct loop: think → act → observe → repeat."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field

import structlog
from pydantic_ai.models import Model

from backend.agents.executor_agent import ExecutorAgent, PipelineResult, StepResult
from backend.agents.models import (
    ExecutionPlan,
    Observation,
    PlanStep,
    ToolName,
)
from backend.agents.planner_agent import ReActPlannerAgent

logger = structlog.get_logger(__name__)

MAX_REACT_STEPS = 8


@dataclass
class ReactStepEvent:
    """One event yielded by the ReAct loop for SSE streaming."""

    type: str  # "step", "done", "clarify", "error"
    thought: str = ""
    tool: str = ""
    status: str = ""
    observation: str = ""
    message: str = ""
    data: dict[str, object] = field(default_factory=dict)
    step_result: StepResult | None = None


async def react_loop(
    text: str,
    planner: ReActPlannerAgent,
    executor: ExecutorAgent,
    *,
    locale: str = "ja",
    context: dict[str, object] | None = None,
    max_steps: int = MAX_REACT_STEPS,
) -> AsyncIterator[ReactStepEvent]:
    """ReAct loop: planner thinks → executor acts → observe → repeat.

    Yields ReactStepEvent for each step (for SSE streaming).
    """
    history: list[Observation] = []
    accumulated_results: list[StepResult] = []
    executor_context: dict[str, object] = {"locale": locale}
    if context and context.get("last_location"):
        executor_context["last_location"] = context["last_location"]

    for turn in range(max_steps):
        # 1. Planner thinks
        react_step = await planner.step(
            text=text, locale=locale, context=context, history=history
        )

        logger.info(
            "react_turn",
            turn=turn,
            thought=react_step.thought[:100],
            has_action=react_step.action is not None,
            has_done=react_step.done is not None,
        )

        # 2. If done, check if we actually searched before stopping
        if react_step.done is not None:
            # Guard: if we resolved an anime but never searched, inject search_bangumi
            has_resolve = any(
                r.tool == "resolve_anime" and r.success for r in accumulated_results
            )
            has_search = any(
                r.tool in ("search_bangumi", "search_nearby")
                for r in accumulated_results
            )
            if has_resolve and not has_search:
                resolve_data = next(
                    (
                        r.data
                        for r in accumulated_results
                        if r.tool == "resolve_anime"
                        and r.success
                        and isinstance(r.data, dict)
                    ),
                    None,
                )
                bangumi_id = resolve_data.get("bangumi_id") if resolve_data else None
                if bangumi_id:
                    logger.info(
                        "react_guard_inject_search_after_done", bangumi_id=bangumi_id
                    )
                    search_step = PlanStep(
                        tool=ToolName.SEARCH_BANGUMI,
                        params={"bangumi_id": bangumi_id},
                    )
                    yield ReactStepEvent(
                        type="step",
                        thought="Guard: planner stopped early, injecting search_bangumi",
                        tool="search_bangumi",
                        status="running",
                    )
                    search_result = await executor._execute_step(
                        search_step, executor_context
                    )
                    accumulated_results.append(search_result)
                    if search_result.success and hasattr(search_step, "tool"):
                        executor_context[search_step.tool.value] = search_result.data
                    search_obs = ExecutorAgent.format_observation(search_result)
                    history.append(search_obs)
                    yield ReactStepEvent(
                        type="step",
                        thought="Guard: search_bangumi completed",
                        tool="search_bangumi",
                        status="done",
                        observation=search_obs.summary,
                        data=search_result.data
                        if isinstance(search_result.data, dict)
                        else {},
                        step_result=search_result,
                    )

            yield ReactStepEvent(
                type="done",
                thought=react_step.thought,
                message=react_step.done.message,
                data={"step_results": [r.data for r in accumulated_results if r.data]},
            )
            return

        # 3. If action, execute it
        if react_step.action is not None:
            step = react_step.action
            tool_name = (
                step.tool.value if hasattr(step.tool, "value") else str(step.tool)
            )

            # ── Deterministic guard: ensure resolve_anime before search_bangumi ──
            has_resolved = any(o.tool == "resolve_anime" for o in history)
            if (
                tool_name == "search_bangumi"
                and not has_resolved
                and not (step.params or {}).get("bangumi_id")
            ):
                logger.info("react_guard_inject_resolve_anime", query=text)
                resolve_step = PlanStep(
                    tool=ToolName.RESOLVE_ANIME,
                    params={"title": text},
                )

                # Yield running event for injected step
                yield ReactStepEvent(
                    type="step",
                    thought="Guard: injecting resolve_anime before search_bangumi",
                    tool="resolve_anime",
                    status="running",
                )

                # Execute the injected resolve_anime
                resolve_result = await executor._execute_step(
                    resolve_step, executor_context
                )
                accumulated_results.append(resolve_result)

                if resolve_result.success and hasattr(resolve_step, "tool"):
                    executor_context[resolve_step.tool.value] = resolve_result.data

                resolve_obs = ExecutorAgent.format_observation(resolve_result)
                history.append(resolve_obs)

                yield ReactStepEvent(
                    type="step",
                    thought="Guard: resolve_anime completed",
                    tool="resolve_anime",
                    status="done",
                    observation=resolve_obs.summary,
                    data=(
                        resolve_result.data
                        if isinstance(resolve_result.data, dict)
                        else {}
                    ),
                    step_result=resolve_result,
                )

                if not resolve_result.success:
                    yield ReactStepEvent(
                        type="error",
                        thought="Guard: resolve_anime failed",
                        message=(
                            f"Could not resolve anime title: {resolve_result.error}"
                        ),
                    )
                    return
            # ── End guard ──

            # Yield "running" event
            yield ReactStepEvent(
                type="step",
                thought=react_step.thought,
                tool=tool_name,
                status="running",
            )

            # Execute
            step_result = await executor._execute_step(step, executor_context)
            accumulated_results.append(step_result)

            # Update executor context (same as original pipeline)
            if step_result.success and hasattr(step, "tool"):
                executor_context[step.tool.value] = step_result.data

            # Format observation for planner
            obs = ExecutorAgent.format_observation(step_result)
            history.append(obs)

            # Yield "done" event for this step
            yield ReactStepEvent(
                type="step",
                thought=react_step.thought,
                tool=tool_name,
                status="done",
                observation=obs.summary,
                data=step_result.data if isinstance(step_result.data, dict) else {},
                step_result=step_result,
            )

            # If step failed, stop the loop
            if not step_result.success:
                yield ReactStepEvent(
                    type="error",
                    thought=react_step.thought,
                    message=f"Step {tool_name} failed: {step_result.error}",
                )
                return

            # If clarify, pause and wait for user input
            if tool_name == "clarify":
                clarify_data = (
                    step_result.data if isinstance(step_result.data, dict) else {}
                )
                yield ReactStepEvent(
                    type="clarify",
                    thought=react_step.thought,
                    tool="clarify",
                    data=clarify_data,
                    message=str(clarify_data.get("question", "")),
                )
                return

    # Max steps reached — force done
    yield ReactStepEvent(
        type="done",
        thought="Maximum reasoning steps reached",
        message="I've completed my analysis. Here are the results so far.",
        data={"step_results": [r.data for r in accumulated_results if r.data]},
    )


async def run_pipeline(
    text: str,
    db: object,
    *,
    model: Model | str | None = None,
    locale: str = "ja",
    context: dict[str, object] | None = None,
    on_step: Callable[[str, str, dict[str, object]], Awaitable[None]] | None = None,
) -> PipelineResult:
    """Backward-compatible wrapper: runs ReAct loop and collects into PipelineResult."""
    planner = ReActPlannerAgent(model)
    executor = ExecutorAgent(db)

    all_step_results: list[StepResult] = []
    final_message = ""

    async for event in react_loop(
        text=text,
        planner=planner,
        executor=executor,
        locale=locale,
        context=context,
    ):
        if on_step is not None and event.type == "step":
            await on_step(event.tool, event.status, event.data)

        if event.step_result is not None:
            all_step_results.append(event.step_result)

        if event.type == "done":
            final_message = event.message

    # Build a PipelineResult from accumulated results
    # Infer intent from the last successful tool execution
    intent = "answer_question"
    for sr in reversed(all_step_results):
        if sr.success and sr.tool not in ("resolve_anime", "greet_user"):
            intent = sr.tool
            break

    plan = ExecutionPlan(
        steps=[],  # ReAct doesn't produce a pre-computed plan
        reasoning="ReAct loop",
        locale=locale,
    )
    result = PipelineResult(intent=intent, plan=plan)
    result.step_results = all_step_results

    # Build final_output keyed so _pipeline_result_to_public_response can find it.
    # Search results go under "results", route data under "route", others spread flat.
    last_data: dict[str, object] = {}
    for sr in reversed(all_step_results):
        if sr.success and isinstance(sr.data, dict):
            last_data = sr.data
            break

    is_empty = not last_data or last_data.get("row_count", -1) == 0
    result.final_output = {
        "success": bool(all_step_results and all_step_results[-1].success),
        "status": "empty" if is_empty else "ok",
        "message": final_message,
    }
    if intent in ("search_bangumi", "search_nearby"):
        result.final_output["results"] = last_data
    elif intent in ("plan_route", "plan_selected"):
        result.final_output["route"] = last_data
    else:
        result.final_output.update(last_data)

    return result
