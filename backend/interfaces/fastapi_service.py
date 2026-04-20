"""FastAPI app factory — route handlers live in ``backend.interfaces.routes``."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config.settings import Settings, get_settings
from backend.infrastructure.migrations.runner import MigrationRunner
from backend.infrastructure.observability import (
    setup_observability,
    shutdown_observability,
)
from backend.infrastructure.session import SessionStore
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.public_api import RuntimeAPI
from backend.interfaces.routes._deps import (  # noqa: F401
    _contains_json_invalid_error,
    _http_error_code,
    build_session_store,
    build_supabase_client,
    call_optional_async,
    setup_logfire,
)
from backend.interfaces.routes._middleware import (
    register_exception_handlers,
    register_observability_middleware,
)
from backend.interfaces.routes.bangumi import router as bangumi_router
from backend.interfaces.routes.conversations import router as conversations_router
from backend.interfaces.routes.feedback import router as feedback_router
from backend.interfaces.routes.health import router as health_router
from backend.interfaces.routes.runtime import router as runtime_router

# Re-export _call_optional_async for test backward compatibility.
_call_optional_async = call_optional_async


def create_fastapi_app(
    *,
    runtime_api: RuntimeAPI | None = None,
    settings: Settings | None = None,
    db: object | None = None,
    session_store: SessionStore | None = None,
) -> FastAPI:
    """Build the FastAPI service app for the runtime."""
    resolved_settings = settings or get_settings()
    setup_logfire(resolved_settings)

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
        runtime_db = db if db is not None else build_supabase_client(resolved_settings)
        if session_store is not None:
            runtime_session_store = session_store
        elif isinstance(runtime_db, SupabaseClient):
            runtime_session_store = build_session_store(runtime_db)
        else:
            raise RuntimeError(
                "create_fastapi_app(..., db=...) requires session_store"
                " for non-Supabase db adapters."
            )
        await call_optional_async(runtime_db, "connect")
        migrations_dir = Path(__file__).parents[2] / "supabase" / "migrations"
        if isinstance(runtime_db, SupabaseClient):
            runner = MigrationRunner(
                runtime_db.pool,
                migrations_dir,
                enabled=resolved_settings.auto_migrate,
            )
            await runner.run()
        app.state.runtime_api = RuntimeAPI(
            runtime_db, session_store=runtime_session_store
        )
        app.state.db_client = runtime_db
        try:
            yield
        finally:
            await call_optional_async(runtime_session_store, "close")
            await call_optional_async(runtime_db, "close")
            if resolved_settings.observability_enabled:
                shutdown_observability()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[resolved_settings.cors_allowed_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-User-Id", "X-User-Type"],
    )
    register_exception_handlers(app)
    register_observability_middleware(app)
    app.include_router(health_router)
    app.include_router(runtime_router)
    app.include_router(feedback_router)
    app.include_router(conversations_router)
    app.include_router(bangumi_router)
    return app


app = create_fastapi_app()


def main() -> None:
    """Run the FastAPI service."""
    settings = get_settings()
    uvicorn.run(app, host=settings.service_host, port=settings.service_port)


if __name__ == "__main__":
    main()
