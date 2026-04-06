"""Thin public API surface over the runtime pipeline.

This module provides a stable request/response contract that future HTTP or
RPC adapters can wrap without depending directly on internal pipeline types.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from time import perf_counter
from typing import Literal
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field, model_validator
from pydantic_ai.models import Model

from backend.agents.base import create_agent, get_default_model
from backend.agents.executor_agent import ExecutorAgent, PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.agents.pipeline import run_pipeline
from backend.application.errors import ApplicationError, ErrorCode
from backend.infrastructure.observability import (
    get_runtime_tracer,
    record_runtime_request,
)
from backend.infrastructure.session import SessionStore, create_session_store

logger = structlog.get_logger(__name__)

_COMPACT_THRESHOLD = 8
_COMPACT_KEEP_RECENT = 2
_MAX_INTERACTIONS = 20
_MAX_ROUTE_HISTORY = 10


class PublicAPIRequest(BaseModel):
    """Public request contract for runtime execution."""

    text: str = Field(default="", description="User message to process")
    session_id: str | None = Field(
        default=None,
        description="Optional session identifier for persisting conversation state",
    )
    model: str | None = Field(
        default=None,
        description="Optional override for the runtime model used by the pipeline",
    )
    locale: Literal["ja", "zh", "en"] = Field(
        default="ja",
        description="Response locale: ja (Japanese), zh (Chinese), or en (English)",
    )
    include_debug: bool = Field(
        default=False,
        description="Include plan and step-level details in the response",
    )
    selected_point_ids: list[str] | None = Field(
        default=None,
        description="Optional point IDs to route directly without planner execution.",
    )
    origin: str | None = Field(
        default=None,
        description="Optional departure location for selected-point routing.",
    )

    @model_validator(mode="after")
    def validate_request(self) -> PublicAPIRequest:
        self.text = self.text.strip()
        if self.origin is not None:
            self.origin = self.origin.strip() or None
        if self.selected_point_ids is not None:
            cleaned_ids = [
                point_id
                for point_id in (
                    str(point_id).strip() for point_id in self.selected_point_ids
                )
                if point_id
            ]
            self.selected_point_ids = cleaned_ids or None
        if not self.text and not self.selected_point_ids:
            raise ValueError(
                "text cannot be blank unless selected_point_ids is provided"
            )
        return self


class PublicAPIError(BaseModel):
    """Stable error payload for public callers."""

    code: str
    message: str
    details: dict[str, object] = Field(default_factory=dict)


class PublicAPIResponse(BaseModel):
    """Public response contract for runtime execution."""

    success: bool
    status: str
    intent: str
    session_id: str | None = None
    message: str = ""
    data: dict[str, object] = Field(default_factory=dict)
    session: dict[str, object] = Field(default_factory=dict)
    route_history: list[dict[str, object]] = Field(default_factory=list)
    errors: list[PublicAPIError] = Field(default_factory=list)
    ui: dict[str, object] | None = Field(
        default=None,
        description="Optional Generative UI descriptor: {component, props}",
    )
    debug: dict[str, object] | None = None


class RuntimeAPI:
    """Thin interface-layer facade over ``run_pipeline``."""

    def __init__(
        self,
        db: object,
        *,
        session_store: SessionStore | None = None,
    ) -> None:
        self._db = db
        self._session_store = session_store or create_session_store()

    async def handle(
        self,
        request: PublicAPIRequest,
        *,
        model: Model | str | None = None,
        user_id: str | None = None,
        on_step: Callable[[str, str, dict[str, object]], Awaitable[None]] | None = None,
    ) -> PublicAPIResponse:
        """Execute the runtime pipeline and normalize its output."""
        session_id = request.session_id or None
        started_at = perf_counter()
        tracer = get_runtime_tracer()
        response: PublicAPIResponse | None = None
        effective_model = model if model is not None else request.model

        with tracer.start_as_current_span("runtime.handle") as span:
            if session_id:
                span.set_attribute("runtime.session_id", session_id)
            span.set_attribute("runtime.include_debug", request.include_debug)
            model_label = _runtime_model_label(effective_model)
            if model_label:
                span.set_attribute("runtime.model", model_label)
            if user_id:
                span.set_attribute("runtime.user_id", user_id)

            result: PipelineResult | None = None
            try:
                previous_state = (
                    await self._load_session_state(session_id)
                    if session_id
                    else _normalize_session_state(None)
                )
                context_delta: dict[str, object] = {}
                user_memory = await self._load_user_memory(user_id)
                context = _build_context_block(previous_state, user_memory=user_memory)
                synthetic_plan = (
                    _build_selected_points_plan(request)
                    if request.selected_point_ids
                    else None
                )

                try:
                    if synthetic_plan is not None:
                        result = await ExecutorAgent(self._db).execute(
                            synthetic_plan,
                            context_block=context,
                            on_step=on_step,
                        )
                    else:
                        result = await run_pipeline(
                            request.text,
                            self._db,
                            model=effective_model,
                            locale=request.locale,
                            context=context,
                            on_step=on_step,
                        )
                except ApplicationError as exc:
                    span.record_exception(exc)
                    response = _application_error_response(exc)
                except Exception as exc:
                    span.record_exception(exc)
                    response = PublicAPIResponse(
                        success=False,
                        status="error",
                        intent="unknown",
                        message="The runtime failed before producing a pipeline result.",
                        errors=[
                            PublicAPIError(
                                code=ErrorCode.INTERNAL_ERROR.value,
                                message=str(exc),
                            )
                        ],
                    )
                else:
                    response = _pipeline_result_to_public_response(
                        result,
                        include_debug=request.include_debug,
                    )
                    context_delta = _extract_context_delta(result)

                if response.intent == "greet_user":
                    response.session_id = None
                    response.session = {}
                    response.route_history = []
                    return response

                if session_id is None:
                    session_id = uuid4().hex
                    span.set_attribute("runtime.session_id", session_id)

                response.session_id = session_id

                session_state = _build_updated_session_state(
                    previous_state,
                    request=request,
                    response=response,
                    context_delta=context_delta,
                )

                route_record = None
                if result is not None:
                    route_record = await self._maybe_persist_route(
                        session_id=session_id,
                        result=result,
                        response=response,
                    )

                if route_record is not None:
                    raw_rh = session_state["route_history"]
                    route_history: list[object] = (
                        list(raw_rh) if isinstance(raw_rh, list) else []
                    )
                    route_history.append(route_record)
                    session_state["route_history"] = route_history[-_MAX_ROUTE_HISTORY:]

                await self._persist_session(session_id, session_state, response)
                await self._persist_user_state(
                    session_id=session_id,
                    user_id=user_id,
                    request=request,
                    response=response,
                    result=result,
                    context_delta=context_delta,
                    previous_state=previous_state,
                )
                await self._persist_messages(
                    session_id=session_id,
                    user_text=request.text,
                    result=result,
                    response=response,
                )
                raw_ints = session_state.get("interactions")
                interaction_count = len(raw_ints) if isinstance(raw_ints, list) else 0
                if interaction_count >= _COMPACT_THRESHOLD:
                    asyncio.create_task(
                        _compact_session_interactions(
                            session_id,
                            session_state,
                            self._session_store,
                        )
                    )

                response.session = _build_session_summary(session_state)
                raw_rh2 = session_state["route_history"]
                response.route_history = (
                    list(raw_rh2) if isinstance(raw_rh2, list) else []
                )
                return response
            except Exception as exc:
                span.record_exception(exc)
                raise
            finally:
                elapsed_ms = (perf_counter() - started_at) * 1000
                intent = response.intent if response is not None else "unknown"
                status = response.status if response is not None else "error"
                success = response.success if response is not None else False
                error_count = len(response.errors) if response is not None else 1

                span.set_attribute("runtime.intent", intent)
                span.set_attribute("runtime.status", status)
                span.set_attribute("runtime.success", success)
                span.set_attribute("runtime.error_count", error_count)

                record_runtime_request(
                    duration_ms=elapsed_ms,
                    intent=intent,
                    status=status,
                    transport="public_api",
                )

                insert_request_log = getattr(self._db, "insert_request_log", None)
                is_ephemeral = response is not None and response.intent == "greet_user"
                if insert_request_log is not None and not is_ephemeral:
                    try:
                        await insert_request_log(
                            session_id=session_id,
                            query_text=request.text,
                            locale=request.locale,
                            plan_steps=_extract_plan_steps(result),
                            intent=intent,
                            status=status,
                            latency_ms=int(elapsed_ms),
                        )
                    except Exception:
                        logger.warning("request_log_failed", session_id=session_id)

    async def _persist_messages(
        self,
        *,
        session_id: str,
        user_text: str,
        result: PipelineResult | None,
        response: PublicAPIResponse,
    ) -> None:
        """Persist user and bot messages to conversation_messages (best-effort)."""
        insert_message = getattr(self._db, "insert_message", None)
        if insert_message is None:
            return

        try:
            await insert_message(session_id, "user", user_text)
        except Exception:
            logger.warning("insert_user_message_failed", session_id=session_id)

        try:
            response_data: dict[str, object] | None = None
            if result is not None:
                response_data = response.model_dump(mode="json")
            await insert_message(
                session_id, "assistant", response.message, response_data
            )
        except Exception:
            logger.warning("insert_bot_message_failed", session_id=session_id)

    async def _load_user_memory(self, user_id: str | None) -> dict[str, object] | None:
        if not user_id:
            return None

        get_user_memory = getattr(self._db, "get_user_memory", None)
        if get_user_memory is None:
            return None

        try:
            result = await get_user_memory(user_id)
            if isinstance(result, dict):
                return result
            return None
        except Exception:
            logger.warning("get_user_memory_failed", user_id=user_id)
            return None

    async def _persist_user_state(
        self,
        *,
        session_id: str,
        user_id: str | None,
        request: PublicAPIRequest,
        response: PublicAPIResponse,
        result: PipelineResult | None,
        context_delta: dict[str, object],
        previous_state: dict[str, object],
    ) -> None:
        if not user_id or result is None or not response.success:
            return

        upsert_conversation = getattr(self._db, "upsert_conversation", None)
        if upsert_conversation is not None:
            try:
                await upsert_conversation(session_id, user_id, request.text)
            except Exception:
                logger.warning("upsert_conversation_failed", session_id=session_id)
            else:
                raw_prev_ints = previous_state.get("interactions")
                is_first_interaction = (
                    len(raw_prev_ints) == 0 if isinstance(raw_prev_ints, list) else True
                )
                if is_first_interaction:
                    asyncio.create_task(
                        _generate_and_save_title(
                            session_id=session_id,
                            first_query=request.text,
                            response_message=response.message,
                            db=self._db,
                            user_id=user_id,
                        )
                    )

        bangumi_id = context_delta.get("bangumi_id")
        if not bangumi_id:
            return

        upsert_user_memory = getattr(self._db, "upsert_user_memory", None)
        if upsert_user_memory is None:
            return

        try:
            await upsert_user_memory(
                user_id,
                bangumi_id=bangumi_id,
                anime_title=context_delta.get("anime_title"),
            )
        except Exception:
            logger.warning("upsert_user_memory_failed", user_id=user_id)

    async def _load_session_state(self, session_id: str) -> dict[str, object]:
        state = await self._session_store.get(session_id)
        return _normalize_session_state(state)

    async def _persist_session(
        self,
        session_id: str,
        session_state: dict[str, object],
        response: PublicAPIResponse,
    ) -> None:
        await self._session_store.set(session_id, session_state)

        upsert_session = getattr(self._db, "upsert_session", None)
        if upsert_session is not None:
            metadata = {
                "intent": response.intent,
                "status": response.status,
                "updated_at": session_state["updated_at"],
            }
            await upsert_session(session_id, session_state, metadata=metadata)

    async def _maybe_persist_route(
        self,
        *,
        session_id: str,
        result: PipelineResult,
        response: PublicAPIResponse,
    ) -> dict[str, object] | None:
        if not response.success or result.intent != "plan_route":
            return None

        route_data = response.data.get("route")
        if not isinstance(route_data, dict):
            return None

        ordered_points = route_data.get("ordered_points")
        if not isinstance(ordered_points, list) or not ordered_points:
            return None

        point_ids = [
            str(point["id"])
            for point in ordered_points
            if isinstance(point, dict) and point.get("id") is not None
        ]
        if not point_ids:
            return None

        plan_params = _get_plan_params(result)
        bangumi_id = plan_params.get("bangumi") or _infer_bangumi_id(
            response.data.get("results")
        )
        if not bangumi_id:
            return None

        route_record = {
            "route_id": None,
            "bangumi_id": bangumi_id,
            "origin_station": plan_params.get("origin"),
            "point_count": len(point_ids),
            "status": response.status,
            "created_at": datetime.now(UTC).isoformat(),
        }

        save_route = getattr(self._db, "save_route", None)
        if save_route is not None:
            route_id = await save_route(
                session_id,
                bangumi_id,
                point_ids,
                {
                    "message": response.message,
                    "results": response.data.get("results"),
                    "route": route_data,
                },
                origin_station=plan_params.get("origin"),
            )
            route_record["route_id"] = route_id

        return route_record


async def handle_public_request(
    request: PublicAPIRequest,
    db: object,
    *,
    model: Model | str | None = None,
    session_store: SessionStore | None = None,
    user_id: str | None = None,
    on_step: Callable[[str, str, dict[str, object]], Awaitable[None]] | None = None,
) -> PublicAPIResponse:
    """Convenience helper for one-off public API execution."""
    api = RuntimeAPI(db, session_store=session_store)
    return await api.handle(request, model=model, user_id=user_id, on_step=on_step)


_UI_MAP: dict[str, str] = {
    "search_bangumi": "PilgrimageGrid",
    "search_nearby": "NearbyMap",
    "plan_route": "RoutePlannerWizard",
    "plan_selected": "RoutePlannerWizard",
    "general_qa": "GeneralAnswer",
    "answer_question": "GeneralAnswer",
    "greet_user": "GeneralAnswer",
    "unclear": "Clarification",
    "clarify": "Clarification",
}


def _pipeline_result_to_public_response(
    result: PipelineResult,
    *,
    include_debug: bool,
) -> PublicAPIResponse:
    final_output = result.final_output or {}
    raw_errors = final_output.get("errors", [])
    error_list = raw_errors if isinstance(raw_errors, list) else []
    errors = [
        PublicAPIError(
            code="pipeline_error",
            message="A processing step failed." if not include_debug else str(error),
        )
        for error in error_list
    ]
    component = _UI_MAP.get(result.intent)
    ui = {"component": component, "props": {}} if component else None
    response = PublicAPIResponse(
        success=bool(final_output.get("success", result.success)),
        status=str(final_output.get("status", "ok" if result.success else "error")),
        intent=result.intent,
        message=str(final_output.get("message") or ""),
        data={
            k: final_output[k]
            for k in ("results", "route")
            if final_output.get(k) is not None
        },
        errors=errors,
        ui=ui,
    )

    if include_debug:
        response.debug = {
            "plan": {
                "intent": result.intent,
                "reasoning": result.plan.reasoning,
                "steps": [step.tool.value for step in result.plan.steps],
            },
            "step_results": [
                _serialize_step_result(step) for step in result.step_results
            ],
        }

    return response


def _normalize_session_state(state: dict[str, object] | None) -> dict[str, object]:
    base: dict[str, object] = {
        "interactions": [],
        "route_history": [],
        "last_intent": None,
        "last_status": None,
        "last_message": "",
        "summary": None,
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if state is None:
        return base

    normalized = dict(base)
    normalized.update(state)
    raw_interactions = normalized.get("interactions")
    normalized["interactions"] = (
        list(raw_interactions) if isinstance(raw_interactions, list) else []
    )
    raw_route_history = normalized.get("route_history")
    normalized["route_history"] = (
        list(raw_route_history) if isinstance(raw_route_history, list) else []
    )
    normalized["summary"] = _as_str_or_none(normalized.get("summary"))
    return normalized


def _runtime_model_label(model: object) -> str | None:
    if model is None:
        return None
    if isinstance(model, str):
        return model

    label = getattr(model, "model_name", None)
    if isinstance(label, str) and label:
        return label
    return type(model).__name__


def _build_updated_session_state(
    previous_state: dict[str, object],
    *,
    request: PublicAPIRequest,
    response: PublicAPIResponse,
    context_delta: dict[str, object] | None = None,
) -> dict[str, object]:
    raw = previous_state["interactions"]
    interactions = list(raw) if isinstance(raw, list) else []
    interactions.append(
        {
            "text": request.text,
            "intent": response.intent,
            "status": response.status,
            "success": response.success,
            "created_at": datetime.now(UTC).isoformat(),
            "context_delta": context_delta or {},
        }
    )
    interactions = interactions[-_MAX_INTERACTIONS:]

    return {
        **previous_state,
        "interactions": interactions,
        "last_intent": response.intent,
        "last_status": response.status,
        "last_message": response.message,
        "updated_at": datetime.now(UTC).isoformat(),
    }


def _build_session_summary(state: dict[str, object]) -> dict[str, object]:
    raw_interactions = state.get("interactions")
    raw_route_history = state.get("route_history")
    return {
        "interaction_count": len(raw_interactions)
        if isinstance(raw_interactions, list)
        else 0,
        "route_history_count": len(raw_route_history)
        if isinstance(raw_route_history, list)
        else 0,
        "last_intent": state.get("last_intent"),
        "last_status": state.get("last_status"),
        "last_message": state.get("last_message", ""),
    }


def _get_plan_params(result: PipelineResult) -> dict[str, object]:
    for step in result.plan.steps:
        if step.params:
            return dict(step.params)
    return {}


def _infer_bangumi_id(results: object) -> str | None:
    if not isinstance(results, dict):
        return None
    rows = results.get("rows")
    if not isinstance(rows, list) or not rows:
        return None
    first_row = rows[0]
    if not isinstance(first_row, dict):
        return None
    bangumi_id = first_row.get("bangumi_id")
    return str(bangumi_id) if bangumi_id is not None else None


def _application_error_response(exc: ApplicationError) -> PublicAPIResponse:
    return PublicAPIResponse(
        success=False,
        status="error",
        intent="unknown",
        message=exc.message,
        errors=[
            PublicAPIError(
                code=exc.error_code.value,
                message=exc.message,
                details=exc.details,
            )
        ],
    )


def _serialize_step_result(step: StepResult) -> dict[str, object]:
    return {
        "tool": step.tool,
        "success": step.success,
        "error": step.error,
        "data": step.data,
    }


def _extract_plan_steps(result: PipelineResult | None) -> list[str] | None:
    if result is None:
        return None

    steps: list[str] = []
    for step in getattr(result.plan, "steps", []) or []:
        tool = getattr(step, "tool", None)
        if tool is not None:
            steps.append(getattr(tool, "value", str(tool)))
            continue

        step_type = getattr(step, "step_type", None)
        if step_type is not None:
            steps.append(getattr(step_type, "value", str(step_type)))
            continue

        steps.append(str(step))

    return steps


def _build_context_block(
    session_state: dict[str, object],
    user_memory: dict[str, object] | None = None,
) -> dict[str, object] | None:
    raw_interactions = session_state.get("interactions")
    interactions = raw_interactions if isinstance(raw_interactions, list) else []
    summary = _as_str_or_none(session_state.get("summary"))
    current_bangumi_id: str | None = None
    current_anime_title: str | None = None
    last_location: str | None = None
    visited_bangumi_ids: list[str] = []

    for interaction in reversed(interactions):
        if not isinstance(interaction, dict):
            continue
        raw_delta = interaction.get("context_delta")
        delta = raw_delta if isinstance(raw_delta, dict) else {}

        bangumi_id = _as_str_or_none(delta.get("bangumi_id"))
        anime_title = _as_str_or_none(delta.get("anime_title"))
        location = _as_str_or_none(delta.get("location"))

        if current_bangumi_id is None and bangumi_id:
            current_bangumi_id = bangumi_id
            current_anime_title = anime_title
        if last_location is None and location:
            last_location = location
        if bangumi_id and bangumi_id not in visited_bangumi_ids:
            visited_bangumi_ids.append(bangumi_id)

        if current_bangumi_id and last_location:
            break

    if user_memory:
        raw_visited = user_memory.get("visited_anime")
        visited_anime = raw_visited if isinstance(raw_visited, list) else []
        for entry in visited_anime:
            if not isinstance(entry, dict):
                continue
            bangumi_id = _as_str_or_none(entry.get("bangumi_id"))
            if bangumi_id and bangumi_id not in visited_bangumi_ids:
                visited_bangumi_ids.append(bangumi_id)

        if current_bangumi_id is None and visited_anime:
            most_recent = max(
                visited_anime,
                key=lambda e: e.get("last_at", "") if isinstance(e, dict) else "",
                default=None,
            )
            if isinstance(most_recent, dict):
                current_bangumi_id = _as_str_or_none(most_recent.get("bangumi_id"))
                current_anime_title = _as_str_or_none(most_recent.get("title"))

    if (
        not current_bangumi_id
        and not last_location
        and not visited_bangumi_ids
        and not summary
    ):
        return None

    return {
        "summary": summary,
        "current_bangumi_id": current_bangumi_id,
        "current_anime_title": current_anime_title,
        "last_location": last_location,
        "last_intent": session_state.get("last_intent"),
        "visited_bangumi_ids": visited_bangumi_ids,
    }


def _extract_context_delta(result: PipelineResult) -> dict[str, object]:
    bangumi_id: str | None = None
    anime_title: str | None = None
    location: str | None = None

    for step_result in result.step_results:
        if step_result.tool != "resolve_anime" or not step_result.success:
            continue

        data = step_result.data if isinstance(step_result.data, dict) else {}
        bangumi_id = _as_str_or_none(data.get("bangumi_id"))
        anime_title = _as_str_or_none(data.get("title") or data.get("anime_title"))
        break

    for plan_step, step_result in zip(
        result.plan.steps, result.step_results, strict=False
    ):
        if not step_result.success:
            continue

        if step_result.tool == "search_nearby" and location is None:
            location = _as_str_or_none(plan_step.params.get("location"))

        if step_result.tool != "search_bangumi" or bangumi_id is not None:
            continue

        data = step_result.data if isinstance(step_result.data, dict) else {}
        rows = data.get("rows")
        if isinstance(rows, list) and rows:
            first_row = rows[0] if isinstance(rows[0], dict) else {}
            bangumi_id = _as_str_or_none(first_row.get("bangumi_id"))
            anime_title = _as_str_or_none(
                first_row.get("title") or first_row.get("title_cn")
            )
        if bangumi_id is None:
            bangumi_id = _as_str_or_none(
                plan_step.params.get("bangumi_id") or plan_step.params.get("bangumi")
            )

    context_delta: dict[str, object] = {}
    if bangumi_id is not None:
        context_delta["bangumi_id"] = bangumi_id
    if anime_title is not None:
        context_delta["anime_title"] = anime_title
    if location is not None:
        context_delta["location"] = location
    return context_delta


async def _generate_and_save_title(
    *,
    session_id: str,
    first_query: str,
    response_message: str,
    db: object,
    user_id: str | None = None,
) -> None:
    title = first_query.strip()[:20] or first_query[:20]

    try:
        from backend.agents.base import create_agent, get_default_model

        agent = create_agent(
            get_default_model(),
            system_prompt=(
                "Generate a very short conversation title (<=15 characters) in the "
                "same language as the query. Output only the title."
            ),
            retries=1,
        )
        result = await agent.run(
            f"Query: {first_query}\nResponse summary: {response_message[:200]}"
        )
        candidate = str(result.output).strip()[:20]
        if candidate:
            title = candidate
    except Exception:
        logger.warning("conversation_title_generation_failed", session_id=session_id)

    update_conversation_title = getattr(db, "update_conversation_title", None)
    if update_conversation_title is None:
        return

    try:
        await update_conversation_title(session_id, title, user_id=user_id)
    except TypeError:
        await update_conversation_title(session_id, title)
    except Exception:
        logger.warning("update_conversation_title_failed", session_id=session_id)


def _build_selected_points_plan(request: PublicAPIRequest) -> ExecutionPlan:
    point_ids = list(request.selected_point_ids or [])
    return ExecutionPlan(
        steps=[
            PlanStep(
                tool=ToolName.PLAN_SELECTED,
                params={
                    "point_ids": point_ids,
                    "origin": request.origin,
                },
            )
        ],
        reasoning="User selected specific points for routing.",
        locale=request.locale,
    )


async def _compact_session_interactions(
    session_id: str,
    session_state: dict[str, object],
    session_store: SessionStore,
) -> None:
    """Compress older interactions into a short summary in the background."""
    latest_state = await session_store.get(session_id)
    current_state = _normalize_session_state(
        latest_state if latest_state is not None else session_state
    )
    raw_interactions = current_state.get("interactions")
    interactions = raw_interactions if isinstance(raw_interactions, list) else []
    if len(interactions) < _COMPACT_THRESHOLD:
        return

    previous_summary = _as_str_or_none(current_state.get("summary"))
    compacted = interactions[:-_COMPACT_KEEP_RECENT]
    recent = interactions[-_COMPACT_KEEP_RECENT:]
    if not compacted:
        return

    prompt_lines: list[str] = []
    if previous_summary:
        prompt_lines.append(f"Existing summary: {previous_summary}")
    prompt_lines.append("Merge these interaction notes into a concise session summary:")
    for entry in compacted:
        if isinstance(entry, dict):
            intent = entry.get("intent") or "unknown"
            text = str(entry.get("text") or "").strip()[:120]
        else:
            intent = "unknown"
            text = str(entry).strip()[:120]
        prompt_lines.append(f"- [{intent}] {text}")

    agent = create_agent(
        get_default_model(),
        system_prompt=(
            "Summarize the session in 1-2 sentences. Capture what the user was "
            "researching and keep the same language as the interaction text."
        ),
        retries=1,
    )
    try:
        result = await agent.run("\n".join(prompt_lines))
    except Exception:
        logger.warning("compact_llm_failed", session_id=session_id)
        return

    summary = _as_str_or_none(getattr(result, "output", None))
    if summary is None:
        return

    updated_state = {
        **current_state,
        "interactions": recent,
        "summary": summary[:300],
        "updated_at": datetime.now(UTC).isoformat(),
    }
    try:
        await session_store.set(session_id, updated_state)
    except Exception:
        logger.warning("compact_write_failed", session_id=session_id)
        return

    logger.info(
        "compact_complete",
        session_id=session_id,
        summary_length=len(str(updated_state["summary"])),
    )


def _as_str_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
