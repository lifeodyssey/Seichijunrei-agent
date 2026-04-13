"""Pipeline — ReAct loop: think → act → observe → repeat."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field

import structlog
from pydantic_ai.models import Model

from backend.agents.executor_agent import ExecutorAgent, PipelineResult, StepResult
from backend.agents.intent_classifier import classify_intent
from backend.agents.models import (
    ExecutionPlan,
    Observation,
)
from backend.agents.planner_agent import ReActPlannerAgent

logger = structlog.get_logger(__name__)

MAX_REACT_STEPS = 8

# Intent priority: lower number = higher precedence (route > search > fallback).
_INTENT_PRIORITY: dict[str, int] = {
    "plan_route": 0,
    "plan_selected": 1,
    "search_nearby": 2,
    "search_bangumi": 3,
    "answer_question": 4,
    "clarify": 5,
    "greet_user": 6,
    "resolve_anime": 7,
}


def _infer_intent(step_results: list[StepResult], priority_map: dict[str, int]) -> str:
    """Return the highest-priority tool name from successful step results."""
    intent = "answer_question"
    best_priority = priority_map.get("answer_question", 99)
    for sr in step_results:
        if sr.success:
            p = priority_map.get(sr.tool, 99)
            if p < best_priority:
                intent = sr.tool
                best_priority = p
    return intent


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
    The planner's output_validator enforces step prerequisites and rejects
    premature "done" signals — no deterministic guards needed here.
    """
    history: list[Observation] = []
    failure_count = 0
    accumulated_results: list[StepResult] = []
    executor_context: dict[str, object] = {"locale": locale}
    if context and context.get("last_location"):
        executor_context["last_location"] = context["last_location"]

    # Classify intent once for the entire loop
    classified_intent, _confidence = classify_intent(text, locale)

    for turn in range(max_steps):
        # 1. Planner thinks (output_validator enforces prerequisites)
        react_step = await planner.step(
            text=text,
            locale=locale,
            context=context,
            history=history,
            classified_intent=classified_intent,
        )

        logger.info(
            "react_turn",
            turn=turn,
            thought=react_step.thought[:100],
            has_action=react_step.action is not None,
            has_done=react_step.done is not None,
        )

        # 2. If done, yield final event
        if react_step.done is not None:
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
                failure_count = 0  # reset on success

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

            # If step failed, let planner recover
            if not step_result.success:
                failure_count += 1
                if failure_count >= 2:
                    yield ReactStepEvent(
                        type="error",
                        thought="Too many consecutive failures",
                        message=(
                            f"Stopped after {failure_count} failures. "
                            f"Last: {step_result.error}"
                        ),
                    )
                    return
                # Planner already has the failure observation in history
                # Just yield a failed step event and continue the loop
                yield ReactStepEvent(
                    type="step",
                    thought=react_step.thought,
                    tool=tool_name,
                    status="failed",
                    observation=obs.summary,
                )
                continue

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
    on_step: Callable[[str, str, dict[str, object], str, str], Awaitable[None]]
    | None = None,
) -> PipelineResult:
    """Backward-compatible wrapper: runs ReAct loop and collects into PipelineResult."""
    planner = ReActPlannerAgent(model)
    executor = ExecutorAgent(db)

    all_step_results: list[StepResult] = []
    final_message = ""
    clarify_fired = False

    async for event in react_loop(
        text=text,
        planner=planner,
        executor=executor,
        locale=locale,
        context=context,
    ):
        if on_step is not None and event.type == "step":
            await on_step(
                event.tool, event.status, event.data, event.thought, event.observation
            )

        if event.type == "clarify":
            clarify_fired = True
            final_message = event.message
            if on_step is not None:
                await on_step(
                    "clarify",
                    "needs_clarification",
                    event.data,
                    event.thought,
                    event.message,
                )

        if event.step_result is not None:
            all_step_results.append(event.step_result)

        if event.type == "done":
            final_message = event.message

    # Build a PipelineResult from accumulated results
    intent = _infer_intent(all_step_results, _INTENT_PRIORITY)
    # clarify overrides inferred intent when the planner requested clarification
    if clarify_fired:
        intent = "clarify"

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
    if clarify_fired:
        status = "needs_clarification"
        # success is intentionally False here: the pipeline did not fulfil the
        # user's request; it is paused pending additional user input.
    elif is_empty:
        status = "empty"
    else:
        status = "ok"
    result.final_output = {
        "success": bool(all_step_results and all_step_results[-1].success),
        "status": status,
        "message": final_message,
    }
    if intent in ("search_bangumi", "search_nearby"):
        result.final_output["results"] = last_data
    elif intent in ("plan_route", "plan_selected"):
        result.final_output["route"] = last_data
    else:
        result.final_output.update(last_data)

    return result
