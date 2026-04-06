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

from backend.agents.models import (
    ExecutionPlan,
    Observation,
    PlanStep,
    RetrievalRequest,
    ToolName,
)
from backend.agents.retriever import RetrievalResult, Retriever
from backend.agents.route_export import build_google_maps_url, build_ics_calendar
from backend.agents.route_optimizer import (
    build_timed_itinerary,
    cluster_by_location,
    validate_coordinates,
)
from backend.agents.sql_agent import resolve_location
from backend.infrastructure.gateways.bangumi import BangumiClientGateway
from backend.infrastructure.supabase.client import SupabaseClient

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
    ("plan_selected", "ja"): "{count}件の選択スポットでルートを作成しました。",
    ("plan_selected", "zh"): "已为{count}处选定取景地规划路线。",
    ("plan_selected", "en"): "Created a route with {count} selected stops.",
    ("answer_question", "ja"): "",
    ("answer_question", "zh"): "",
    ("answer_question", "en"): "",
    ("empty", "ja"): "該当する巡礼地が見つかりませんでした。",
    ("empty", "zh"): "没有找到相关的巡礼地。",
    ("empty", "en"): "No pilgrimage spots found.",
    ("unclear", "ja"): "もう少し具体的に教えていただけますか？",
    ("unclear", "zh"): "能再具体一些吗？",
    ("unclear", "en"): "Could you be more specific?",
    ("clarify", "ja"): "",
    ("clarify", "zh"): "",
    ("clarify", "en"): "",
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


# ── Executor ──────────────────────────────────────────────────────────────────


class ExecutorAgent:
    """Executes ExecutionPlan steps deterministically.

    No LLM calls inside this class. Steps communicate via a shared context dict.
    """

    def __init__(self, db: object) -> None:
        self._retriever = Retriever(db)
        self._db = db

    async def execute(
        self,
        plan: ExecutionPlan,
        context_block: Mapping[str, object] | None = None,
        on_step: Callable[[str, str, dict[str, object]], Awaitable[None]] | None = None,
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
        context: dict[str, object] = {"locale": locale}
        if context_block and context_block.get("last_location"):
            context["last_location"] = context_block["last_location"]

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

    @staticmethod
    def format_observation(step_result: StepResult) -> Observation:
        """Convert a StepResult into an Observation for the planner.

        The planner needs a 1-2 sentence summary, not raw data.
        """
        tool = step_result.tool
        success = step_result.success
        data = step_result.data if isinstance(step_result.data, dict) else {}
        data_keys = list(data.keys()) if isinstance(data, dict) else []

        if not success:
            summary = f"Failed: {step_result.error or 'unknown error'}"
            return Observation(
                tool=tool, success=False, summary=summary, data_keys=data_keys
            )

        # Tool-specific summaries
        if tool == "resolve_anime":
            bangumi_id = data.get("bangumi_id", "unknown")
            title = data.get("title", "")
            summary = f"Resolved to bangumi_id={bangumi_id}"
            if title:
                summary += f" ({title})"

        elif tool in ("search_bangumi", "search_nearby"):
            count = data.get("row_count", len(data.get("rows", [])))
            status = data.get("status", "ok")
            summary = f"Found {count} spots (status: {status})"

        elif tool in ("plan_route", "plan_selected"):
            point_count = data.get("point_count", 0)
            itinerary = data.get("timed_itinerary")
            if isinstance(itinerary, dict):
                minutes = itinerary.get("total_minutes", 0)
                summary = f"Route planned: {point_count} stops, ~{minutes}min"
            else:
                summary = f"Route planned: {point_count} stops"

        elif tool == "clarify":
            question = data.get("question", "")
            summary = f"Asked user: {question[:80]}"

        elif tool in ("greet_user", "answer_question"):
            summary = "Response generated"

        else:
            summary = f"Completed with keys: {', '.join(data_keys[:5])}"

        return Observation(
            tool=tool, success=success, summary=summary, data_keys=data_keys
        )

    async def _execute_step(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        tool: ToolName | None = getattr(step, "tool", None)
        tool_name = (
            tool.value
            if tool is not None
            else str(getattr(step, "step_type", "unknown"))
        )
        if not isinstance(tool, ToolName):
            handler = None
        else:
            handler = {
                ToolName.RESOLVE_ANIME: self._execute_resolve_anime,
                ToolName.SEARCH_BANGUMI: self._execute_search_bangumi,
                ToolName.SEARCH_NEARBY: self._execute_search_nearby,
                ToolName.PLAN_ROUTE: self._execute_plan_route,
                ToolName.PLAN_SELECTED: self._execute_plan_selected,
                ToolName.GREET_USER: self._execute_greet_user,
                ToolName.ANSWER_QUESTION: self._execute_answer_question,
                ToolName.CLARIFY: self._execute_clarify,
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
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Resolve anime title → bangumi_id. DB first, API on miss (write-through)."""
        params = step.params or {}
        title = params.get("title")
        if not isinstance(title, str):
            title = ""
        if not title:
            return StepResult(
                tool="resolve_anime", success=False, error="No title provided"
            )

        # 1. DB lookup
        db = cast(SupabaseClient, self._db)
        bangumi_id = await db.find_bangumi_by_title(title)
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
            await db.upsert_bangumi_title(title, bangumi_id)
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
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Search pilgrimage points for a specific bangumi."""
        params = step.params or {}
        bangumi_id = params.get("bangumi_id")
        if not isinstance(bangumi_id, str) or not bangumi_id:
            resolved = context.get(ToolName.RESOLVE_ANIME.value)
            if isinstance(resolved, dict):
                resolved_id = resolved.get("bangumi_id")
                if isinstance(resolved_id, str) and resolved_id:
                    bangumi_id = resolved_id
        if not isinstance(bangumi_id, str) or not bangumi_id:
            return StepResult(
                tool="search_bangumi", success=False, error="No bangumi_id available"
            )

        episode = params.get("episode")
        episode_value = episode if isinstance(episode, int) else None
        origin = params.get("origin")
        origin_value = origin if isinstance(origin, str) else None
        req = RetrievalRequest(
            tool="search_bangumi",
            bangumi_id=bangumi_id,
            episode=episode_value,
            origin=origin_value,
            force_refresh=bool(params.get("force_refresh", False)),
        )
        retrieval = await self._retriever.execute(req)
        return StepResult(
            tool="search_bangumi",
            success=retrieval.success,
            data=_build_query_payload(retrieval),
            error=retrieval.error,
        )

    async def _execute_search_nearby(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Search pilgrimage points near a location."""
        params = step.params or {}
        location = params.get("location")
        if not isinstance(location, str):
            location = ""
        req = RetrievalRequest(
            tool="search_nearby",
            location=location,
            radius=params.get("radius"),
        )
        retrieval = await self._retriever.execute(req)
        return StepResult(
            tool="search_nearby",
            success=retrieval.success,
            data=_build_query_payload(retrieval),
            error=retrieval.error,
        )

    async def _optimize_route(
        self,
        rows: list[dict[str, object]],
        params: dict[str, object],
        origin: str | None,
    ) -> StepResult:
        """Shared route optimization logic for plan_route and plan_selected."""
        # 1. Validate coordinates
        valid_rows, _invalid = validate_coordinates(rows)
        if not valid_rows:
            return StepResult(
                tool="plan_route", success=False, error="No valid coordinates"
            )

        # 2. Cluster by location
        clusters = cluster_by_location(valid_rows, threshold_m=50.0)

        # 3. Read pacing/start_time from params (wizard re-optimization) or defaults
        pacing_raw = params.get("pacing")
        pacing = (
            pacing_raw
            if isinstance(pacing_raw, str)
            and pacing_raw in ("chill", "normal", "packed")
            else "normal"
        )
        start_raw = params.get("start_time")
        start_time = start_raw if isinstance(start_raw, str) else "09:00"

        # 4. Build timed itinerary (includes nearest-neighbor sort internally)
        try:
            itinerary = build_timed_itinerary(
                clusters, start_time=start_time, pacing=pacing
            )
        except ValueError as e:
            return StepResult(tool="plan_route", success=False, error=str(e))

        # 5. Build exports
        gmaps_url = build_google_maps_url(itinerary.stops)
        ics = build_ics_calendar(itinerary)
        itinerary.export_google_maps_url = gmaps_url
        itinerary.export_ics = ics

        # 6. Build backward-compat ordered_points (flat list from all cluster points)
        ordered_points: list[dict[str, object]] = []
        for stop in itinerary.stops:
            ordered_points.extend(stop.points)
        _rewrite_image_urls(ordered_points)

        with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]

        return StepResult(
            tool="plan_route",
            success=True,
            data={
                "ordered_points": ordered_points,
                "timed_itinerary": itinerary.model_dump(mode="json"),
                "point_count": len(ordered_points),
                "status": "ok",
                "summary": {
                    "point_count": len(ordered_points),
                    "with_coordinates": len(with_coords),
                    "without_coordinates": len(rows) - len(with_coords),
                    "clusters": len(clusters),
                    "total_minutes": itinerary.total_minutes,
                    "total_distance_m": itinerary.total_distance_m,
                },
            },
        )

    async def _execute_plan_route(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Sort search results into an optimised walking route."""
        query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
            ToolName.SEARCH_NEARBY.value
        )
        query_payload = query_data if isinstance(query_data, dict) else {}
        rows = query_payload.get("rows", [])
        if not rows:
            return StepResult(
                tool="plan_route", success=False, error="No points to route"
            )

        params = step.params or {}
        origin_raw = params.get("origin") or context.get("last_location")
        origin = origin_raw if isinstance(origin_raw, str) else None

        # Resolve origin for geocoding clarification before optimizing
        if origin:
            resolved = await resolve_location(origin)
            if isinstance(resolved, list):
                return StepResult(
                    tool="clarify",
                    success=True,
                    data={
                        "question": f"「{origin}」に複数の候補があります。どちらですか？",
                        "options": [c.label for c in resolved],
                        "status": "needs_clarification",
                    },
                )

        return await self._optimize_route(rows, params, origin)

    async def _execute_plan_selected(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Route a user-selected list of point IDs."""
        params = step.params or {}
        raw_point_ids = params.get("point_ids")
        if not isinstance(raw_point_ids, list):
            raw_point_ids = []
        point_ids = [
            str(point_id).strip() for point_id in raw_point_ids if str(point_id).strip()
        ]
        if not point_ids:
            return StepResult(
                tool="plan_selected",
                success=False,
                error="point_ids is required",
            )

        get_points_by_ids = getattr(self._db, "get_points_by_ids", None)
        if get_points_by_ids is None:
            return StepResult(
                tool="plan_selected",
                success=False,
                error="get_points_by_ids not available",
            )

        rows: list[dict[str, object]] = [
            dict(row) for row in await get_points_by_ids(point_ids)
        ]
        origin_raw = params.get("origin") or context.get("last_location")
        origin = origin_raw if isinstance(origin_raw, str) else None
        result = await self._optimize_route(rows, params, origin)
        # Override tool name to plan_selected for output builder
        result.tool = "plan_selected"
        return result

    async def _execute_answer_question(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Return a plain QA answer (no retrieval)."""
        params = step.params or {}
        return StepResult(
            tool="answer_question",
            success=True,
            data={
                "message": params.get("answer", ""),
                "status": "info",
            },
        )

    async def _execute_clarify(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Return a clarification question to the user (no retrieval)."""
        params = step.params or {}
        question = params.get("question")
        if not isinstance(question, str):
            question = ""
        raw_options = params.get("options")
        options: list[str] = (
            [str(o) for o in raw_options if isinstance(o, str)]
            if isinstance(raw_options, list)
            else []
        )
        return StepResult(
            tool="clarify",
            success=True,
            data={
                "question": question,
                "options": options,
                "status": "needs_clarification",
            },
        )

    async def _execute_greet_user(
        self, step: PlanStep, context: dict[str, object]
    ) -> StepResult:
        """Return an ephemeral greeting/identity response (no retrieval)."""
        params = step.params or {}
        return StepResult(
            tool="greet_user",
            success=True,
            data={
                "message": params.get("message", ""),
                "status": "info",
            },
        )

    # ── Output builder ────────────────────────────────────────────────────────

    def _build_output(
        self, result: PipelineResult, context: Mapping[str, object], primary_tool: str
    ) -> dict[str, object]:
        locale_raw = context.get("locale", "ja")
        locale = locale_raw if isinstance(locale_raw, str) else "ja"
        query_data = context.get(ToolName.SEARCH_BANGUMI.value) or context.get(
            ToolName.SEARCH_NEARBY.value
        )
        route_data = context.get(ToolName.PLAN_ROUTE.value) or context.get(
            ToolName.PLAN_SELECTED.value
        )
        qa_data = context.get(ToolName.ANSWER_QUESTION.value)
        greet_data = context.get(ToolName.GREET_USER.value)
        clarify_data = context.get(ToolName.CLARIFY.value)

        query_payload = query_data if isinstance(query_data, dict) else {}
        route_payload = route_data if isinstance(route_data, dict) else {}
        qa_payload = qa_data if isinstance(qa_data, dict) else {}
        greet_payload = greet_data if isinstance(greet_data, dict) else {}
        clarify_payload = clarify_data if isinstance(clarify_data, dict) else {}

        count = int(query_payload.get("row_count", 0) or 0)
        if count == 0 and route_payload:
            count = int(route_payload.get("point_count", 0) or 0)
        is_empty = count == 0
        status = "empty" if is_empty else "ok"
        if not result.success:
            status = "error"

        message = _build_message(primary_tool, count, locale)

        output: dict[str, object] = {
            "intent": primary_tool,
            "success": result.success,
            "status": status,
            "message": message,
        }
        if query_data:
            output["results"] = query_data
        if route_data:
            output["route"] = route_data
        if qa_payload:
            output["message"] = qa_payload.get("message", "")
            output["status"] = qa_payload.get("status", "info")
        if greet_payload:
            output["message"] = greet_payload.get("message", "")
            output["status"] = greet_payload.get("status", "info")
        if clarify_payload:
            output["intent"] = "clarify"
            output["message"] = clarify_payload.get("question", "")
            output["status"] = "needs_clarification"
            output["options"] = clarify_payload.get("options", [])
        if not result.success:
            output["errors"] = [r.error for r in result.step_results if r.error]
        return output


# ── Helpers ───────────────────────────────────────────────────────────────────


def _infer_primary_tool(plan: ExecutionPlan) -> str:
    """Return the primary tool name for intent labelling and message selection."""
    raw_tools = [getattr(s, "tool", None) for s in plan.steps]
    tools_filtered: list[ToolName] = [t for t in raw_tools if isinstance(t, ToolName)]
    for priority in (
        ToolName.CLARIFY,
        ToolName.PLAN_ROUTE,
        ToolName.PLAN_SELECTED,
        ToolName.SEARCH_BANGUMI,
        ToolName.SEARCH_NEARBY,
        ToolName.ANSWER_QUESTION,
        ToolName.GREET_USER,
    ):
        if priority in tools_filtered:
            return str(priority.value)
    return str(tools_filtered[0].value) if tools_filtered else "unknown"


def _rewrite_image_urls(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Rewrite Anitabi image URLs to go through our CF proxy."""
    for row in rows:
        url = row.get("screenshot_url")
        if not isinstance(url, str) or not url:
            continue
        if "image.anitabi.cn/" in url:
            row["screenshot_url"] = url.replace("https://image.anitabi.cn/", "/img/")
        elif url.startswith("screenshot/"):
            row["screenshot_url"] = f"/img/{url}"
    return rows


def _build_query_payload(retrieval: RetrievalResult) -> dict[str, object]:
    metadata = dict(retrieval.metadata)
    empty = retrieval.row_count == 0
    rows = _rewrite_image_urls(retrieval.rows)
    return {
        "rows": rows,
        "items": rows,
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
