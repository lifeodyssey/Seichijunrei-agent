"""Unit tests for health, CORS, and app state routes.

Covers: GET /healthz, CORS middleware, create_fastapi_app state.
"""

from __future__ import annotations

from backend.config.settings import Settings
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import RuntimeAPI
from backend.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)

# ---------------------------------------------------------------------------
# AC 1: GET /healthz returns 200 with {status, service} shape
# ---------------------------------------------------------------------------


async def test_healthz_returns_ok_with_status_and_service() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get("/healthz")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "seichijunrei-runtime"


# ---------------------------------------------------------------------------
# AC 8: CORS middleware allows configured origin
# ---------------------------------------------------------------------------


async def test_cors_middleware_allows_configured_origin() -> None:
    settings = Settings(cors_allowed_origin="https://seichijunrei.com")
    app, _ = build_app(settings=settings)
    async with async_client(app) as client:
        resp = await client.options(
            "/v1/runtime",
            headers={
                "Origin": "https://seichijunrei.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "Content-Type,X-User-Id",
            },
        )

    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://seichijunrei.com"
    assert "POST" in resp.headers.get("access-control-allow-methods", "")


# ---------------------------------------------------------------------------
# AC 9: create_fastapi_app sets app.state correctly
# ---------------------------------------------------------------------------


async def test_app_state_accessible_when_injected() -> None:
    mock_db = build_stub_db()
    runtime_api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
    settings = Settings(app_env="testing")

    app, _ = build_app(runtime_api=runtime_api, db=mock_db, settings=settings)

    async with async_client(app) as client:
        resp = await client.get("/healthz")

    assert resp.status_code == 200
    assert app.state.runtime_api is runtime_api
    assert app.state.settings is settings
    assert app.state.db_client is mock_db
