"""FastAPI service adapter for the public runtime API."""

from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass
from time import perf_counter
from typing import Annotated, Literal, cast

import structlog
import uvicorn
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ValidationError, field_validator
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

from backend.config.settings import Settings, get_settings
from backend.infrastructure.observability import (
    get_http_tracer,
    record_http_request,
    setup_observability,
    shutdown_observability,
)
from backend.infrastructure.session import SessionStore, create_session_store
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.public_api import (
    PublicAPIRequest,
    PublicAPIResponse,
    RuntimeAPI,
)

logger = structlog.get_logger(__name__)
router = APIRouter()


@dataclass(frozen=True)
class TrustedAuthContext:
    user_id: str | None
    user_type: str | None


class ConversationPatchRequest(BaseModel):
    title: str

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        title = value.strip()
        if not title:
            raise ValueError("title must be a non-empty string.")
        return title


class FeedbackRequest(BaseModel):
    session_id: str | None = None
    query_text: str
    intent: str | None = None
    rating: Literal["good", "bad"]
    comment: str | None = None

    @field_validator("session_id", "intent", "comment")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text or None

    @field_validator("query_text")
    @classmethod
    def validate_query_text(cls, value: str) -> str:
        query_text = value.strip()
        if not query_text:
            raise ValueError("query_text is required.")
        return query_text


def _normalize_optional_header(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    return text or None


def _get_trusted_auth_context(
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
    x_user_type: Annotated[str | None, Header(alias="X-User-Type")] = None,
) -> TrustedAuthContext:
    return TrustedAuthContext(
        user_id=_normalize_optional_header(x_user_id),
        user_type=_normalize_optional_header(x_user_type),
    )


def _require_trusted_user(
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> TrustedAuthContext:
    if auth.user_id is None:
        raise HTTPException(status_code=400, detail="X-User-Id header required.")
    return auth


@router.get("/")
async def handle_root(request: Request) -> JSONResponse:
    settings = _get_settings_from_request(request)
    payload = {
        "service": "seichijunrei-runtime",
        "status": "ok",
        "app_env": settings.app_env,
        "endpoints": {
            "healthz": "/healthz",
            "runtime": "/v1/runtime",
            "feedback": "/v1/feedback",
        },
    }
    return _json_response(payload)


@router.get("/healthz")
async def handle_health(request: Request) -> JSONResponse:
    runtime_api = _get_runtime_api(request)
    settings = _get_settings_from_request(request)
    payload = {
        "status": "ok",
        "service": "seichijunrei-runtime",
        "app_env": settings.app_env,
        "observability_enabled": settings.observability_enabled,
        "db_adapter": type(getattr(runtime_api, "_db", None)).__name__,
        "session_store": type(getattr(runtime_api, "_session_store", None)).__name__,
    }
    return _json_response(payload)


@router.post("/v1/runtime")
async def handle_runtime(
    request: Request,
    api_request: PublicAPIRequest,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> JSONResponse:
    runtime_api = _get_runtime_api(request)
    response = await runtime_api.handle(api_request, user_id=auth.user_id)
    return _public_api_response(response)


@router.post("/v1/runtime/stream")
async def handle_runtime_stream(
    request: Request,
    api_request: PublicAPIRequest,
    auth: Annotated[TrustedAuthContext, Depends(_get_trusted_auth_context)],
) -> StreamingResponse:
    runtime_api = _get_runtime_api(request)
    queue: asyncio.Queue[str | None] = asyncio.Queue()

    async def emit(event: str, data: dict[str, object]) -> None:
        payload = json.dumps({"event": event, **data}, ensure_ascii=False)
        await queue.put(f"event: {event}\ndata: {payload}\n\n")

    async def on_step(
        tool: str,
        status: str,
        data: dict[str, object],
        thought: str = "",
        observation: str = "",
    ) -> None:
        await emit(
            "step",
            {
                "tool": tool,
                "status": status,
                "thought": thought,
                "observation": observation,
                "data": data,
            },
        )

    async def run_pipeline_task() -> None:
        try:
            response = await runtime_api.handle(
                api_request,
                user_id=auth.user_id,
                on_step=on_step,
            )
            await emit("done", response.model_dump(mode="json"))
        except Exception as exc:
            logger.exception("sse_pipeline_error", error=str(exc))
            await emit(
                "error",
                {
                    "code": "internal_error",
                    "message": "Something went wrong. Please try again.",
                },
            )
        finally:
            await queue.put(None)

    async def event_generator() -> AsyncIterator[str]:
        task = asyncio.create_task(run_pipeline_task())
        planning_payload = json.dumps(
            {"event": "planning", "status": "running"},
            ensure_ascii=False,
        )
        try:
            yield f"event: planning\ndata: {planning_payload}\n\n"
            while True:
                item = await queue.get()
                if item is None:
                    break
                if await request.is_disconnected():
                    break
                yield item
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            else:
                await task

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/v1/conversations")
async def handle_get_conversations(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    get_conversations = _require_db_method(db, "get_conversations")
    conversations_obj: object = await get_conversations(auth.user_id)
    return _json_response(conversations_obj)


@router.patch("/v1/conversations/{session_id}")
async def handle_patch_conversation(
    session_id: str,
    payload: ConversationPatchRequest,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    update_conversation_title = _require_db_method(db, "update_conversation_title")
    await update_conversation_title(session_id, payload.title, user_id=auth.user_id)
    return _json_response({"ok": True})


@router.get("/v1/conversations/{session_id}/messages")
async def handle_get_messages(
    session_id: str,
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    get_conversation = _require_db_method(db, "get_conversation")
    conversation_obj: object = await get_conversation(session_id)
    conversation = conversation_obj if isinstance(conversation_obj, dict) else None
    if conversation is None or conversation.get("user_id") != auth.user_id:
        return _error_response(
            "not_found",
            "Conversation not found.",
            status_code=404,
        )

    get_messages = _require_db_method(db, "get_messages")
    messages_obj: object = await get_messages(session_id)
    return _json_response({"messages": messages_obj})


@router.get("/v1/routes")
async def handle_get_routes(
    request: Request,
    auth: Annotated[TrustedAuthContext, Depends(_require_trusted_user)],
) -> JSONResponse:
    assert auth.user_id is not None
    db = _get_db_from_request(request)
    get_user_routes = _require_db_method(db, "get_user_routes")
    routes_obj: object = await get_user_routes(auth.user_id)
    return _json_response({"routes": routes_obj})


@router.post("/v1/feedback")
async def handle_feedback(
    payload: FeedbackRequest,
    request: Request,
) -> JSONResponse:
    db = _get_db_from_request(request)
    save_feedback = _require_db_method(db, "save_feedback")
    feedback_id_obj = await save_feedback(
        payload.session_id,
        payload.query_text,
        payload.intent,
        payload.rating,
        payload.comment,
    )
    feedback_id = str(feedback_id_obj)
    return _json_response({"feedback_id": feedback_id})


def create_fastapi_app(
    *,
    runtime_api: RuntimeAPI | None = None,
    settings: Settings | None = None,
    db: object | None = None,
    session_store: SessionStore | None = None,
) -> FastAPI:
    """Build the FastAPI service app for the runtime."""
    resolved_settings = settings or get_settings()
    _setup_logfire(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = resolved_settings
        if resolved_settings.observability_enabled:
            setup_observability(resolved_settings)

        if runtime_api is not None:
            app.state.runtime_api = runtime_api
            resolved_db = db if db is not None else getattr(runtime_api, "_db", None)
            if resolved_db is not None:
                app.state.db_client = resolved_db
            try:
                yield
            finally:
                if resolved_settings.observability_enabled:
                    shutdown_observability()
            return

        runtime_db = db if db is not None else _build_supabase_client(resolved_settings)
        if session_store is not None:
            runtime_session_store = session_store
        elif isinstance(runtime_db, SupabaseClient):
            runtime_session_store = _build_session_store(runtime_db)
        else:
            raise RuntimeError(
                "create_fastapi_app(..., db=...) requires session_store for non-Supabase db adapters."
            )
        await _call_optional_async(runtime_db, "connect")
        app.state.runtime_api = RuntimeAPI(
            runtime_db,
            session_store=runtime_session_store,
        )
        app.state.db_client = runtime_db

        try:
            yield
        finally:
            await _call_optional_async(runtime_session_store, "close")
            await _call_optional_async(runtime_db, "close")
            if resolved_settings.observability_enabled:
                shutdown_observability()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[resolved_settings.cors_allowed_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=[
            "Content-Type",
            "Authorization",
            "X-User-Id",
            "X-User-Type",
        ],
    )
    _register_exception_handlers(app)
    _register_observability_middleware(app)
    app.include_router(router)
    return app


def main() -> None:
    """Run the FastAPI service."""
    settings = get_settings()
    uvicorn.run(
        app,
        host=settings.service_host,
        port=settings.service_port,
    )


def _register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        del request
        errors_obj: object = exc.errors()
        if _contains_json_invalid_error(errors_obj):
            return _error_response(
                "invalid_json",
                "Request body must be valid JSON.",
                status_code=400,
            )
        return _error_response(
            "invalid_request",
            "Request payload did not match the public API schema.",
            status_code=422,
            details=errors_obj,
        )

    @app.exception_handler(ValidationError)
    async def handle_validation_error(
        request: Request,
        exc: ValidationError,
    ) -> JSONResponse:
        del request
        details_obj: object = json.loads(exc.json())
        return _error_response(
            "invalid_request",
            "Request payload did not match the public API schema.",
            status_code=422,
            details=details_obj,
        )

    @app.exception_handler(HTTPException)
    async def handle_http_exception(
        request: Request,
        exc: HTTPException,
    ) -> JSONResponse:
        del request
        detail = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return _error_response(
            _http_error_code(exc.status_code),
            detail,
            status_code=exc.status_code,
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(
        request: Request,
        exc: Exception,
    ) -> JSONResponse:
        logger.exception(
            "fastapi_unhandled_exception",
            path=request.url.path,
            error=str(exc),
        )
        return _error_response(
            "internal_error",
            "Something went wrong. Please try again.",
            status_code=500,
        )


def _register_observability_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def observability_middleware(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        started_at = perf_counter()
        tracer = get_http_tracer()
        status_code = 500

        with tracer.start_as_current_span("http.request") as span:
            span.set_attribute("http.method", request.method)

            try:
                response = await call_next(request)
            except Exception as exc:
                span.record_exception(exc)
                raise
            else:
                status_code = response.status_code
                return response
            finally:
                elapsed_ms = (perf_counter() - started_at) * 1000
                route_obj: object = request.scope.get("route")
                route_path_obj: object = getattr(route_obj, "path", request.url.path)
                route_path = (
                    route_path_obj
                    if isinstance(route_path_obj, str)
                    else request.url.path
                )
                span.set_attribute("http.route", route_path)
                span.set_attribute("http.status_code", status_code)
                record_http_request(
                    duration_ms=elapsed_ms,
                    method=request.method,
                    route=route_path,
                    status_code=status_code,
                )


def _public_api_response(response: PublicAPIResponse) -> JSONResponse:
    return _json_response(
        response.model_dump(mode="json"),
        status_code=_http_status_for_response(response),
    )


def _json_response(payload: object, status_code: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status_code, content=jsonable_encoder(payload))


def _error_response(
    code: str,
    message: str,
    *,
    status_code: int,
    details: object | None = None,
) -> JSONResponse:
    error_payload: dict[str, object] = {
        "code": code,
        "message": message,
    }
    if details is not None:
        error_payload["details"] = details
    return _json_response({"error": error_payload}, status_code=status_code)


def _contains_json_invalid_error(errors_obj: object) -> bool:
    if not isinstance(errors_obj, list):
        return False
    for item in errors_obj:
        if isinstance(item, dict) and item.get("type") == "json_invalid":
            return True
    return False


def _http_error_code(status_code: int) -> str:
    if status_code == 400:
        return "invalid_request"
    if status_code == 401:
        return "authentication_error"
    if status_code == 403:
        return "forbidden"
    if status_code == 404:
        return "not_found"
    if status_code == 409:
        return "already_exists"
    if status_code == 429:
        return "rate_limited"
    if status_code >= 500:
        return "internal_error"
    return "http_error"


def _get_runtime_api(request: Request) -> RuntimeAPI:
    return cast(RuntimeAPI, request.app.state.runtime_api)


def _get_settings_from_request(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def _get_db_from_request(request: Request) -> object:
    return cast(object, getattr(request.app.state, "db_client", None))


def _require_db_method(
    db: object, method_name: str
) -> Callable[..., Awaitable[object]]:
    method = getattr(db, method_name, None)
    if method is None or not callable(method):
        raise HTTPException(
            status_code=500,
            detail=f"Database adapter is missing required method: {method_name}.",
        )
    return cast(Callable[..., Awaitable[object]], method)


def _build_supabase_client(settings: Settings) -> SupabaseClient:
    dsn = settings.supabase_db_url.strip()
    if not dsn:
        raise RuntimeError("SUPABASE_DB_URL is required to run the HTTP service.")
    return SupabaseClient(dsn)


def _build_session_store(db: SupabaseClient | None = None) -> SessionStore:
    return create_session_store(db=db)


async def _call_optional_async(target: object, method_name: str) -> None:
    method = getattr(target, method_name, None)
    if method is None:
        return

    result = method()
    if inspect.isawaitable(result):
        await cast(Awaitable[object], result)


def _http_status_for_response(response: PublicAPIResponse) -> int:
    if response.success:
        return 200

    codes = {error.code for error in response.errors}

    if codes & {"invalid_input", "missing_required_field", "invalid_format"}:
        return 400
    if codes & {"authentication_error", "invalid_credentials"}:
        return 401
    if codes & {"not_found"}:
        return 404
    if codes & {"already_exists"}:
        return 409
    if codes & {"rate_limited"}:
        return 429
    if codes & {"timeout"}:
        return 504

    return 500


def _setup_logfire(settings: Settings) -> None:
    """Configure Logfire for pydantic-ai agent tracing (no-op if token not set)."""
    import os

    if not os.environ.get("LOGFIRE_TOKEN"):
        logger.debug("logfire_skipped", reason="LOGFIRE_TOKEN not set")
        return

    try:
        import logfire

        logfire.configure(
            service_name=settings.observability_service_name,
            service_version=settings.observability_service_version,
        )
        logfire.instrument_pydantic_ai()
        logger.info("logfire_configured", service=settings.observability_service_name)
    except ImportError:
        logger.debug("logfire_skipped", reason="logfire package not installed")


app = create_fastapi_app()


if __name__ == "__main__":
    main()
