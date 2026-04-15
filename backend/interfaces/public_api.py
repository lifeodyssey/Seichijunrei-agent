"""Thin public API surface over the runtime pipeline.

This module provides a stable request/response contract that future HTTP or
RPC adapters can wrap without depending directly on internal pipeline types.

Orchestration logic only -- response building and session management are
delegated to ``response_builder`` and ``session_facade`` respectively.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from time import perf_counter
from uuid import uuid4

import structlog
from pydantic_ai.models import Model

from backend.agents.executor_agent import ExecutorAgent, PipelineResult
from backend.agents.pipeline import run_pipeline
from backend.application.errors import ApplicationError, ErrorCode
from backend.infrastructure.observability import (
    get_runtime_tracer,
    record_runtime_request,
)
from backend.infrastructure.session import SessionStore, create_session_store
from backend.interfaces.response_builder import (
    application_error_response,
    pipeline_result_to_public_response,
)
from backend.interfaces.schemas import (
    PublicAPIError,
    PublicAPIRequest,
    PublicAPIResponse,
)
from backend.interfaces.session_facade import (
    COMPACT_THRESHOLD,
    MAX_ROUTE_HISTORY,
    build_context_block,
    build_selected_points_plan,
    build_session_summary,
    build_updated_session_state,
    compact_session_interactions,
    extract_context_delta,
    generate_and_save_title,
    normalize_session_state,
)

# Re-export for backward compatibility
__all__ = [
    "PublicAPIError",
    "PublicAPIRequest",
    "PublicAPIResponse",
    "RuntimeAPI",
    "handle_public_request",
]

logger = structlog.get_logger(__name__)

# Backward-compatible aliases for private names used by tests
_build_context_block = build_context_block
_extract_context_delta = extract_context_delta
_compact_session_interactions = compact_session_interactions


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
        on_step: Callable[[str, str, dict[str, object], str, str], Awaitable[None]]
        | None = None,
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
            user_message_persisted = False
            try:
                previous_state = (
                    await self._load_session_state(session_id)
                    if session_id
                    else normalize_session_state(None)
                )
                context_delta: dict[str, object] = {}
                user_memory = await self._load_user_memory(user_id)
                context = build_context_block(previous_state, user_memory=user_memory)
                if request.origin_lat is not None and request.origin_lng is not None:
                    if context is None:
                        context = {}
                    context["origin_lat"] = request.origin_lat
                    context["origin_lng"] = request.origin_lng
                synthetic_plan = (
                    build_selected_points_plan(request)
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
                    response = application_error_response(exc)
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
                    response = pipeline_result_to_public_response(
                        result,
                        include_debug=request.include_debug,
                    )
                    context_delta = extract_context_delta(result)

                if response.intent == "greet_user":
                    response.session_id = None
                    response.session = {}
                    response.route_history = []
                    return response

                if session_id is None:
                    session_id = uuid4().hex
                    span.set_attribute("runtime.session_id", session_id)

                response.session_id = session_id

                session_state = build_updated_session_state(
                    previous_state,
                    request=request,
                    response_intent=response.intent,
                    response_status=response.status,
                    response_success=response.success,
                    response_message=response.message,
                    context_delta=context_delta,
                )

                route_record = None
                if result is not None:
                    route_record = await self._maybe_persist_route(
                        session_id=session_id,
                        request=request,
                        result=result,
                        response=response,
                    )

                if route_record is not None:
                    raw_rh = session_state["route_history"]
                    route_history: list[object] = (
                        list(raw_rh) if isinstance(raw_rh, list) else []
                    )
                    route_history.append(route_record)
                    session_state["route_history"] = route_history[-MAX_ROUTE_HISTORY:]

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
                    persist_user_only=not response.success,
                )
                user_message_persisted = True
                raw_ints = session_state.get("interactions")
                interaction_count = len(raw_ints) if isinstance(raw_ints, list) else 0
                if interaction_count >= COMPACT_THRESHOLD:
                    asyncio.create_task(
                        compact_session_interactions(
                            session_id,
                            session_state,
                            self._session_store,
                        )
                    )

                response.session = build_session_summary(session_state)
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

                if not user_message_persisted and session_id and request.text:
                    try:
                        await self._persist_messages(
                            session_id=session_id,
                            user_text=request.text,
                            result=None,
                            response=response
                            or PublicAPIResponse(
                                success=False, status="error", intent="unknown"
                            ),
                            persist_user_only=True,
                        )
                    except Exception:
                        logger.warning(
                            "finally_persist_user_msg_failed",
                            session_id=session_id,
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
        persist_user_only: bool = False,
    ) -> None:
        """Persist user and bot messages to conversation_messages (best-effort)."""
        insert_message = getattr(self._db, "insert_message", None)
        if insert_message is None:
            return

        try:
            await insert_message(session_id, "user", user_text)
        except Exception:
            logger.warning("insert_user_message_failed", session_id=session_id)

        if persist_user_only:
            return

        try:
            response_data: dict[str, object] | None = None
            if result is not None:
                response_data = {
                    "intent": result.intent,
                    "success": result.success,
                    "final_output": result.final_output,
                }
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
                        generate_and_save_title(
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
        return normalize_session_state(state)

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
        request: PublicAPIRequest,
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

        origin_station = plan_params.get("origin")
        if not isinstance(origin_station, str):
            origin_station = None
        if (
            origin_station is None
            and request.origin_lat is not None
            and request.origin_lng is not None
        ):
            origin_station = f"{request.origin_lat},{request.origin_lng}"

        route_record = {
            "route_id": None,
            "bangumi_id": bangumi_id,
            "origin_station": origin_station,
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
                origin_station=origin_station,
                origin_lat=request.origin_lat,
                origin_lon=request.origin_lng,
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
    on_step: Callable[[str, str, dict[str, object], str, str], Awaitable[None]]
    | None = None,
) -> PublicAPIResponse:
    """Convenience helper for one-off public API execution."""
    api = RuntimeAPI(db, session_store=session_store)
    return await api.handle(request, model=model, user_id=user_id, on_step=on_step)


def _runtime_model_label(model: object) -> str | None:
    if model is None:
        return None
    from backend.agents.base import describe_model, parse_model_spec

    if isinstance(model, str):
        try:
            return describe_model(parse_model_spec(model, use_settings_fallbacks=False))
        except Exception:
            return model
    return describe_model(model)


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
