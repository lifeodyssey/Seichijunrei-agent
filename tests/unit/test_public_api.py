"""Unit tests for the thin public API facade."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from application.errors import InvalidInputError
from infrastructure.session.memory import InMemorySessionStore
from interfaces.public_api import PublicAPIRequest, RuntimeAPI, handle_public_request


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


class TestPublicAPIRequest:
    def test_rejects_blank_text(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="   ")


class TestRuntimeAPI:
    async def test_handle_creates_and_persists_session(self, mock_db):
        store = InMemorySessionStore()
        api = RuntimeAPI(mock_db, session_store=store)

        response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.session_id is not None
        assert response.session["interaction_count"] == 1
        saved_state = await store.get(response.session_id)
        assert saved_state is not None
        assert saved_state["last_intent"] == "search_by_bangumi"
        mock_db.upsert_session.assert_awaited_once()

    async def test_handle_reuses_existing_session(self, mock_db):
        store = InMemorySessionStore()
        api = RuntimeAPI(mock_db, session_store=store)

        first = await api.handle(PublicAPIRequest(text="你好"))
        second = await api.handle(
            PublicAPIRequest(
                text="秒速5厘米的取景地在哪",
                session_id=first.session_id,
            )
        )

        assert second.session_id == first.session_id
        assert second.session["interaction_count"] == 2
        assert second.session["last_intent"] == "search_by_bangumi"

    async def test_handle_maps_pipeline_result(self, mock_db):
        api = RuntimeAPI(mock_db)

        response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is True
        assert response.intent == "search_by_bangumi"
        assert response.status == "empty"
        assert "results" in response.data
        assert response.errors == []

    async def test_handle_can_include_debug(self, mock_db):
        api = RuntimeAPI(mock_db)

        mock_db.pool.fetch.return_value = [
            {"id": "1", "name": "A", "latitude": 34.88, "longitude": 135.80},
            {"id": "2", "name": "B", "latitude": 34.89, "longitude": 135.81},
        ]
        mock_db.search_points_by_location.return_value = [
            {"id": "1", "bangumi_id": "115908", "distance_m": 100},
            {"id": "2", "bangumi_id": "115908", "distance_m": 80},
        ]

        response = await api.handle(
            PublicAPIRequest(text="从京都站出发去吹响的圣地", include_debug=True)
        )

        assert response.debug is not None
        assert response.debug["plan"]["steps"] == [
            "query_db",
            "plan_route",
            "format_response",
        ]
        assert len(response.debug["step_results"]) == 3
        assert response.route_history[0]["route_id"] == "route-1"
        mock_db.save_route.assert_awaited_once()

    async def test_handle_maps_pipeline_failure(self, mock_db):
        mock_db.pool.fetch.side_effect = Exception("db down")
        api = RuntimeAPI(mock_db)

        response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.status == "error"
        assert response.errors[0].code == "pipeline_error"
        assert "db down" in response.errors[0].message

    async def test_handle_maps_application_error(self, mock_db):
        api = RuntimeAPI(mock_db)

        with patch(
            "interfaces.public_api.run_pipeline",
            new=AsyncMock(side_effect=InvalidInputError("bad request", field="text")),
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.errors[0].code == "invalid_input"
        assert response.errors[0].details["field"] == "text"

    async def test_handle_maps_unexpected_exception(self, mock_db):
        api = RuntimeAPI(mock_db)

        with patch(
            "interfaces.public_api.run_pipeline",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.intent == "unknown"
        assert response.errors[0].code == "internal_error"


class TestHandlePublicRequest:
    async def test_helper_delegates_to_runtime_api(self, mock_db):
        store = InMemorySessionStore()
        response = await handle_public_request(
            PublicAPIRequest(text="你好"),
            mock_db,
            session_store=store,
        )

        assert response.intent == "unclear"
        assert response.status == "needs_clarification"
        assert response.session["interaction_count"] == 1
