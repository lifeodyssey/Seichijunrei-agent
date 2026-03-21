"""Unit tests for the HTTP runtime service adapter."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from config.settings import Settings
from infrastructure.session.memory import InMemorySessionStore
from interfaces.http_service import create_http_app
from interfaces.public_api import RuntimeAPI


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.upsert_session = AsyncMock()
    db.save_route = AsyncMock(return_value="route-1")
    return db


class TestHTTPService:
    async def test_healthz_returns_service_metadata(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.get("/healthz")
            assert response.status == 200
            body = await response.json()

        assert body["status"] == "ok"
        assert body["service"] == "seichijunrei-runtime"
        assert body["db_adapter"] == "MagicMock"
        assert body["session_store"] == "InMemorySessionStore"

    async def test_runtime_endpoint_executes_public_api(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.post(
                "/v1/runtime",
                json={"text": "秒速5厘米的取景地在哪"},
            )
            assert response.status == 200
            body = await response.json()

        assert body["success"] is True
        assert body["intent"] == "search_by_bangumi"
        assert body["status"] == "empty"
        assert body["session"]["interaction_count"] == 1

    async def test_runtime_endpoint_rejects_invalid_payload(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.post("/v1/runtime", json={"text": "   "})
            assert response.status == 422
            body = await response.json()

        assert body["error"]["code"] == "invalid_request"

    async def test_runtime_endpoint_rejects_invalid_json(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.post(
                "/v1/runtime",
                data="{bad json",
                headers={"Content-Type": "application/json"},
            )
            assert response.status == 400
            body = await response.json()

        assert body["error"]["code"] == "invalid_json"

    async def test_runtime_endpoint_maps_internal_errors_to_500(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        with patch(
            "interfaces.public_api.run_pipeline",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            async with TestClient(TestServer(app)) as client:
                response = await client.post(
                    "/v1/runtime",
                    json={"text": "秒速5厘米的取景地在哪"},
                )
                assert response.status == 500
                body = await response.json()

        assert body["errors"][0]["code"] == "internal_error"

    async def test_service_lifecycle_connects_and_closes_dependencies(self):
        db = MagicMock()
        db.connect = AsyncMock()
        db.close = AsyncMock()
        pool = AsyncMock()
        pool.fetch = AsyncMock(return_value=[])
        db.pool = pool
        db.search_points_by_location = AsyncMock(return_value=[])
        db.upsert_session = AsyncMock()
        db.save_route = AsyncMock(return_value="route-1")

        session_store = MagicMock()
        session_store.get = AsyncMock(return_value=None)
        session_store.set = AsyncMock()
        session_store.delete = AsyncMock()
        session_store.close = AsyncMock()

        app = create_http_app(
            settings=Settings(),
            db=db,
            session_store=session_store,
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.get("/healthz")
            assert response.status == 200

        db.connect.assert_awaited_once()
        db.close.assert_awaited_once()
        session_store.close.assert_awaited_once()
