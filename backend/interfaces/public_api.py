"""Thin public API surface over the runtime pipeline.

Orchestration logic only — response building lives in ``response_builder``,
session management in ``session_facade``, and persistence in ``persistence``.
"""

from __future__ import annotations

import re
from time import perf_counter
from typing import cast
from uuid import uuid4

import structlog
from pydantic_ai.models import Model

from backend.agents.executor_agent import ExecutorAgent, PipelineResult
from backend.agents.pilgrimage_runner import run_pilgrimage_agent
from backend.agents.runtime_deps import OnStep
from backend.agents.translation import translate_text
from backend.application.errors import ApplicationError, ErrorCode
from backend.domain.ports import DatabasePort
from backend.infrastructure.observability import (
    get_runtime_tracer,
    record_runtime_request,
)
from backend.infrastructure.session import SessionStore, create_session_store
from backend.interfaces.persistence import (
    build_response_session,
    extract_plan_steps,
    load_session_state,
    load_user_memory,
    persist_messages,
    persist_result,
)
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
    build_context_block,
    build_selected_points_plan,
    extract_context_delta,
    normalize_session_state,
)

__all__ = [
    "PublicAPIError",
    "PublicAPIRequest",
    "PublicAPIResponse",
    "RuntimeAPI",
    "detect_language",
    "handle_public_request",
]

logger = structlog.get_logger(__name__)

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_KANA_RE = re.compile(r"[\u3040-\u30ff]")


def detect_language(text: str) -> str:
    """Detect whether *text* is Chinese, Japanese, or English.

    Heuristic: kana → ja, CJK only → zh, else → en.
    """
    if _KANA_RE.search(text):
        return "ja"
    if _CJK_RE.search(text):
        return "zh"
    return "en"


class RuntimeAPI:
    """Thin interface-layer facade over the runtime agent."""

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
        on_step: OnStep | None = None,
    ) -> PublicAPIResponse:
        """Execute the runtime pipeline and normalize its output."""
        session_id = request.session_id or None
        started_at = perf_counter()
        tracer = get_runtime_tracer()
        response: PublicAPIResponse | None = None
        effective_model = model if model is not None else request.model

        with tracer.start_as_current_span("runtime.handle") as span:
            _set_span_request_attrs(span, session_id, request, effective_model, user_id)

            from backend.agents.guardrails import detect_prompt_injection

            if detect_prompt_injection(request.text):
                logger.warning(
                    "input_guardrail_injection_detected",
                    text=request.text[:100],
                    user_id=user_id,
                )

            result: PipelineResult | None = None
            user_message_persisted = False
            try:
                previous_state, context = await self._load_session(
                    session_id, user_id, request
                )
                result, response, context_delta = await self._execute_pipeline(
                    request, context, effective_model, on_step, span
                )

                if response.intent == "greet_user":
                    response.session_id = None
                    response.session = {}
                    response.route_history = []
                    user_message_persisted = True
                    return response

                if session_id is None:
                    session_id = uuid4().hex
                    span.set_attribute("runtime.session_id", session_id)

                response.session_id = session_id

                session_state, user_message_persisted = await persist_result(
                    db=self._db,
                    session_store=self._session_store,
                    session_id=session_id,
                    request=request,
                    result=result,
                    response=response,
                    context_delta=context_delta,
                    previous_state=previous_state,
                    user_id=user_id,
                )

                session_summary, route_history = build_response_session(session_state)
                response.session = session_summary
                response.route_history = [
                    r for r in route_history if isinstance(r, dict)
                ]
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

                await self._log_request(
                    session_id=session_id,
                    request=request,
                    result=result,
                    response=response,
                    elapsed_ms=elapsed_ms,
                    intent=intent,
                    status=status,
                    user_message_persisted=user_message_persisted,
                )

    async def _load_session(
        self,
        session_id: str | None,
        user_id: str | None,
        request: PublicAPIRequest,
    ) -> tuple[dict[str, object], dict[str, object] | None]:
        """Load session state and build context block."""
        previous_state = (
            await load_session_state(self._session_store, session_id)
            if session_id
            else normalize_session_state(None)
        )
        user_memory = await load_user_memory(self._db, user_id)
        context = build_context_block(previous_state, user_memory=user_memory)
        if request.origin_lat is not None and request.origin_lng is not None:
            if context is None:
                context = {}
            context["origin_lat"] = request.origin_lat
            context["origin_lng"] = request.origin_lng
        return previous_state, context

    async def _execute_pipeline(
        self,
        request: PublicAPIRequest,
        context: dict[str, object] | None,
        effective_model: Model | str | None,
        on_step: OnStep | None,
        span: object,
    ) -> tuple[PipelineResult | None, PublicAPIResponse, dict[str, object]]:
        """Run the pipeline (or synthetic plan) and map result to response."""
        context_delta: dict[str, object] = {}
        synthetic_plan = (
            build_selected_points_plan(request) if request.selected_point_ids else None
        )
        try:
            if synthetic_plan is not None:
                result: PipelineResult = await ExecutorAgent(self._db).execute(
                    synthetic_plan,
                    context_block=context,
                    on_step=on_step,
                )
            else:
                result = await run_pilgrimage_agent(
                    text=request.text,
                    db=cast(DatabasePort, self._db),
                    model=effective_model,
                    locale=request.locale,
                    context=context,
                    on_step=on_step,
                )
        except ApplicationError as exc:
            record_exc = getattr(span, "record_exception", None)
            if callable(record_exc):
                record_exc(exc)
            return None, application_error_response(exc), context_delta
        except Exception as exc:
            record_exc = getattr(span, "record_exception", None)
            if callable(record_exc):
                record_exc(exc)
            logger.error("pipeline_unhandled_exception", exc_info=exc)
            return (
                None,
                PublicAPIResponse(
                    success=False,
                    status="error",
                    intent="unknown",
                    message="The runtime failed before producing a pipeline result.",
                    errors=[
                        PublicAPIError(
                            code=ErrorCode.INTERNAL_ERROR.value,
                            message="An internal error occurred. Please try again.",
                        )
                    ],
                ),
                context_delta,
            )
        await _apply_translation_gate(result, request.locale, on_step)
        response = pipeline_result_to_public_response(
            result,
            include_debug=request.include_debug,
        )
        context_delta = extract_context_delta(result)
        return result, response, context_delta

    async def _log_request(
        self,
        *,
        session_id: str | None,
        request: PublicAPIRequest,
        result: PipelineResult | None,
        response: PublicAPIResponse | None,
        elapsed_ms: float,
        intent: str,
        status: str,
        user_message_persisted: bool,
    ) -> None:
        """Persist user message on error (best-effort) and log request."""
        if not user_message_persisted and session_id and request.text:
            try:
                await persist_messages(
                    db=self._db,
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
        if insert_request_log is None or is_ephemeral:
            return

        try:
            await insert_request_log(
                session_id=session_id,
                query_text=request.text,
                locale=request.locale,
                plan_steps=extract_plan_steps(result),
                intent=intent,
                status=status,
                latency_ms=int(elapsed_ms),
            )
        except Exception:
            logger.warning("request_log_failed", session_id=session_id)


async def handle_public_request(
    request: PublicAPIRequest,
    db: object,
    *,
    model: Model | str | None = None,
    session_store: SessionStore | None = None,
    user_id: str | None = None,
    on_step: OnStep | None = None,
) -> PublicAPIResponse:
    """Convenience helper for one-off public API execution."""
    api = RuntimeAPI(db, session_store=session_store)
    return await api.handle(request, model=model, user_id=user_id, on_step=on_step)


async def _apply_translation_gate(
    result: PipelineResult,
    locale: str,
    on_step: OnStep | None,
) -> None:
    """Translate the pipeline message when its language mismatches *locale*."""
    final = result.final_output
    if not final:
        return
    message = final.get("message")
    if not isinstance(message, str) or not message:
        return
    detected = detect_language(message)
    if detected == locale:
        return
    if on_step is not None:
        await on_step("translate", "running", {}, "", "")
    try:
        translated = await translate_text(message, target_locale=locale)
        final["message"] = translated
    except Exception:
        logger.warning("translation_gate_failed", locale=locale)
    if on_step is not None:
        await on_step("translate", "done", {}, "", "")


def _set_span_request_attrs(
    span: object,
    session_id: str | None,
    request: PublicAPIRequest,
    effective_model: object,
    user_id: str | None,
) -> None:
    set_attr = getattr(span, "set_attribute", None)
    if not callable(set_attr):
        return
    if session_id:
        set_attr("runtime.session_id", session_id)
    set_attr("runtime.include_debug", request.include_debug)
    model_label = _runtime_model_label(effective_model)
    if model_label:
        set_attr("runtime.model", model_label)
    if user_id:
        set_attr("runtime.user_id", user_id)


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
