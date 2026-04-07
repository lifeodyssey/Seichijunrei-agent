"""Focused unit tests for FastAPI adapter helper paths.

These tests intentionally target the low-coverage branches in
`backend/interfaces/fastapi_service.py` so the full cutover keeps the
repository-wide coverage gate green.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.config.settings import Settings
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.fastapi_service import (
    _call_optional_async,
    _contains_json_invalid_error,
    _http_error_code,
    _require_db_method,
    create_fastapi_app,
)
from backend.interfaces.public_api import RuntimeAPI


class _MissingConversationDb:
    async def get_messages(self, session_id: str) -> list[dict[str, object]]:
        return []


class _MissingRoutesDb:
    async def get_conversations(self, user_id: str) -> list[dict[str, object]]:
        return []


@pytest.fixture
def mock_db() -> MagicMock:
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.get_conversations = AsyncMock(return_value=[])
    db.get_conversation = AsyncMock(return_value={"user_id": "user-1"})
    db.get_messages = AsyncMock(return_value=[])
    db.get_user_routes = AsyncMock(return_value=[])
    db.save_feedback = AsyncMock(return_value="feedback-1")
    return db


def test_root_endpoint_returns_service_info(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.get("/")

    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "seichijunrei-runtime"
    assert body["endpoints"]["healthz"] == "/healthz"


def test_missing_user_header_returns_structured_invalid_request_error_on_conversations(
    mock_db: MagicMock,
) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.get("/v1/conversations")

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "invalid_request"
    assert body["error"]["message"] == "X-User-Id header required."


def test_messages_route_returns_structured_404_when_ownership_mismatch(
    mock_db: MagicMock,
) -> None:
    mock_db.get_conversation.return_value = {"user_id": "someone-else"}
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.get(
            "/v1/conversations/sess-1/messages",
            headers={"X-User-Id": "user-1"},
        )

    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "not_found"


def test_missing_db_method_fails_fast_on_routes_endpoint() -> None:
    db = _MissingRoutesDb()
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(db, session_store=InMemorySessionStore()),
        settings=Settings(),
        db=db,
    )

    with TestClient(app) as client:
        response = client.get("/v1/routes", headers={"X-User-Id": "user-1"})

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"


def test_feedback_validation_rejects_blank_query_text(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/feedback",
            json={"rating": "good", "query_text": "   "},
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_request"


def test_feedback_validation_rejects_invalid_rating(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/feedback",
            json={"rating": "great", "query_text": "京吹"},
        )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "invalid_request"


def test_feedback_success_persists(mock_db: MagicMock) -> None:
    app = create_fastapi_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/feedback",
            json={"rating": "good", "query_text": "京吹", "intent": "search_bangumi"},
        )

    assert response.status_code == 200
    assert response.json() == {"feedback_id": "feedback-1"}


def test_sse_stream_returns_structured_error_event_on_runtime_failure(
    mock_db: MagicMock,
) -> None:
    runtime_api = MagicMock()
    runtime_api.handle = AsyncMock(side_effect=RuntimeError("boom"))
    app = create_fastapi_app(runtime_api=runtime_api, settings=Settings())

    with TestClient(app) as client:
        with client.stream(
            "POST",
            "/v1/runtime/stream",
            json={"text": "京吹"},
            headers={"X-User-Id": "user-1"},
        ) as response:
            body = "".join(response.iter_text())

    assert response.status_code == 200
    assert "event: error" in body
    assert '"code": "internal_error"' in body


def test_http_error_code_maps_404() -> None:
    assert _http_error_code(404) == "not_found"


def test_http_error_code_maps_503_to_internal_error() -> None:
    assert _http_error_code(503) == "internal_error"


def test_contains_json_invalid_error_detects_json_invalid() -> None:
    errors_obj = [{"type": "json_invalid"}]
    assert _contains_json_invalid_error(errors_obj) is True


def test_contains_json_invalid_error_returns_false_for_other_types() -> None:
    errors_obj = [{"type": "missing"}]
    assert _contains_json_invalid_error(errors_obj) is False


def test_require_db_method_returns_callable() -> None:
    class _Db:
        async def get_messages(self, session_id: str) -> list[dict[str, object]]:
            return []

    method = _require_db_method(_Db(), "get_messages")
    assert callable(method)


def test_require_db_method_raises_http_exception_for_missing_method() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _require_db_method(object(), "missing")
    assert exc_info.value.status_code == 500


@pytest.mark.asyncio
async def test_call_optional_async_awaits_async_method() -> None:
    target = SimpleNamespace(close=AsyncMock())
    await _call_optional_async(target, "close")
    target.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_call_optional_async_ignores_missing_method() -> None:
    target = SimpleNamespace()
    await _call_optional_async(target, "close")
