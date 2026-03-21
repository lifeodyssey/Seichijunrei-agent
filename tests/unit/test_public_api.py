"""Unit tests for the thin public API facade."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from application.errors import InvalidInputError
from infrastructure.session.memory import InMemorySessionStore
from interfaces.public_api import PublicAPIRequest, RuntimeAPI, handle_public_request


class DummySpan:
    def __init__(self) -> None:
        self.attributes: dict[str, object] = {}
        self.exceptions: list[BaseException] = []

    def set_attribute(self, key: str, value: object) -> None:
        self.attributes[key] = value

    def record_exception(self, exception: BaseException) -> None:
        self.exceptions.append(exception)

    def __enter__(self) -> DummySpan:
        return self

    def __exit__(self, *args: object) -> None:
        return None


class DummyTracer:
    def __init__(self, span: DummySpan) -> None:
        self.span = span

    def start_as_current_span(self, name: str, **kwargs: object) -> DummySpan:
        return self.span


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

    async def test_handle_records_runtime_observability(self, mock_db):
        api = RuntimeAPI(mock_db)
        span = DummySpan()

        with patch(
            "interfaces.public_api.get_runtime_tracer",
            return_value=DummyTracer(span),
        ), patch("interfaces.public_api.record_runtime_request") as record_metric:
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.intent == "search_by_bangumi"
        assert span.attributes["runtime.intent"] == "search_by_bangumi"
        assert span.attributes["runtime.status"] == "empty"
        assert span.attributes["runtime.success"] is True
        record_metric.assert_called_once()
        assert record_metric.call_args.kwargs["transport"] == "public_api"


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
