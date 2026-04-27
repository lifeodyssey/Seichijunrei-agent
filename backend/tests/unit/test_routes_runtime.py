"""Unit tests for runtime, feedback, and conversation routes.

Covers: POST /v1/runtime, POST /v1/feedback,
        GET /v1/conversations, PATCH /v1/conversations/{session_id}.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import RuntimeAPI
from backend.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
    make_success_response,
)

# ---------------------------------------------------------------------------
# AC 2: POST /v1/runtime with valid request + mocked RuntimeAPI returns 200
# ---------------------------------------------------------------------------


async def test_runtime_post_with_valid_request_returns_200() -> None:
    mock_runtime = MagicMock(spec=RuntimeAPI)
    mock_runtime.handle = AsyncMock(return_value=make_success_response())
    mock_runtime._db = build_stub_db()
    mock_runtime._session_store = InMemorySessionStore()

    app, _ = build_app(runtime_api=mock_runtime)
    async with async_client(app) as client:
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
    app, _ = build_app()
    async with async_client(app) as client:
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
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.get(
            "/v1/conversations",
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# AC 5: POST /v1/runtime with empty text returns 422
# ---------------------------------------------------------------------------


async def test_runtime_post_with_empty_text_returns_422() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.post("/v1/runtime", json={"text": ""})

    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "invalid_request"


# ---------------------------------------------------------------------------
# AC 6: GET /v1/conversations without X-User-Id returns 400
# ---------------------------------------------------------------------------


async def test_conversations_get_without_user_id_returns_400() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
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
    mock_runtime._db = build_stub_db()
    mock_runtime._session_store = InMemorySessionStore()

    app, _ = build_app(runtime_api=mock_runtime)
    async with async_client(app) as client:
        resp = await client.post("/v1/runtime", json={"text": "京吹の聖地"})

    assert resp.status_code == 500
    body = resp.json()
    assert body["error"]["code"] == "internal_error"
    assert body["error"]["message"] == "Something went wrong. Please try again."


# ---------------------------------------------------------------------------
# AC 10: PATCH /v1/conversations/{session_id} returns 404 for nonexistent
# ---------------------------------------------------------------------------


async def test_patch_conversation_nonexistent_returns_404() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(return_value=None)
    app, _ = build_app(db=db)

    async with async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/nonexistent-session",
            json={"title": "New Title"},
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["message"] == "Conversation not found."
    db.session.update_conversation_title.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC 11: PATCH /v1/conversations/{session_id} returns 404 for wrong user
# ---------------------------------------------------------------------------


async def test_patch_conversation_wrong_user_returns_404() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(return_value={"user_id": "other-user"})
    app, _ = build_app(db=db)

    async with async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/some-session",
            json={"title": "New Title"},
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["message"] == "Conversation not found."
    db.session.update_conversation_title.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC 12: PATCH /v1/conversations/{session_id} returns 200 for valid update
# ---------------------------------------------------------------------------


async def test_patch_conversation_valid_returns_200() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(return_value={"user_id": "user-1"})
    db.session.update_conversation_title = AsyncMock(return_value=None)
    app, _ = build_app(db=db)

    async with async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/existing-session",
            json={"title": "New Title"},
            headers={"X-User-Id": "user-1"},
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    db.session.update_conversation_title.assert_awaited_once()


# ---------------------------------------------------------------------------
# _user_facing_error — maps raw exceptions to safe user messages
# ---------------------------------------------------------------------------


class TestUserFacingError:
    def test_maps_timeout_to_friendly_message(self) -> None:
        from backend.interfaces.routes.runtime import _user_facing_error

        result = _user_facing_error("httpx.ReadTimeout: timed out")
        assert "took too long" in result

    def test_maps_validation_to_friendly_message(self) -> None:
        from backend.interfaces.routes.runtime import _user_facing_error

        result = _user_facing_error("ValidationError: field required")
        assert "data processing error" in result

    def test_maps_rate_limit_to_friendly_message(self) -> None:
        from backend.interfaces.routes.runtime import _user_facing_error

        result = _user_facing_error("Rate limit exceeded for model")
        assert "busy" in result

    def test_returns_generic_for_unknown_error(self) -> None:
        from backend.interfaces.routes.runtime import _user_facing_error

        result = _user_facing_error("NullPointerException: kaboom")
        assert result == "Something went wrong. Please try again."
