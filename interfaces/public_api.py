"""Thin public API surface over the runtime pipeline.

This module provides a stable request/response contract that future HTTP or
RPC adapters can wrap without depending directly on internal pipeline types.
"""

from __future__ import annotations

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

    async def handle(self, request: PublicAPIRequest) -> PublicAPIResponse:
        """Execute the runtime pipeline and normalize its output."""
        session_id = request.session_id or uuid4().hex
        started_at = perf_counter()
        tracer = get_runtime_tracer()
        response: PublicAPIResponse | None = None

        with tracer.start_as_current_span("runtime.handle") as span:
            span.set_attribute("runtime.session_id", session_id)
            span.set_attribute("runtime.include_debug", request.include_debug)
            if request.model:
                span.set_attribute("runtime.model", request.model)

            try:
                previous_state = await self._load_session_state(session_id)
                context_block = _build_context_block(previous_state)
                result: PipelineResult | None = None

                try:
                    result = await run_pipeline(
                        request.text,
                        self._db,
                        model=request.model,
                        locale=request.locale,
                        context=context_block,
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

                response.session_id = session_id

                session_state = _build_updated_session_state(
                    previous_state,
                    request=request,
                    response=response,
                    result_context_delta=
                        _extract_context_delta(result) if result is not None else None,
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
                if insert_request_log is not None:
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
) -> PublicAPIResponse:
    """Convenience helper for one-off public API execution."""
    api = RuntimeAPI(db, session_store=session_store)
    return await api.handle(request)


_UI_MAP: dict[str, str] = {
    "search_bangumi": "PilgrimageGrid",
    "search_nearby": "NearbyMap",
    "plan_route": "RouteVisualization",
    "general_qa": "GeneralAnswer",
    "answer_question": "GeneralAnswer",
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
    result_context_delta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    interactions = list(previous_state["interactions"])
    interactions.append(
        {
            "text": request.text,
            "intent": response.intent,
            "status": response.status,
            "success": response.success,
            "created_at": datetime.now(UTC).isoformat(),
            "context_delta": result_context_delta or {},
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


def _extract_context_delta(result: PipelineResult) -> dict[str, Any]:
    delta: dict[str, Any] = {
        "bangumi_id": None,
        "anime_title": None,
        "location": None,
    }
    for step in result.step_results:
        if not step.success or not step.data:
            continue
        if step.tool == "resolve_anime":
            delta["bangumi_id"] = step.data.get("bangumi_id")
            delta["anime_title"] = step.data.get("title")
        elif step.tool == "search_bangumi" and delta["bangumi_id"] is None:
            delta["bangumi_id"] = step.data.get("bangumi_id")
    for plan_step in result.plan.steps:
        if plan_step.tool.value == "search_nearby" and plan_step.params.get("location"):
            delta["location"] = plan_step.params["location"]
            break
    return delta


def _build_context_block(session_state: dict[str, Any]) -> dict[str, Any] | None:
    interactions = session_state.get("interactions") or []
    if not interactions:
        return None

    current_bangumi_id = None
    current_anime_title = None
    last_location = None
    visited_bangumi_ids: list[str] = []

    for interaction in reversed(interactions):
        delta = interaction.get("context_delta") or {}
        bangumi_id = delta.get("bangumi_id")
        if current_bangumi_id is None and bangumi_id:
            current_bangumi_id = bangumi_id
            current_anime_title = delta.get("anime_title")
        location = delta.get("location")
        if last_location is None and location:
            last_location = location
        if bangumi_id and bangumi_id not in visited_bangumi_ids:
            visited_bangumi_ids.append(bangumi_id)

    if not current_bangumi_id and not last_location and not visited_bangumi_ids:
        return None

    return {
        "current_bangumi_id": current_bangumi_id,
        "current_anime_title": current_anime_title,
        "last_location": last_location,
        "last_intent": session_state.get("last_intent"),
        "visited_bangumi_ids": visited_bangumi_ids,
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
