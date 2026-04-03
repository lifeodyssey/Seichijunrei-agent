"""Thin public API surface over the runtime pipeline.

This module provides a stable request/response contract that future HTTP or
RPC adapters can wrap without depending directly on internal pipeline types.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from time import perf_counter
from typing import Any, Literal
from uuid import uuid4

import structlog
from pydantic import BaseModel, Field, field_validator

from agents.executor_agent import PipelineResult, StepResult
from agents.pipeline import run_pipeline
from application.errors import ApplicationError, ErrorCode
from infrastructure.observability import (
    get_runtime_tracer,
    record_runtime_request,
)
from infrastructure.session import SessionStore, create_session_store

logger = structlog.get_logger(__name__)

_MAX_INTERACTIONS = 20
_MAX_ROUTE_HISTORY = 10


class PublicAPIRequest(BaseModel):
    """Public request contract for runtime execution."""

    text: str = Field(..., min_length=1, description="User message to process")
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

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        text = value.strip()
        if not text:
            raise ValueError("text cannot be blank")
        return text


class PublicAPIError(BaseModel):
    """Stable error payload for public callers."""

    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class PublicAPIResponse(BaseModel):
    """Public response contract for runtime execution."""

    success: bool
    status: str
    intent: str
    session_id: str | None = None
    message: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    session: dict[str, Any] = Field(default_factory=dict)
    route_history: list[dict[str, Any]] = Field(default_factory=list)
    errors: list[PublicAPIError] = Field(default_factory=list)
    ui: dict[str, Any] | None = Field(
        default=None,
        description="Optional Generative UI descriptor: {component, props}",
    )
    debug: dict[str, Any] | None = None


class RuntimeAPI:
    """Thin interface-layer facade over ``run_pipeline``."""

    def __init__(
        self,
        db: Any,
        *,
        session_store: SessionStore | None = None,
    ) -> None:
        self._db = db
        self._session_store = session_store or create_session_store()

    async def handle(
        self,
        request: PublicAPIRequest,
        *,
        user_id: str | None = None,
        on_step: Callable[[str, str, dict[str, Any]], Awaitable[None]] | None = None,
    ) -> PublicAPIResponse:
        """Execute the runtime pipeline and normalize its output."""
        session_id = request.session_id or None
        started_at = perf_counter()
        tracer = get_runtime_tracer()
        response: PublicAPIResponse | None = None

        with tracer.start_as_current_span("runtime.handle") as span:
            if session_id:
                span.set_attribute("runtime.session_id", session_id)
            span.set_attribute("runtime.include_debug", request.include_debug)
            if request.model:
                span.set_attribute("runtime.model", request.model)
            if user_id:
                span.set_attribute("runtime.user_id", user_id)

            result: PipelineResult | None = None
            try:
                previous_state = (
                    await self._load_session_state(session_id)
                    if session_id
                    else _normalize_session_state(None)
                )
                context_delta: dict[str, Any] = {}
                user_memory = await self._load_user_memory(user_id)
                context = _build_context_block(previous_state, user_memory=user_memory)

                try:
                    result = await run_pipeline(
                        request.text,
                        self._db,
                        model=request.model,
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
                    route_history = list(session_state["route_history"])
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

                response.session = _build_session_summary(session_state)
                response.route_history = list(session_state["route_history"])
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

    async def _load_user_memory(self, user_id: str | None) -> dict[str, Any] | None:
        if not user_id:
            return None

        get_user_memory = getattr(self._db, "get_user_memory", None)
        if get_user_memory is None:
            return None

        try:
            return await get_user_memory(user_id)
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
        context_delta: dict[str, Any],
        previous_state: dict[str, Any],
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
                is_first_interaction = len(previous_state.get("interactions") or []) == 0
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

    async def _load_session_state(self, session_id: str) -> dict[str, Any]:
        state = await self._session_store.get(session_id)
        return _normalize_session_state(state)

    async def _persist_session(
        self,
        session_id: str,
        session_state: dict[str, Any],
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
    ) -> dict[str, Any] | None:
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
    db: Any,
    *,
    session_store: SessionStore | None = None,
    user_id: str | None = None,
    on_step: Callable[[str, str, dict[str, Any]], Awaitable[None]] | None = None,
) -> PublicAPIResponse:
    """Convenience helper for one-off public API execution."""
    api = RuntimeAPI(db, session_store=session_store)
    return await api.handle(request, user_id=user_id, on_step=on_step)


_UI_MAP: dict[str, str] = {
    "search_bangumi": "PilgrimageGrid",
    "search_nearby": "NearbyMap",
    "plan_route": "RouteVisualization",
    "general_qa": "GeneralAnswer",
    "answer_question": "GeneralAnswer",
    "greet_user": "GeneralAnswer",
    "unclear": "Clarification",
}


def _pipeline_result_to_public_response(
    result: PipelineResult,
    *,
    include_debug: bool,
) -> PublicAPIResponse:
    final_output = result.final_output or {}
    raw_errors = final_output.get("errors", [])
    errors = [
        PublicAPIError(
            code="pipeline_error",
            message="A processing step failed." if not include_debug else str(error),
        )
        for error in raw_errors
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


def _normalize_session_state(state: dict[str, Any] | None) -> dict[str, Any]:
    base = {
        "interactions": [],
        "route_history": [],
        "last_intent": None,
        "last_status": None,
        "last_message": "",
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if state is None:
        return base

    normalized = dict(base)
    normalized.update(state)
    normalized["interactions"] = list(normalized.get("interactions") or [])
    normalized["route_history"] = list(normalized.get("route_history") or [])
    return normalized


def _build_updated_session_state(
    previous_state: dict[str, Any],
    *,
    request: PublicAPIRequest,
    response: PublicAPIResponse,
    context_delta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    interactions = list(previous_state["interactions"])
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


def _build_session_summary(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "interaction_count": len(state.get("interactions", [])),
        "route_history_count": len(state.get("route_history", [])),
        "last_intent": state.get("last_intent"),
        "last_status": state.get("last_status"),
        "last_message": state.get("last_message", ""),
    }


def _get_plan_params(result: PipelineResult) -> dict[str, Any]:
    for step in result.plan.steps:
        if step.params:
            return dict(step.params)
    return {}


def _infer_bangumi_id(results: Any) -> str | None:
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


def _serialize_step_result(step: StepResult) -> dict[str, Any]:
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
    session_state: dict[str, Any],
    user_memory: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    interactions = session_state.get("interactions") or []
    current_bangumi_id: str | None = None
    current_anime_title: str | None = None
    last_location: str | None = None
    visited_bangumi_ids: list[str] = []

    for interaction in reversed(interactions):
        delta = interaction.get("context_delta") or {}

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
        for entry in user_memory.get("visited_anime") or []:
            bangumi_id = _as_str_or_none(entry.get("bangumi_id"))
            if bangumi_id and bangumi_id not in visited_bangumi_ids:
                visited_bangumi_ids.append(bangumi_id)

        if current_bangumi_id is None and user_memory.get("visited_anime"):
            most_recent = max(
                user_memory.get("visited_anime") or [],
                key=lambda entry: entry.get("last_at", ""),
                default=None,
            )
            if most_recent is not None:
                current_bangumi_id = _as_str_or_none(most_recent.get("bangumi_id"))
                current_anime_title = _as_str_or_none(most_recent.get("title"))

    if not current_bangumi_id and not last_location and not visited_bangumi_ids:
        return None

    return {
        "current_bangumi_id": current_bangumi_id,
        "current_anime_title": current_anime_title,
        "last_location": last_location,
        "last_intent": session_state.get("last_intent"),
        "visited_bangumi_ids": visited_bangumi_ids,
    }


def _extract_context_delta(result: PipelineResult) -> dict[str, Any]:
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

    for plan_step, step_result in zip(result.plan.steps, result.step_results):
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

    context_delta: dict[str, Any] = {}
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
    db: Any,
    user_id: str | None = None,
) -> None:
    title = first_query.strip()[:20] or first_query[:20]

    try:
        from agents.base import create_agent, get_default_model

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


def _as_str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
