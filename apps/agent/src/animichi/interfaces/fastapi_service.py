"""FastAPI app factory — route handlers live in ``animichi.interfaces.routes``."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import cast

import httpx
import structlog
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from animichi.agents.base import build_model_http_client
from animichi.clients.catalog_client import CatalogClient
from animichi.config.settings import Settings, get_settings
from animichi.infrastructure.gateways.geocoding import aclose_geocoding_client
from animichi.infrastructure.memory import postgres_memory_store
from animichi.infrastructure.persistence.database import create_database_lifecycle
from animichi.infrastructure.persistence.repositories.composite import (
    PersistenceRepos,
)
from animichi.infrastructure.session import SessionStore
from animichi.infrastructure.session.cached_session_store import SessionStateStore
from animichi.interfaces.outbox_drain import (
    DEFAULT_OUTBOX_DRAIN_INTERVAL,
    _outbox_drain_loop,
    _run_startup_outbox_drain,
)
from animichi.interfaces.public_api import RuntimeAPI
from animichi.interfaces.routes._deps import (  # noqa: F401
    _contains_json_invalid_error,
    _http_error_code,
    build_session_store,
    call_optional_async,
    setup_logfire,
)
from animichi.interfaces.routes._middleware import (
    register_credential_stripping_middleware,
    register_exception_handlers,
    register_observability_middleware,
)
from animichi.interfaces.routes.admission import build_startup_turn_outcome
from animichi.interfaces.routes.adopt_sessions import (
    router as adopt_sessions_router,
)
from animichi.interfaces.routes.bangumi import router as bangumi_router
from animichi.interfaces.routes.byok import router as byok_router
from animichi.interfaces.routes.chat import router as chat_router
from animichi.interfaces.routes.conversations import router as conversations_router
from animichi.interfaces.routes.feedback import router as feedback_router
from animichi.interfaces.routes.health import router as health_router
from animichi.interfaces.routes.photo_search import router as photo_search_router
from animichi.interfaces.routes.search_preview import router as search_preview_router
from animichi.utils.logger import configure_structlog

logger = structlog.get_logger(__name__)

# Re-export _call_optional_async for test backward compatibility.
_call_optional_async = call_optional_async


async def _run_startup_sweep(runtime_db: object) -> None:
    """Best-effort demand-driven sweep on Agent startup (TURN-3 #951)."""
    try:
        await build_startup_turn_outcome(runtime_db).sweep()
    except Exception:
        logger.warning("startup_sweep_failed", exc_info=True)


def build_catalog_client(settings: Settings) -> CatalogClient:
    """Construct the shared Catalog read-path client from settings."""
    return CatalogClient(base_url=settings.catalog_api_url)


@asynccontextmanager
async def _lifespan_with_runtime_api(
    app: FastAPI,
    runtime_api: RuntimeAPI,
    db: object | None,
    model_http_client: httpx.AsyncClient,
) -> AsyncIterator[None]:
    """Lifespan branch: runtime_api provided externally (test / injection)."""
    runtime_api.bind_model_http_client(model_http_client)
    app.state.runtime_api = runtime_api
    resolved_db = db if db is not None else getattr(runtime_api, "_db", None)
    if resolved_db is not None:
        app.state.db_client = resolved_db
        await _run_startup_sweep(resolved_db)
        await _run_startup_outbox_drain(resolved_db, cast(Settings, app.state.settings))
    try:
        yield
    finally:
        await aclose_geocoding_client()


def _resolve_session_store(
    session_store: SessionStore | None,
    session_repo: SessionStateStore | None,
) -> SessionStore:
    """Resolve the session store from the provided store or the SQLModel
    session repository (#994)."""
    if session_store is not None:
        return session_store
    if session_repo is not None:
        return build_session_store(session_repo)
    raise RuntimeError("create_fastapi_app requires session_store for db adapters")


async def _close_stores(
    runtime_session_store: SessionStore,
    runtime_db: object,
) -> None:
    """Close session store then db; both attempts run."""
    try:
        await call_optional_async(runtime_session_store, "close")
    finally:
        await call_optional_async(runtime_db, "close")


@asynccontextmanager
async def _lifespan_build_runtime(
    app: FastAPI,
    resolved_settings: Settings,
    db: object | None,
    session_store: SessionStore | None,
    model_http_client: httpx.AsyncClient,
) -> AsyncIterator[None]:
    """Lifespan branch: build RuntimeAPI from scratch (normal startup)."""
    # The lifespan owns the single async engine + session factory (#994) and
    # composes every SQLModel repository over it (#995). An explicitly
    # injected ``db`` (test doubles) means the caller owns the database
    # surface: the lifecycle is skipped and the locator path stays.
    persistence = (
        create_database_lifecycle(resolved_settings.database_url)
        if db is None
        else None
    )
    runtime_db = (
        PersistenceRepos.build(persistence.sessionmaker)
        if persistence is not None
        else db
    )
    if runtime_db is None:
        raise RuntimeError("a db adapter is required to build the runtime")
    session_repo = (
        runtime_db.session if isinstance(runtime_db, PersistenceRepos) else None
    )
    turn_store = (
        runtime_db.turn_reservation
        if isinstance(runtime_db, PersistenceRepos)
        else None
    )
    runtime_session_store = _resolve_session_store(session_store, session_repo)
    # Schema changes are never applied by the application. Neon catalog/user
    # migrations run through Atlas from migrations/neon; see docs/ops/migrations.md.
    catalog_client = build_catalog_client(resolved_settings)
    app.state.catalog_client = catalog_client
    app.state.persistence = persistence
    app.state.session_repo = session_repo
    app.state.turn_store = turn_store
    app.state.runtime_api = RuntimeAPI(
        runtime_db,
        session_store=runtime_session_store,
        session_repo=session_repo,
        turn_store=turn_store,
        catalog=catalog_client,
        settings=resolved_settings,
        model_http_client=model_http_client,
        memory_store=postgres_memory_store(runtime_db),
    )
    app.state.db_client = runtime_db
    # Startup sweep runs in the background (not readiness-gating, issue #694);
    # a failed sweep logs and is retried by the next admission sweep (TURN-3).
    startup_sweep_task = asyncio.create_task(_run_startup_sweep(runtime_db))
    app.state.startup_sweep_task = startup_sweep_task
    outbox_drain_loop: asyncio.Task[None] | None = None
    if isinstance(runtime_db, PersistenceRepos):
        startup_outbox_drain_task = asyncio.create_task(
            _run_startup_outbox_drain(runtime_db, resolved_settings)
        )
        app.state.startup_outbox_drain_task = startup_outbox_drain_task
        outbox_drain_loop = asyncio.create_task(
            _outbox_drain_loop(
                runtime_db, resolved_settings, DEFAULT_OUTBOX_DRAIN_INTERVAL
            )
        )
        app.state.outbox_drain_loop = outbox_drain_loop
    try:
        yield
    finally:
        if outbox_drain_loop is not None:
            outbox_drain_loop.cancel()
        try:
            await startup_sweep_task
        finally:
            try:
                await _close_stores(runtime_session_store, runtime_db)
            finally:
                try:
                    await catalog_client.aclose()
                finally:
                    try:
                        await aclose_geocoding_client()
                    finally:
                        if persistence is not None:
                            await persistence.close()


def create_fastapi_app(
    *,
    runtime_api: RuntimeAPI | None = None,
    settings: Settings | None = None,
    db: object | None = None,
    session_store: SessionStore | None = None,
) -> FastAPI:
    """Build the FastAPI service app for the runtime."""
    configure_structlog()
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = resolved_settings
        model_http_client = build_model_http_client(resolved_settings)
        app.state.model_http_client = model_http_client
        try:
            if runtime_api is not None:
                async with _lifespan_with_runtime_api(
                    app, runtime_api, db, model_http_client
                ):
                    yield
                return
            async with _lifespan_build_runtime(
                app,
                resolved_settings,
                db,
                session_store,
                model_http_client,
            ):
                yield
        finally:
            await model_http_client.aclose()

    app = FastAPI(lifespan=lifespan)
    setup_logfire(resolved_settings, app=app)
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
            "x-session-id",
            "x-locale",
            "x-byok-endpoint",
            # The actual BYOK headers byok-storage.ts (#467) sends. Without
            # these, browser CORS preflight rejects them before the request
            # ever reaches this container — this PR is the point where the
            # container-side header contract is established, so it belongs
            # here rather than waiting on Task 3.
            "X-BYOK-Provider",
            "X-BYOK-Key",
            "X-BYOK-Model",
            "X-BYOK-Base-Url",
        ],
    )
    register_exception_handlers(app)
    register_observability_middleware(app)
    # Registered last (= Starlette's outermost middleware — see rev4 P1-4 in
    # the BYOK spec, Task 2): must wrap observability_middleware and the
    # exception handlers above, so nothing downstream ever sees a raw BYOK
    # credential or Authorization header.
    register_credential_stripping_middleware(app)
    app.include_router(health_router)
    app.include_router(chat_router)
    app.include_router(byok_router)
    app.include_router(feedback_router)
    app.include_router(conversations_router)
    app.include_router(bangumi_router)
    app.include_router(search_preview_router)
    app.include_router(photo_search_router)
    app.include_router(adopt_sessions_router)
    return app


app = create_fastapi_app()


def main() -> None:
    """Run the FastAPI service."""
    settings = get_settings()
    uvicorn.run(app, host=settings.service_host, port=settings.service_port)


if __name__ == "__main__":
    main()
