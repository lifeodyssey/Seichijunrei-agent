"""Unit tests for FastAPI service route handlers.

Covers every route, exception handler, CORS config, and app.state setup
using httpx.AsyncClient with mocked RuntimeAPI and DB dependencies.
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


def _build_stub_db() -> MagicMock:
    db = MagicMock()
    db.get_conversations = AsyncMock(return_value=[])
    db.get_conversation = AsyncMock(return_value={"user_id": "user-1"})
    db.get_messages = AsyncMock(return_value=[])
    db.get_user_routes = AsyncMock(return_value=[])
    db.save_feedback = AsyncMock(return_value="fb-001")
    db.update_conversation_title = AsyncMock(return_value=None)
    return db


def _make_success_response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        message="Found 3 locations.",
    )


def _inject_state(
    app: FastAPI,
    settings: Settings,
    runtime_api: RuntimeAPI | MagicMock,
    db: MagicMock,
) -> None:
    """Lifespan is not triggered by ASGITransport; state is injected manually."""
    app.state.settings = settings
    app.state.runtime_api = runtime_api
    app.state.db_client = db


def _build_app(
    *,
    runtime_api: RuntimeAPI | MagicMock | None = None,
    db: MagicMock | None = None,
    settings: Settings | None = None,
) -> tuple[FastAPI, MagicMock]:
    """Build a FastAPI app with manually injected state for testing.

    Lifespan is not triggered by ASGITransport; state is injected manually.
    """
    mock_db = db or _build_stub_db()
    resolved_settings = settings or Settings()
    if runtime_api is None:
        runtime_api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

    app = create_fastapi_app(
        runtime_api=runtime_api,
        settings=resolved_settings,
        db=mock_db,
    )
    _inject_state(app, resolved_settings, runtime_api, mock_db)
    return app, mock_db


def _async_client(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(
        app=app,
        raise_app_exceptions=False,
    )
    return httpx.AsyncClient(transport=transport, base_url="http://test")


# ---------------------------------------------------------------------------
# AC 1: GET /healthz returns 200 with {status, service} shape
# ---------------------------------------------------------------------------


async def test_healthz_returns_ok_with_status_and_service() -> None:
    app, _ = _build_app()
    async with _async_client(app) as client:
        resp = await client.get("/healthz")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "seichijunrei-runtime"


# ---------------------------------------------------------------------------
# AC 2: POST /v1/runtime with valid request + mocked RuntimeAPI returns 200
# ---------------------------------------------------------------------------


async def test_runtime_post_with_valid_request_returns_200() -> None:
    mock_runtime = MagicMock(spec=RuntimeAPI)
    mock_runtime.handle = AsyncMock(return_value=_make_success_response())
    mock_runtime._db = _build_stub_db()
    mock_runtime._session_store = InMemorySessionStore()

    app, _ = _build_app(runtime_api=mock_runtime)
    async with _async_client(app) as client:
        resp = await client.post("/v1/runtime", json={"text": "京吹の聖地"})

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body["intent"] == "search_bangumi"
    mock_runtime.handle.assert_awaited_once()


# ---------------------------------------------------------------------------
# AC 3: POST /v1/feedback with valid payload returns 200
# ---------------------------------------------------------------------------


async def test_feedback_post_with_valid_payload_returns_200() -> None:
    app, _ = _build_app()
    async with _async_client(app) as client:
        resp = await client.post(
            "/v1/feedback",
            json={"query_text": "京吹", "rating": "good"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert "feedback_id" in body


# ---------------------------------------------------------------------------
# AC 4: GET /v1/conversations with X-User-Id returns 200
# ---------------------------------------------------------------------------


async def test_conversations_get_with_user_id_returns_200() -> None:
    app, _ = _build_app()
    async with _async_client(app) as client:
        resp = await client.get(
            "/v1/conversations",
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# AC 5: POST /v1/runtime with empty text returns 422
# ---------------------------------------------------------------------------


async def test_runtime_post_with_empty_text_returns_422() -> None:
    app, _ = _build_app()
    async with _async_client(app) as client:
        resp = await client.post("/v1/runtime", json={"text": ""})

    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "invalid_request"


# ---------------------------------------------------------------------------
# AC 6: GET /v1/conversations without X-User-Id returns 400
# ---------------------------------------------------------------------------


async def test_conversations_get_without_user_id_returns_400() -> None:
    app, _ = _build_app()
    async with _async_client(app) as client:
        resp = await client.get("/v1/conversations")

    assert resp.status_code == 400
    body = resp.json()
    assert body["error"]["code"] == "invalid_request"
    assert "X-User-Id" in body["error"]["message"]


# ---------------------------------------------------------------------------
# AC 7: Unhandled exception returns 500
# ---------------------------------------------------------------------------


async def test_unhandled_exception_returns_500() -> None:
    mock_runtime = MagicMock(spec=RuntimeAPI)
    mock_runtime.handle = AsyncMock(side_effect=RuntimeError("unexpected boom"))
    mock_runtime._db = _build_stub_db()
    mock_runtime._session_store = InMemorySessionStore()

    app, _ = _build_app(runtime_api=mock_runtime)
    async with _async_client(app) as client:
        resp = await client.post("/v1/runtime", json={"text": "京吹の聖地"})

    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "internal_error"
    assert body["error"]["message"] == "Something went wrong. Please try again."


# ---------------------------------------------------------------------------
# AC 8: CORS middleware allows configured origin
# ---------------------------------------------------------------------------


async def test_cors_middleware_allows_configured_origin() -> None:
    settings = Settings(cors_allowed_origin="https://seichijunrei.com")
    app, _ = _build_app(settings=settings)
    async with _async_client(app) as client:
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
    """Verify routes can read app.state after _inject_state.

    ASGITransport does not trigger FastAPI lifespan, so state must be
    injected manually via _inject_state before the first request.
    """
    mock_db = _build_stub_db()
    runtime_api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
    settings = Settings(app_env="testing")

    app, _ = _build_app(runtime_api=runtime_api, db=mock_db, settings=settings)

    async with _async_client(app) as client:
        resp = await client.get("/healthz")

    assert resp.status_code == 200
    assert app.state.runtime_api is runtime_api
    assert app.state.settings is settings
    assert app.state.db_client is mock_db


# ---------------------------------------------------------------------------
# AC 10: PATCH /v1/conversations/{session_id} returns 404 for nonexistent
# ---------------------------------------------------------------------------


async def test_patch_conversation_nonexistent_returns_404() -> None:
    db = _build_stub_db()
    db.get_conversation = AsyncMock(return_value=None)
    app, _ = _build_app(db=db)

    async with _async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/nonexistent-session",
            json={"title": "New Title"},
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["message"] == "Conversation not found."
    db.update_conversation_title.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC 11: PATCH /v1/conversations/{session_id} returns 404 for wrong user
# ---------------------------------------------------------------------------


async def test_patch_conversation_wrong_user_returns_404() -> None:
    db = _build_stub_db()
    db.get_conversation = AsyncMock(return_value={"user_id": "other-user"})
    app, _ = _build_app(db=db)

    async with _async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/some-session",
            json={"title": "New Title"},
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["message"] == "Conversation not found."
    db.update_conversation_title.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC 12: PATCH /v1/conversations/{session_id} returns 200 for valid update
# ---------------------------------------------------------------------------


async def test_patch_conversation_valid_returns_200() -> None:
    db = _build_stub_db()
    db.get_conversation = AsyncMock(return_value={"user_id": "user-1"})
    db.update_conversation_title = AsyncMock(return_value=None)
    app, _ = _build_app(db=db)

    async with _async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/existing-session",
            json={"title": "New Title"},
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    db.update_conversation_title.assert_awaited_once()
