"""Shared fixtures for FastAPI service tests.

Imported by test_routes_health, test_routes_runtime, test_routes_data.
Not a conftest.py to avoid polluting other unit tests with these fixtures.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from backend.config.settings import Settings
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.fastapi_service import create_fastapi_app
from backend.interfaces.public_api import RuntimeAPI
from backend.interfaces.schemas import PublicAPIResponse


def build_stub_db() -> MagicMock:
    db = MagicMock()
    db.get_conversations = AsyncMock(return_value=[])
    db.get_conversation = AsyncMock(return_value={"user_id": "user-1"})
    db.get_messages = AsyncMock(return_value=[])
    db.get_user_routes = AsyncMock(return_value=[])
    db.save_feedback = AsyncMock(return_value="fb-001")
    db.update_conversation_title = AsyncMock(return_value=None)
    return db


def make_success_response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        message="Found 3 locations.",
    )


def inject_state(
    app: FastAPI,
    settings: Settings,
    runtime_api: RuntimeAPI | MagicMock,
    db: MagicMock,
) -> None:
    app.state.settings = settings
    app.state.runtime_api = runtime_api
    app.state.db_client = db


def build_app(
    *,
    runtime_api: RuntimeAPI | MagicMock | None = None,
    db: MagicMock | None = None,
    settings: Settings | None = None,
) -> tuple[FastAPI, MagicMock]:
    mock_db = db or build_stub_db()
    resolved_settings = settings or Settings()
    if runtime_api is None:
        runtime_api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

    app = create_fastapi_app(
        runtime_api=runtime_api,
        settings=resolved_settings,
        db=mock_db,
    )
    inject_state(app, resolved_settings, runtime_api, mock_db)
    return app, mock_db


def async_client(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(
        app=app,
        raise_app_exceptions=False,
    )
    return httpx.AsyncClient(transport=transport, base_url="http://test")
