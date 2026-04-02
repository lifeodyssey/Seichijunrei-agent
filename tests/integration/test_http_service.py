"""Integration smoke tests for HTTP conversation endpoints."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from aiohttp.test_utils import TestClient, TestServer

from config.settings import Settings
from infrastructure.session.memory import InMemorySessionStore
from interfaces.http_service import create_http_app
from interfaces.public_api import RuntimeAPI


def _build_db() -> MagicMock:
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.get_conversations = AsyncMock(
        return_value=[
            {
                "session_id": "sess-1",
                "title": "京吹の聖地",
                "first_query": "京吹の聖地を探して",
                "created_at": "2026-04-02T10:00:00Z",
                "updated_at": "2026-04-02T10:00:00Z",
            }
        ]
    )
    db.update_conversation_title = AsyncMock(return_value=True)
    db.upsert_session = AsyncMock()
    db.save_route = AsyncMock(return_value="route-1")
    db.search_points_by_location = AsyncMock(return_value=[])
    return db


async def test_get_conversations_smoke() -> None:
    db = _build_db()
    app = create_http_app(
        runtime_api=RuntimeAPI(db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    async with TestClient(TestServer(app)) as client:
        response = await client.get(
            "/v1/conversations",
            headers={"X-User-Id": "user-1"},
        )
        body = await response.json()

    assert response.status == 200
    assert body[0]["session_id"] == "sess-1"


async def test_patch_conversation_smoke() -> None:
    db = _build_db()
    app = create_http_app(
        runtime_api=RuntimeAPI(db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    async with TestClient(TestServer(app)) as client:
        response = await client.patch(
            "/v1/conversations/sess-1",
            json={"title": "新的标题"},
            headers={"X-User-Id": "user-1"},
        )
        body = await response.json()

    assert response.status == 200
    assert body == {"ok": True}
    db.update_conversation_title.assert_awaited_once_with(
        "sess-1",
        "新的标题",
        user_id="user-1",
    )
