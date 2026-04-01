"""Pipeline — top-level entry point: plan → execute."""

from __future__ import annotations

from typing import Any

import structlog

from agents.executor_agent import ExecutorAgent, PipelineResult
from agents.planner_agent import ReActPlannerAgent

logger = structlog.get_logger(__name__)


async def run_pipeline(
    text: str,
    db: Any,
    *,
    model: Any = None,
    locale: str = "ja",
) -> PipelineResult:
    """Run the full agent pipeline: plan → execute."""
    plan = await ReActPlannerAgent(model).create_plan(text, locale=locale)
    logger.info(
        "plan_created",
        steps=[s.tool.value for s in plan.steps],
        reasoning=plan.reasoning[:120],
    )
    result = await ExecutorAgent(db).execute(plan)
    logger.info(
        "pipeline_complete",
        intent=result.intent,
        success=result.success,
        steps_executed=len(result.step_results),
    )
    return result
