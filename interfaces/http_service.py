"""HTTP service adapter for the public runtime API."""

from __future__ import annotations

import inspect
import json
from time import perf_counter
from typing import Any

from aiohttp import web
from pydantic import ValidationError

from config.settings import Settings, get_settings
from infrastructure.observability import (
    get_http_tracer,
    record_http_request,
    setup_observability,
    shutdown_observability,
)
from infrastructure.session import SessionStore, create_session_store
from infrastructure.supabase.client import SupabaseClient
from interfaces.public_api import PublicAPIRequest, PublicAPIResponse, RuntimeAPI

_RUNTIME_API_KEY = web.AppKey("runtime_api", RuntimeAPI)
_SETTINGS_KEY = web.AppKey("settings", Settings)


def create_http_app(
    *,
    runtime_api: RuntimeAPI | None = None,
    settings: Settings | None = None,
    db: Any | None = None,
    session_store: SessionStore | None = None,
) -> web.Application:
    """Build the HTTP service app for the runtime."""
    app = web.Application(middlewares=[_observability_middleware])
    app[_SETTINGS_KEY] = settings or get_settings()
    app.cleanup_ctx.append(_observability_context(app[_SETTINGS_KEY]))

    app.router.add_get("/healthz", _handle_health)
    app.router.add_post("/v1/runtime", _handle_runtime)

    if runtime_api is not None:
        app[_RUNTIME_API_KEY] = runtime_api
    else:
        app.cleanup_ctx.append(
            _runtime_context(
                settings=app[_SETTINGS_KEY],
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

    response = await runtime_api.handle(api_request)
    return web.json_response(
        response.model_dump(mode="json"),
        status=_http_status_for_response(response),
    )


def _runtime_context(
    *,
    settings: Settings,
    db: Any | None,
    session_store: SessionStore | None,
):
    async def context(app: web.Application):
        runtime_db = db or _build_supabase_client(settings)
        runtime_session_store = session_store or _build_session_store(settings)

        await _call_optional_async(runtime_db, "connect")
        app[_RUNTIME_API_KEY] = RuntimeAPI(
            runtime_db,
            session_store=runtime_session_store,
        )

        try:
            yield
        finally:
            await _call_optional_async(runtime_session_store, "close")
            await _call_optional_async(runtime_db, "close")

    return context


def _observability_context(settings: Settings):
    async def context(app: web.Application):
        if settings.observability_enabled:
            setup_observability(settings)

        try:
            yield
        finally:
            if settings.observability_enabled:
                shutdown_observability()

    return context


@web.middleware
async def _observability_middleware(
    request: web.Request,
    handler: web.Handler,
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


def _build_session_store(settings: Settings) -> SessionStore:
    if settings.session_store_backend == "memory":
        return create_session_store("memory")
    if settings.session_store_backend == "redis":
        return create_session_store(
            "redis",
            host=settings.redis_session_host,
            port=settings.redis_session_port,
            db=settings.redis_session_db,
            password=settings.redis_session_password,
            prefix=settings.redis_session_prefix,
            ttl_seconds=settings.session_ttl_seconds,
        )
    return create_session_store(
        "firestore",
        project_id=settings.google_cloud_project,
        collection_name=settings.firestore_session_collection,
    )


async def _call_optional_async(target: Any, method_name: str) -> None:
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
    if "invalid_input" in codes:
        return 400
    if "internal_error" in codes or "pipeline_error" in codes:
        return 500
    return 200


if __name__ == "__main__":
    main()
