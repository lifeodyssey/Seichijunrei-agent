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
from agents.retriever import RetrievalResult, Retriever

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
        self._retriever = Retriever(db)

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

        for index, step in enumerate(plan.steps):
            step_result = await self._execute_step(step, intent, context)
            result.step_results.append(step_result)

            if not step_result.success:
                context["failure"] = {
                    "step_type": step.step_type.value,
                    "error": step_result.error,
                }
                logger.warning(
                    "step_failed",
                    step=step.step_type,
                    error=step_result.error,
                )

                if step.step_type != StepType.FORMAT_RESPONSE:
                    format_step = _find_follow_up_format_step(plan.steps[index + 1 :])
                    if format_step is not None:
                        format_result = await self._execute_step(
                            format_step, intent, context
                        )
                        result.step_results.append(format_result)
                        if format_result.success:
                            context[format_step.step_type.value] = format_result.data
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
        """Execute retrieval through the strategy layer."""
        retrieval_result: RetrievalResult = await self._retriever.execute(intent)
        query_payload = _build_query_payload(retrieval_result)
        return StepResult(
            step_type=step.step_type.value,
            success=retrieval_result.success,
            data=query_payload,
            error=retrieval_result.error,
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
        rows_with_coordinates = [
            row for row in rows if row.get("latitude") and row.get("longitude")
        ]
        return StepResult(
            step_type=step.step_type.value,
            success=True,
            data={
                "ordered_points": ordered,
                "point_count": len(ordered),
                "status": "ok",
                "summary": {
                    "point_count": len(ordered),
                    "with_coordinates": len(rows_with_coordinates),
                    "without_coordinates": len(rows) - len(rows_with_coordinates),
                },
            },
        )

    async def _execute_format_response(
        self,
        step: ExecutionStep,
        intent: IntentOutput,
        context: dict[str, Any],
    ) -> StepResult:
        """Format the final response from accumulated context."""
        failure = context.get("failure")
        query_data = context.get("query_db")
        route_data = context.get("plan_route")

        formatted = {
            "intent": intent.intent,
            "confidence": intent.confidence,
            "status": _derive_response_status(intent, query_data, route_data, failure),
        }

        # Include DB results if available
        if query_data is not None:
            formatted["results"] = query_data

        # Include route if available
        if route_data is not None:
            formatted["route"] = route_data

        notices = _build_response_notices(query_data)
        if notices:
            formatted["notices"] = notices

        message = _build_response_message(intent, query_data, route_data, failure)
        if message:
            formatted["message"] = message

        if failure:
            formatted["failure"] = failure

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

        data = output.get("data")
        if isinstance(data, dict):
            if "status" in data:
                output["status"] = data["status"]
            if "message" in data:
                output["message"] = data["message"]

        if not result.success:
            errors = [r.error for r in result.step_results if r.error]
            output["errors"] = errors

        return output


def _build_query_payload(retrieval_result: RetrievalResult) -> dict[str, Any]:
    metadata = dict(retrieval_result.metadata)
    empty = retrieval_result.row_count == 0
    return {
        "rows": retrieval_result.rows,
        "items": retrieval_result.rows,
        "row_count": retrieval_result.row_count,
        "strategy": retrieval_result.strategy.value,
        "metadata": metadata,
        "status": "empty" if empty else "ok",
        "empty": empty,
        "summary": {
            "count": retrieval_result.row_count,
            "strategy": retrieval_result.strategy.value,
            "source": metadata.get("data_origin", metadata.get("source", "db")),
            "cache": metadata.get("cache", "miss"),
        },
    }


def _find_follow_up_format_step(
    steps: list[ExecutionStep],
) -> ExecutionStep | None:
    for step in steps:
        if step.step_type == StepType.FORMAT_RESPONSE:
            return step
    return None


def _derive_response_status(
    intent: IntentOutput,
    query_data: dict[str, Any] | None,
    route_data: dict[str, Any] | None,
    failure: dict[str, Any] | None,
) -> str:
    if intent.intent == "unclear":
        return "needs_clarification"
    if intent.intent == "general_qa":
        return "info"
    if failure:
        if query_data and query_data.get("empty"):
            return "empty"
        if route_data or query_data:
            return "partial"
        return "error"
    if query_data and query_data.get("empty"):
        return "empty"
    return "ok"


def _build_response_message(
    intent: IntentOutput,
    query_data: dict[str, Any] | None,
    route_data: dict[str, Any] | None,
    failure: dict[str, Any] | None,
) -> str:
    if intent.intent == "unclear":
        return "Could you be more specific about what you're looking for?"
    if intent.intent == "general_qa":
        return "This is a general question about anime pilgrimage."
    if failure:
        if failure.get("step_type") == StepType.QUERY_DB.value:
            return "I couldn't retrieve pilgrimage data right now."
        if failure.get("step_type") == StepType.PLAN_ROUTE.value:
            if query_data and query_data.get("empty"):
                return "No pilgrimage points were available to build a route."
            return "I found pilgrimage points, but couldn't turn them into a route."
    if query_data and query_data.get("empty"):
        messages = {
            "search_by_bangumi": "No pilgrimage points were found for that bangumi.",
            "search_by_location": "No pilgrimage points were found near that location.",
            "plan_route": "No pilgrimage points were available to build a route.",
        }
        return messages.get(intent.intent, "No pilgrimage points were found.")
    if intent.intent == "plan_route" and route_data is not None:
        point_count = route_data.get("point_count", 0)
        return f"Built a route across {point_count} pilgrimage points."
    return ""


def _build_response_notices(query_data: dict[str, Any] | None) -> list[str]:
    if query_data is None:
        return []

    metadata = query_data.get("metadata", {})
    notices: list[str] = []

    if metadata.get("cache") == "hit":
        notices.append("Served from retrieval cache.")
    elif metadata.get("cache") == "write":
        notices.append("Stored this retrieval result in cache for reuse.")

    if metadata.get("data_origin") == "fallback":
        notices.append(
            "Fetched fresh pilgrimage points from Anitabi and wrote them through to Supabase."
        )

    if metadata.get("mode") == "sql_fallback" and metadata.get("geo_error"):
        notices.append("Used SQL-only results because geo refinement was unavailable.")

    return notices


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
