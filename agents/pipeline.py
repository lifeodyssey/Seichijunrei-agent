"""Pipeline — top-level entry point wiring Intent → Plan → Execute.

Usage:
    from agents.pipeline import run_pipeline

    result = await run_pipeline("秒速5厘米的取景地在哪", db_client)
"""

from __future__ import annotations

from typing import Any

import structlog

from agents.executor_agent import ExecutorAgent, PipelineResult
from agents.intent_agent import classify_intent
from agents.planner_agent import create_plan

logger = structlog.get_logger(__name__)


async def run_pipeline(
    text: str,
    db: Any,
    *,
    model: Any = None,
    locale: str = "ja",
) -> PipelineResult:
    """Run the full agent pipeline: classify → plan → execute.

    Args:
        text: User input text.
        db: SupabaseClient instance (or mock with .pool.fetch).
        model: Optional LLM model for intent classification fallback.

    Returns:
        PipelineResult with all step results and final output.
    """
    # Step 1: Classify intent
    intent = await classify_intent(text, model=model)
    logger.info(
        "intent_classified",
        intent=intent.intent,
        confidence=intent.confidence,
    )

    # Step 2: Create execution plan
    plan = create_plan(intent)
    logger.info(
        "plan_created",
        intent=plan.intent,
        steps=[s.step_type.value for s in plan.steps],
    )

    # Step 3: Execute plan
    executor = ExecutorAgent(db)
    result = await executor.execute(plan)
    logger.info(
        "pipeline_complete",
        intent=result.intent,
        success=result.success,
        steps_executed=len(result.step_results),
    )

    return result
