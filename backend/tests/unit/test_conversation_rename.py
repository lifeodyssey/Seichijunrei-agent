"""Unit tests for PATCH /v1/conversations/{session_id} title rename.

Covers: successful update, empty title validation, nonexistent session.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

from backend.tests.unit.conftest_fastapi import (
    async_client,
    build_app,
    build_stub_db,
)

_AUTH_HEADERS = {"X-User-Id": "user-1", "X-User-Type": "authenticated"}


async def test_patch_conversation_title_updates_db() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(
        return_value={"user_id": "user-1", "session_id": "s-1"}
    )
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/s-1",
            json={"title": "My Trip to Kyoto"},
            headers=_AUTH_HEADERS,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body == {"ok": True}
    db.session.update_conversation_title.assert_awaited_once_with(
        "s-1", "My Trip to Kyoto", user_id="user-1"
    )


async def test_patch_empty_title_returns_422() -> None:
    app, _ = build_app()
    async with async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/s-1",
            json={"title": "   "},
            headers=_AUTH_HEADERS,
        )

    assert resp.status_code == 422


async def test_patch_nonexistent_session_returns_404() -> None:
    db = build_stub_db()
    db.session.get_conversation = AsyncMock(return_value=None)
    app, _ = build_app(db=db)
    async with async_client(app) as client:
        resp = await client.patch(
            "/v1/conversations/no-such-id",
            json={"title": "New Title"},
            headers=_AUTH_HEADERS,
        )

    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "not_found"
