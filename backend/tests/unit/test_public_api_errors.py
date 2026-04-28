"""Unit tests for request validation, response model, and error handling."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from backend.agents.agent_result import AgentResult
from backend.application.errors import InvalidInputError
from backend.interfaces.public_api import (
    PublicAPIRequest,
    PublicAPIResponse,
    RuntimeAPI,
)
from backend.tests.unit.conftest_public_api import (
    install_mock_pipeline,
)
from backend.tests.unit.conftest_public_api import (
    make_result as _make_result,
)


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch):
    install_mock_pipeline(monkeypatch)


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.points.search_points_by_location = AsyncMock(return_value=[])
    db.session.get_user_memory = AsyncMock(return_value=None)
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.session.upsert_user_memory = AsyncMock()
    db.session.update_conversation_title = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    return db


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


class TestPublicAPIRequest:
    def test_rejects_blank_text(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="   ")

    def test_accepts_origin_lat_lng(self) -> None:
        req = PublicAPIRequest(text="hello", origin_lat=34.9, origin_lng=135.8)
        assert req.origin_lat == 34.9
        assert req.origin_lng == 135.8

    def test_origin_lat_without_origin_lng_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="hello", origin_lat=34.9)

    def test_origin_lng_without_origin_lat_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="hello", origin_lng=135.8)

    def test_origin_lat_out_of_range_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="hello", origin_lat=91.0, origin_lng=135.8)

    def test_origin_lat_negative_out_of_range_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="hello", origin_lat=-91.0, origin_lng=135.8)

    def test_origin_lng_out_of_range_rejected(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="hello", origin_lat=34.9, origin_lng=181.0)

    def test_origin_coords_both_none_allowed(self) -> None:
        req = PublicAPIRequest(text="hello")
        assert req.origin_lat is None
        assert req.origin_lng is None


class TestPublicAPIRequestLocaleEn:
    def test_en_locale_accepted(self):
        req = PublicAPIRequest(text="where is kyoani", locale="en")
        assert req.locale == "en"

    def test_invalid_locale_rejected(self):
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="test", locale="fr")

    def test_blank_text_allowed_when_selected_point_ids_present(self):
        request = PublicAPIRequest(text="", selected_point_ids=["p1"])

        assert request.text == ""
        assert request.selected_point_ids == ["p1"]

    def test_blank_text_rejected_without_selected_point_ids(self):
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="")


class TestPublicAPIResponseUIField:
    def test_response_has_ui_field(self):
        resp = PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
            ui={"component": "PilgrimageGrid"},
        )
        assert resp.ui is not None
        assert resp.ui["component"] == "PilgrimageGrid"

    def test_response_ui_optional(self):
        resp = PublicAPIResponse(success=True, status="ok", intent="search_bangumi")
        assert resp.ui is None


class TestRuntimeAPIErrors:
    async def test_handle_maps_pipeline_failure(self, mock_db):
        from backend.agents.agent_result import StepRecord

        result = _make_result(
            data={
                "results": {"rows": [], "row_count": 0},
            },
            steps=[
                StepRecord(tool="search_bangumi", success=False, error="db down"),
            ],
        )

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            message_history: object | None = None,
            on_step: object | None = None,
        ) -> AgentResult:
            _ = (text, db, model, locale, context, message_history, on_step)
            return result

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db)
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.errors[0].code == "pipeline_error"
        assert response.errors[0].message == "A processing step failed."

    async def test_handle_maps_application_error(self, mock_db):
        api = RuntimeAPI(mock_db)

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent",
            new=AsyncMock(side_effect=InvalidInputError("bad request", field="text")),
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.errors[0].code == "invalid_input"
        assert response.errors[0].details["field"] == "text"

    async def test_handle_maps_unexpected_exception(self, mock_db):
        api = RuntimeAPI(mock_db)

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.intent == "unknown"
        assert response.errors[0].code == "internal_error"

    async def test_handle_returns_friendly_message_on_provider_error(self, mock_db):
        """502/503 errors should return user-friendly provider_error, not generic failure."""
        api = RuntimeAPI(mock_db)

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent",
            new=AsyncMock(
                side_effect=RuntimeError("502 Bad Gateway: Network unstable")
            ),
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.status == "provider_error"
        assert "unavailable" in response.message.lower()
        assert response.errors[0].code == "provider_error"

    async def test_handle_returns_timeout_when_agent_exceeds_limit(
        self, mock_db, monkeypatch
    ):
        async def _slow_agent(**kwargs: object) -> AgentResult:
            await asyncio.sleep(5)
            return _make_result()

        monkeypatch.setattr("backend.interfaces.public_api.AGENT_TIMEOUT_SECONDS", 0.01)
        api = RuntimeAPI(mock_db)
        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent",
            side_effect=_slow_agent,
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.status == "timeout"
        assert response.intent == "error"

    async def test_timeout_response_contains_error_payload(self, mock_db, monkeypatch):
        async def _slow_agent(**kwargs: object) -> AgentResult:
            await asyncio.sleep(5)
            return _make_result()

        monkeypatch.setattr("backend.interfaces.public_api.AGENT_TIMEOUT_SECONDS", 0.01)
        api = RuntimeAPI(mock_db)
        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent",
            side_effect=_slow_agent,
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert len(response.errors) == 1
        assert response.errors[0].code == "timeout"
        assert "timed out" in response.errors[0].message
        assert response.message != ""

    async def test_handle_records_runtime_observability(self, mock_db):
        api = RuntimeAPI(mock_db)
        span = DummySpan()

        with (
            patch(
                "backend.interfaces.public_api.get_runtime_tracer",
                return_value=DummyTracer(span),
            ),
            patch(
                "backend.interfaces.public_api.record_runtime_request"
            ) as record_metric,
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.intent == "search_bangumi"
        assert span.attributes["runtime.intent"] == "search_bangumi"
        assert span.attributes["runtime.status"] == "ok"
        assert span.attributes["runtime.success"] is True
        record_metric.assert_called_once()
        assert record_metric.call_args.kwargs["transport"] == "public_api"
