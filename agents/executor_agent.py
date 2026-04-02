"""ExecutorAgent — deterministic plan step execution.

Accepts an ExecutionPlan from ReActPlannerAgent and executes each step using
the appropriate handler. No LLM calls — all responses use static message
templates. Steps communicate via context dict (each step deposits its output).
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import structlog

from agents.models import ExecutionPlan, PlanStep, RetrievalRequest, ToolName
from agents.retriever import RetrievalResult, Retriever
from infrastructure.gateways.bangumi import BangumiClientGateway

logger = structlog.get_logger(__name__)


# ── Static response message templates ────────────────────────────────────────
# Keyed by (primary_tool, locale). These replace the LLM message call,
# saving one LLM round-trip per request.

_MESSAGES: dict[tuple[str, str], str] = {
    ("search_bangumi", "ja"): "{count}件の聖地が見つかりました。",
    ("search_bangumi", "zh"): "找到了{count}处圣地。",
    ("search_bangumi", "en"): "Found {count} pilgrimage spots.",
    ("search_nearby", "ja"): "この周辺に{count}件の聖地があります。",
    ("search_nearby", "zh"): "附近有{count}处圣地。",
    ("search_nearby", "en"): "Found {count} pilgrimage spots nearby.",
    ("plan_route", "ja"): "{count}件のスポットで最適ルートを作成しました。",
    ("plan_route", "zh"): "已为{count}处圣地规划路线。",
    ("plan_route", "en"): "Created a route with {count} pilgrimage stops.",
    ("answer_question", "ja"): "",
    ("answer_question", "zh"): "",
    ("answer_question", "en"): "",
    ("empty", "ja"): "該当する巡礼地が見つかりませんでした。",
    ("empty", "zh"): "没有找到相关的巡礼地。",
    ("empty", "en"): "No pilgrimage spots found.",
    ("unclear", "ja"): "もう少し具体的に教えていただけますか？",
    ("unclear", "zh"): "能再具体一些吗？",
    ("unclear", "en"): "Could you be more specific?",
}


def _build_message(primary_tool: str, count: int, locale: str) -> str:
    """Build a static response message from template."""
    if count == 0:
        return _MESSAGES.get(("empty", locale), "")
    return _MESSAGES.get((primary_tool, locale), "").format(count=count)


# ── Result types ─────────────────────────────────────────────────────────────


@dataclass
class StepResult:
    tool: str
    success: bool
    data: Any = None
    error: str | None = None


@dataclass
class PipelineResult:
    intent: str
    plan: ExecutionPlan
    step_results: list[StepResult] = field(default_factory=list)
    final_output: dict[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return all(r.success for r in self.step_results)


# ── Executor ──────────────────────────────────────────────────────────────────


class ExecutorAgent:
    """Executes ExecutionPlan steps deterministically.

    No LLM calls inside this class. Steps communicate via a shared context dict.
    """

    def __init__(self, db: Any) -> None:
        self._retriever = Retriever(db)
        self._db = db

    async def execute(
        self,
        plan: ExecutionPlan,
        *,
        on_step: Callable[[str, str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> PipelineResult:
        """Execute all steps in the plan and return a PipelineResult.

        Args:
            plan: ExecutionPlan from ReActPlannerAgent (includes locale).

        Returns:
            PipelineResult with step results and final output dict.
        """
        primary_tool = _infer_primary_tool(plan)
        result = PipelineResult(intent=primary_tool, plan=plan)
        locale = getattr(plan, "locale", "ja")
        context: dict[str, Any] = {"locale": locale}

        for step in plan.steps:
            tool_name = getattr(getattr(step, "tool", None), "value", "unknown")
            if on_step is not None:
                await on_step(tool_name, "running", {})

            step_result = await self._execute_step(step, context)
            result.step_results.append(step_result)

            if on_step is not None:
                payload = step_result.data if isinstance(step_result.data, dict) else {}
                await on_step(tool_name, "done", payload)

            tool = getattr(step, "tool", None)
            if not step_result.success:
                logger.warning("step_failed", tool=tool, error=step_result.error)
                break  # abort remaining steps on failure

            if tool is not None:
                context[tool.value] = step_result.data

        result.final_output = self._build_output(result, context, primary_tool)
        return result

    async def _execute_step(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        tool = getattr(step, "tool", None)
        tool_name = (
            tool.value
            if tool is not None
            else str(getattr(step, "step_type", "unknown"))
        )
        handler = {
            ToolName.RESOLVE_ANIME: self._execute_resolve_anime,
            ToolName.SEARCH_BANGUMI: self._execute_search_bangumi,
            ToolName.SEARCH_NEARBY: self._execute_search_nearby,
            ToolName.PLAN_ROUTE: self._execute_plan_route,
            ToolName.ANSWER_QUESTION: self._execute_answer_question,
        }.get(tool)

        if handler is None:
            return StepResult(
                tool=tool_name,
                success=False,
                error=f"No handler for tool: {tool_name}",
            )
        try:
            return await handler(step, context)
        except Exception as exc:
            logger.error("step_execution_error", tool=tool_name, error=str(exc))
            return StepResult(tool=tool_name, success=False, error=str(exc))

    # ── Step handlers ─────────────────────────────────────────────────────────

    async def _execute_resolve_anime(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Resolve anime title → bangumi_id. DB first, API on miss (write-through)."""
        title = step.params.get("title", "")
        if not title:
            return StepResult(
                tool="resolve_anime", success=False, error="No title provided"
            )

        # 1. DB lookup
        bangumi_id = await self._db.find_bangumi_by_title(title)
        if bangumi_id:
            logger.info("resolve_anime_db_hit", title=title, bangumi_id=bangumi_id)
            return StepResult(
                tool="resolve_anime",
                success=True,
                data={"bangumi_id": bangumi_id, "title": title},
            )

        # 2. Bangumi.tv API fallback
        gateway = BangumiClientGateway()
        bangumi_id = await gateway.search_by_title(title)
        if bangumi_id:
            await self._db.upsert_bangumi_title(title, bangumi_id)
            logger.info("resolve_anime_api_hit", title=title, bangumi_id=bangumi_id)
            return StepResult(
                tool="resolve_anime",
                success=True,
                data={"bangumi_id": bangumi_id, "title": title},
            )

        return StepResult(
            tool="resolve_anime",
            success=False,
            error=f"Could not resolve anime: '{title}'",
        )

    async def _execute_search_bangumi(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Search pilgrimage points for a specific bangumi."""
        bangumi_id = step.params.get("bangumi_id")
        if not bangumi_id:
            resolved = context.get(ToolName.RESOLVE_ANIME.value, {})
            bangumi_id = resolved.get("bangumi_id")
        if not bangumi_id:
            return StepResult(
                tool="search_bangumi", success=False, error="No bangumi_id available"
            )

        req = RetrievalRequest(
            tool="search_bangumi",
            bangumi_id=bangumi_id,
            episode=step.params.get("episode"),
            origin=step.params.get("origin"),
            force_refresh=bool(step.params.get("force_refresh", False)),
        )
        retrieval = await self._retriever.execute(req)
        return StepResult(
            tool="search_bangumi",
            success=retrieval.success,
            data=_build_query_payload(retrieval),
            error=retrieval.error,
        )

    async def _execute_search_nearby(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Search pilgrimage points near a location."""
        location = step.params.get("location", "")
        req = RetrievalRequest(
            tool="search_nearby",
            location=location,
            radius=step.params.get("radius"),
        )
        retrieval = await self._retriever.execute(req)
        return StepResult(
            tool="search_nearby",
            success=retrieval.success,
            data=_build_query_payload(retrieval),
            error=retrieval.error,
        )

    async def _execute_plan_route(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Sort search results into an optimised walking route."""
        query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
            ToolName.SEARCH_NEARBY.value
        )
        rows = (query_data or {}).get("rows", [])
        if not rows:
            return StepResult(
                tool="plan_route", success=False, error="No points to route"
            )

        ordered = _nearest_neighbor_sort(rows)
        with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]
        return StepResult(
            tool="plan_route",
            success=True,
            data={
                "ordered_points": ordered,
                "point_count": len(ordered),
                "status": "ok",
                "summary": {
                    "point_count": len(ordered),
                    "with_coordinates": len(with_coords),
                    "without_coordinates": len(rows) - len(with_coords),
                },
            },
        )

    async def _execute_answer_question(
        self, step: PlanStep, context: dict[str, Any]
    ) -> StepResult:
        """Return a plain QA answer (no retrieval)."""
        return StepResult(
            tool="answer_question",
            success=True,
            data={
                "message": step.params.get("answer", ""),
                "status": "info",
            },
        )

    # ── Output builder ────────────────────────────────────────────────────────

    def _build_output(
        self, result: PipelineResult, context: dict[str, Any], primary_tool: str
    ) -> dict[str, Any]:
        locale = context.get("locale", "ja")
        query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
            ToolName.SEARCH_NEARBY.value
        )
        route_data = context.get(ToolName.PLAN_ROUTE.value)
        qa_data = context.get(ToolName.ANSWER_QUESTION.value)

        count = (query_data or {}).get("row_count", 0)
        is_empty = count == 0
        status = "empty" if is_empty else "ok"
        if not result.success:
            status = "error"

        message = _build_message(primary_tool, count, locale)

        output: dict[str, Any] = {
            "intent": primary_tool,
            "success": result.success,
            "status": status,
            "message": message,
        }
        if query_data:
            output["results"] = query_data
        if route_data:
            output["route"] = route_data
        if qa_data:
            output["message"] = qa_data.get("message", "")
            output["status"] = qa_data.get("status", "info")
        if not result.success:
            output["errors"] = [r.error for r in result.step_results if r.error]
        return output


# ── Helpers ───────────────────────────────────────────────────────────────────


def _infer_primary_tool(plan: ExecutionPlan) -> str:
    """Return the primary tool name for intent labelling and message selection."""
    tools = [getattr(s, "tool", None) for s in plan.steps]
    tools = [t for t in tools if t is not None]
    for priority in (
        ToolName.PLAN_ROUTE,
        ToolName.SEARCH_BANGUMI,
        ToolName.SEARCH_NEARBY,
        ToolName.ANSWER_QUESTION,
    ):
        if priority in tools:
            return priority.value
    return tools[0].value if tools else "unknown"


def _build_query_payload(retrieval: RetrievalResult) -> dict[str, Any]:
    metadata = dict(retrieval.metadata)
    empty = retrieval.row_count == 0
    return {
        "rows": retrieval.rows,
        "items": retrieval.rows,
        "row_count": retrieval.row_count,
        "strategy": retrieval.strategy.value,
        "metadata": metadata,
        "status": "empty" if empty else "ok",
        "empty": empty,
        "summary": {
            "count": retrieval.row_count,
            "source": metadata.get("data_origin", metadata.get("source", "db")),
            "cache": metadata.get("cache", "miss"),
        },
    }


def _nearest_neighbor_sort(rows: list[dict]) -> list[dict]:
    """Sort points by nearest-neighbor heuristic. O(n²), fine for <100 points."""
    if len(rows) <= 1:
        return list(rows)
    with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]
    without_coords = [r for r in rows if not (r.get("latitude") and r.get("longitude"))]
    if not with_coords:
        return list(rows)

    ordered = [with_coords[0]]
    remaining = with_coords[1:]
    while remaining:
        last = ordered[-1]
        last_lat, last_lon = float(last["latitude"]), float(last["longitude"])
        best_idx, best_dist = 0, float("inf")
        for i, c in enumerate(remaining):
            d = (float(c["latitude"]) - last_lat) ** 2 + (
                float(c["longitude"]) - last_lon
            ) ** 2
            if d < best_dist:
                best_dist, best_idx = d, i
        ordered.append(remaining.pop(best_idx))

    return ordered + without_coords
