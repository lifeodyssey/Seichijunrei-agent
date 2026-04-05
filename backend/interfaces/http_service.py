"""HTTP service adapter for the public runtime API."""

from __future__ import annotations

import inspect
import json
from collections.abc import AsyncIterator, Callable
from time import perf_counter
from typing import cast

import structlog
from aiohttp import web
from aiohttp.typedefs import Handler
from pydantic import ValidationError

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

_RUNTIME_API_KEY = web.AppKey("runtime_api", RuntimeAPI)
_SETTINGS_KEY = web.AppKey("settings", Settings)
_DB_KEY = web.AppKey("db_client", SupabaseClient)


def create_http_app(
    *,
    runtime_api: RuntimeAPI | None = None,
    settings: Settings | None = None,
    db: object | None = None,
    session_store: SessionStore | None = None,
) -> web.Application:
    """Build the HTTP service app for the runtime."""
    resolved_settings = settings or get_settings()

    # Logfire: auto-trace all pydantic-ai agent calls (non-invasive)
    _setup_logfire(resolved_settings)

    app = web.Application(middlewares=[_cors_middleware, _observability_middleware])
    app[_SETTINGS_KEY] = resolved_settings
    app.cleanup_ctx.append(_observability_context(resolved_settings))

    app.router.add_get("/", _handle_root)
    app.router.add_get("/healthz", _handle_health)
    app.router.add_post("/v1/runtime", _handle_runtime)
    app.router.add_post("/v1/runtime/stream", _handle_runtime_stream)
    app.router.add_get("/v1/conversations", _handle_get_conversations)
    app.router.add_patch("/v1/conversations/{session_id}", _handle_patch_conversation)
    app.router.add_post("/v1/feedback", _handle_feedback)

    if runtime_api is not None:
        app[_RUNTIME_API_KEY] = runtime_api
        fallback_db = getattr(runtime_api, "_db", None)
        resolved_db = db if db is not None else fallback_db
        if resolved_db is not None:
            app[_DB_KEY] = cast(SupabaseClient, resolved_db)
    else:
        app.cleanup_ctx.append(
            _runtime_context(
                settings=resolved_settings,
                db=db,
                session_store=session_store,
            )
        )

    return app


def main() -> None:
    """Run the HTTP service."""
    settings = get_settings()
    app = create_http_app(settings=settings)
    web.run_app(app, host=settings.service_host, port=settings.service_port)


async def _handle_root(request: web.Request) -> web.Response:
    settings = request.app[_SETTINGS_KEY]
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
    return web.json_response(payload)


async def _handle_health(request: web.Request) -> web.Response:
    runtime_api = request.app[_RUNTIME_API_KEY]
    settings = request.app[_SETTINGS_KEY]
    payload = {
        "status": "ok",
        "service": "seichijunrei-runtime",
        "app_env": settings.app_env,
        "observability_enabled": settings.observability_enabled,
        "db_adapter": type(getattr(runtime_api, "_db", None)).__name__,
        "session_store": type(getattr(runtime_api, "_session_store", None)).__name__,
    }
    return web.json_response(payload)


async def _handle_runtime(request: web.Request) -> web.Response:
    runtime_api = request.app[_RUNTIME_API_KEY]
    user_id = request.headers.get("X-User-Id") or None

    try:
        raw_payload = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response(
            {
                "error": {
                    "code": "invalid_json",
                    "message": "Request body must be valid JSON.",
                }
            },
            status=400,
        )

    try:
        api_request = PublicAPIRequest.model_validate(raw_payload)
    except ValidationError as exc:
        return web.json_response(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "Request payload did not match the public API schema.",
                    "details": json.loads(exc.json()),
                }
            },
            status=422,
        )

    response = await runtime_api.handle(api_request, user_id=user_id)
    return web.json_response(
        response.model_dump(mode="json"),
        status=_http_status_for_response(response),
        dumps=_json_dumps,
    )


async def _handle_runtime_stream(request: web.Request) -> web.StreamResponse:
    runtime_api = request.app[_RUNTIME_API_KEY]
    user_id = request.headers.get("X-User-Id") or None

    try:
        raw_payload = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response(
            {
                "error": {
                    "code": "invalid_json",
                    "message": "Request body must be valid JSON.",
                }
            },
            status=400,
        )

    try:
        api_request = PublicAPIRequest.model_validate(raw_payload)
    except ValidationError as exc:
        return web.json_response(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "Request payload did not match the public API schema.",
                    "details": json.loads(exc.json()),
                }
            },
            status=422,
        )

    resp = web.StreamResponse()
    resp.headers["Content-Type"] = "text/event-stream; charset=utf-8"
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["X-Accel-Buffering"] = "no"
    cors_origin = request.app[_SETTINGS_KEY].cors_allowed_origin
    resp.headers["Access-Control-Allow-Origin"] = cors_origin
    resp.headers["Access-Control-Allow-Credentials"] = "true"
    resp.headers["Access-Control-Allow-Headers"] = (
        "Content-Type, Authorization, X-User-Id"
    )

    await resp.prepare(request)

    async def emit(event: str, data: dict[str, object]) -> None:
        payload = json.dumps({"event": event, **data}, ensure_ascii=False)
        await resp.write(f"event: {event}\ndata: {payload}\n\n".encode())

    async def on_step(tool: str, status: str, data: dict[str, object]) -> None:
        await emit("step", {"tool": tool, "status": status, "data": data})

    try:
        await emit("planning", {"status": "running"})
        response = await runtime_api.handle(
            api_request, user_id=user_id, on_step=on_step
        )
        await emit("done", response.model_dump(mode="json"))
    except Exception as exc:
        await emit("error", {"message": str(exc)})
    finally:
        try:
            await resp.write_eof()
        except ConnectionResetError:
            pass

    return resp


def _json_dumps(obj: object) -> str:
    """JSON encoder that handles datetime and other non-standard types."""
    import datetime as dt

    def default(o: object) -> object:
        if isinstance(o, (dt.datetime, dt.date)):
            return o.isoformat()
        raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")

    return json.dumps(obj, default=default, ensure_ascii=False)


def _runtime_context(
    *,
    settings: Settings,
    db: object | None,
    session_store: SessionStore | None,
) -> Callable[[web.Application], AsyncIterator[None]]:
    async def context(app: web.Application) -> AsyncIterator[None]:
        runtime_db = db or _build_supabase_client(settings)
        runtime_session_store = session_store or _build_session_store()

        await _call_optional_async(runtime_db, "connect")
        app[_RUNTIME_API_KEY] = RuntimeAPI(
            runtime_db,
            session_store=runtime_session_store,
        )
        app[_DB_KEY] = cast(SupabaseClient, runtime_db)

        try:
            yield
        finally:
            await _call_optional_async(runtime_session_store, "close")
            await _call_optional_async(runtime_db, "close")

    return context


def _observability_context(
    settings: Settings,
) -> Callable[[web.Application], AsyncIterator[None]]:
    async def context(app: web.Application) -> AsyncIterator[None]:
        if settings.observability_enabled:
            setup_observability(settings)

        try:
            yield
        finally:
            if settings.observability_enabled:
                shutdown_observability()

    return context


@web.middleware
async def _cors_middleware(
    request: web.Request,
    handler: Handler,
) -> web.StreamResponse:
    """Allow cross-origin requests from the frontend dev server."""
    resp: web.StreamResponse
    if request.method == "OPTIONS":
        resp = web.Response(status=204)
    else:
        resp = await handler(request)
    if "Access-Control-Allow-Origin" not in resp.headers:
        origin = request.app[_SETTINGS_KEY].cors_allowed_origin
        resp.headers["Access-Control-Allow-Origin"] = origin
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = (
            "Content-Type, Authorization, X-User-Id"
        )
    return resp


@web.middleware
async def _observability_middleware(
    request: web.Request,
    handler: Handler,
) -> web.StreamResponse:
    started_at = perf_counter()
    tracer = get_http_tracer()
    status_code = 500

    with tracer.start_as_current_span("http.request") as span:
        span.set_attribute("http.method", request.method)
        span.set_attribute("http.route", request.path)

        try:
            response = await handler(request)
        except Exception as exc:
            span.record_exception(exc)
            raise
        else:
            status_code = response.status
            return response
        finally:
            elapsed_ms = (perf_counter() - started_at) * 1000
            span.set_attribute("http.status_code", status_code)
            record_http_request(
                duration_ms=elapsed_ms,
                method=request.method,
                route=request.path,
                status_code=status_code,
            )


def _build_supabase_client(settings: Settings) -> SupabaseClient:
    dsn = settings.supabase_db_url.strip()
    if not dsn:
        raise RuntimeError("SUPABASE_DB_URL is required to run the HTTP service.")
    return SupabaseClient(dsn)


def _build_session_store() -> SessionStore:
    return create_session_store()


async def _call_optional_async(target: object, method_name: str) -> None:
    method = getattr(target, method_name, None)
    if method is None:
        return

    result = method()
    if inspect.isawaitable(result):
        await result


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


async def _handle_get_conversations(request: web.Request) -> web.Response:
    """Return conversation history for the authenticated user."""
    user_id = request.headers.get("X-User-Id") or None
    if not user_id:
        return web.json_response(
            {
                "error": {
                    "code": "missing_user_id",
                    "message": "X-User-Id header required.",
                }
            },
            status=400,
        )

    db = request.app.get(_DB_KEY)
    get_conversations = getattr(db, "get_conversations", None)
    if get_conversations is None:
        return web.json_response([], dumps=_json_dumps)

    conversations = await get_conversations(user_id)
    return web.json_response(conversations, dumps=_json_dumps)


async def _handle_patch_conversation(request: web.Request) -> web.Response:
    """Rename a persisted conversation title."""
    user_id = request.headers.get("X-User-Id") or None
    if not user_id:
        return web.json_response(
            {
                "error": {
                    "code": "missing_user_id",
                    "message": "X-User-Id header required.",
                }
            },
            status=400,
        )

    try:
        payload = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response(
            {"error": {"code": "invalid_json", "message": "Invalid JSON."}},
            status=400,
        )

    title = str(payload.get("title", "")).strip()
    if not title:
        return web.json_response(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "title must be a non-empty string.",
                }
            },
            status=422,
        )

    db = request.app.get(_DB_KEY)
    update_conversation_title = getattr(db, "update_conversation_title", None)
    if update_conversation_title is not None:
        await update_conversation_title(
            request.match_info["session_id"],
            title,
            user_id=user_id,
        )

    return web.json_response({"ok": True}, dumps=_json_dumps)


async def _handle_feedback(request: web.Request) -> web.Response:
    """Store user feedback (thumbs up/down) for a response."""
    try:
        body = await request.json()
    except (json.JSONDecodeError, ValueError):
        return web.json_response(
            {"error": {"code": "invalid_json", "message": "Invalid JSON."}},
            status=400,
        )

    rating = body.get("rating")
    if rating not in ("good", "bad"):
        return web.json_response(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "rating must be 'good' or 'bad'.",
                }
            },
            status=422,
        )

    query_text = body.get("query_text", "")
    if not query_text:
        return web.json_response(
            {
                "error": {
                    "code": "invalid_request",
                    "message": "query_text is required.",
                }
            },
            status=422,
        )

    db: SupabaseClient = request.app[_DB_KEY]
    feedback_id = await db.save_feedback(
        session_id=body.get("session_id"),
        query_text=query_text,
        intent=body.get("intent"),
        rating=rating,
        comment=body.get("comment"),
    )
    return web.json_response({"feedback_id": feedback_id})


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


if __name__ == "__main__":
    main()
