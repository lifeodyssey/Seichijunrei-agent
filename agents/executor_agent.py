"""ExecutorAgent — runs ExecutionPlan steps sequentially.

Takes an ExecutionPlan and executes each step using the appropriate
handler (SQLAgent for DB queries, nearest-neighbor for route planning).

Usage:
    from agents.executor_agent import ExecutorAgent

    executor = ExecutorAgent(db_client)
    result = await executor.execute(plan, intent)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import structlog

from agents.intent_agent import IntentOutput
from agents.planner_agent import ExecutionPlan, ExecutionStep, StepType
from agents.sql_agent import SQLAgent, SQLResult

logger = structlog.get_logger(__name__)


@dataclass
class StepResult:
    """Result of executing a single plan step."""

    step_type: str
    success: bool
    data: Any = None
    error: str | None = None


@dataclass
class PipelineResult:
    """Aggregated result of executing a full plan."""

    intent: str
    plan: ExecutionPlan
    step_results: list[StepResult] = field(default_factory=list)
    final_output: dict[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return all(r.success for r in self.step_results)


class ExecutorAgent:
    """Executes plan steps sequentially, passing data between steps."""

    def __init__(self, db: Any) -> None:
        self._sql_agent = SQLAgent(db)

    async def execute(
        self, plan: ExecutionPlan, intent: IntentOutput
    ) -> PipelineResult:
        """Execute all steps in the plan.

        Args:
            plan: The execution plan from PlannerAgent.
            intent: The original IntentOutput (for parameter access).

        Returns:
            PipelineResult with all step results and final output.
        """
        result = PipelineResult(intent=plan.intent, plan=plan)
        context: dict[str, Any] = {"intent": intent}

        for step in plan.steps:
            step_result = await self._execute_step(step, intent, context)
            result.step_results.append(step_result)

            if not step_result.success:
                logger.warning(
                    "step_failed",
                    step=step.step_type,
                    error=step_result.error,
                )
                break

            # Pass step output to next step via context
            context[step.step_type.value] = step_result.data

        # Build final output from context
        result.final_output = self._build_output(result, context)
        return result

    async def _execute_step(
        self,
        step: ExecutionStep,
        intent: IntentOutput,
        context: dict[str, Any],
    ) -> StepResult:
        """Dispatch a single step to its handler."""
        handler = {
            StepType.QUERY_DB: self._execute_query_db,
            StepType.PLAN_ROUTE: self._execute_plan_route,
            StepType.FORMAT_RESPONSE: self._execute_format_response,
        }.get(step.step_type)

        if handler is None:
            return StepResult(
                step_type=step.step_type.value,
                success=False,
                error=f"No handler for step type: {step.step_type}",
            )

        try:
            return await handler(step, intent, context)
        except Exception as exc:
            logger.error(
                "step_execution_error",
                step=step.step_type,
                error=str(exc),
            )
            return StepResult(
                step_type=step.step_type.value,
                success=False,
                error=str(exc),
            )

    # ── Step handlers ─────────────────────────────────────────────

    async def _execute_query_db(
        self,
        step: ExecutionStep,
        intent: IntentOutput,
        context: dict[str, Any],
    ) -> StepResult:
        """Execute a database query via SQLAgent."""
        sql_result: SQLResult = await self._sql_agent.execute(intent)
        return StepResult(
            step_type=step.step_type.value,
            success=sql_result.success,
            data={"rows": sql_result.rows, "row_count": sql_result.row_count},
            error=sql_result.error,
        )

    async def _execute_plan_route(
        self,
        step: ExecutionStep,
        intent: IntentOutput,
        context: dict[str, Any],
    ) -> StepResult:
        """Compute route order using nearest-neighbor heuristic."""
        db_data = context.get("query_db", {})
        rows = db_data.get("rows", [])

        if not rows:
            return StepResult(
                step_type=step.step_type.value,
                success=False,
                error="No points available for route planning",
            )

        ordered = _nearest_neighbor_sort(rows)
        return StepResult(
            step_type=step.step_type.value,
            success=True,
            data={"ordered_points": ordered, "point_count": len(ordered)},
        )

    async def _execute_format_response(
        self,
        step: ExecutionStep,
        intent: IntentOutput,
        context: dict[str, Any],
    ) -> StepResult:
        """Format the final response from accumulated context."""
        formatted = {
            "intent": intent.intent,
            "confidence": intent.confidence,
        }

        # Include DB results if available
        if "query_db" in context:
            formatted["results"] = context["query_db"]

        # Include route if available
        if "plan_route" in context:
            formatted["route"] = context["plan_route"]

        # Intent-specific messages
        if intent.intent == "unclear":
            formatted["message"] = "Could you be more specific about what you're looking for?"
        elif intent.intent == "general_qa":
            formatted["message"] = "This is a general question about anime pilgrimage."

        return StepResult(
            step_type=step.step_type.value,
            success=True,
            data=formatted,
        )

    def _build_output(
        self, result: PipelineResult, context: dict[str, Any]
    ) -> dict[str, Any]:
        """Build the final output dict from pipeline results."""
        output: dict[str, Any] = {"intent": result.intent, "success": result.success}

        # Use the last successful step's data as the primary output
        for sr in reversed(result.step_results):
            if sr.success and sr.data:
                output["data"] = sr.data
                break

        if not result.success:
            errors = [r.error for r in result.step_results if r.error]
            output["errors"] = errors

        return output


# ── Route optimization ────────────────────────────────────────────


def _nearest_neighbor_sort(rows: list[dict]) -> list[dict]:
    """Sort points by nearest-neighbor heuristic.

    Simple greedy algorithm: start from the first point, always visit
    the nearest unvisited point next. O(n^2) but fine for <100 points.
    """
    if len(rows) <= 1:
        return list(rows)

    # Filter rows that have coordinates
    with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]
    without_coords = [r for r in rows if not (r.get("latitude") and r.get("longitude"))]

    if not with_coords:
        return list(rows)

    ordered = [with_coords[0]]
    remaining = with_coords[1:]

    while remaining:
        last = ordered[-1]
        last_lat, last_lon = float(last["latitude"]), float(last["longitude"])

        best_idx = 0
        best_dist = float("inf")
        for i, candidate in enumerate(remaining):
            dlat = float(candidate["latitude"]) - last_lat
            dlon = float(candidate["longitude"]) - last_lon
            dist_sq = dlat * dlat + dlon * dlon
            if dist_sq < best_dist:
                best_dist = dist_sq
                best_idx = i

        ordered.append(remaining.pop(best_idx))

    return ordered + without_coords
