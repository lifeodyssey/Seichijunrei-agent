"""Unit tests for request validation, response model, and error handling."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.application.errors import InvalidInputError
from backend.interfaces.public_api import (
    PublicAPIRequest,
    PublicAPIResponse,
    RuntimeAPI,
)


def _make_result(
    intent: str = "search_bangumi",
    locale: str = "ja",
    steps: list[PlanStep] | None = None,
    final_output: dict | None = None,
) -> PipelineResult:
    """Build a fake PipelineResult for tests that mock run_pipeline."""
    plan = ExecutionPlan(
        reasoning="test",
        locale=locale,
        steps=steps
        or [PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "123"})],
    )
    result = PipelineResult(intent=intent, plan=plan)
    result.final_output = final_output or {
        "success": True,
        "status": "empty",
        "message": "該当する巡礼地が見つかりませんでした。",
        "results": {"rows": [], "row_count": 0},
    }
    return result


@pytest.fixture(autouse=True)
def _mock_pipeline(monkeypatch):
    """Mock run_pipeline — the ReActPlannerAgent requires an LLM."""

    async def _fake(text, db, *, model=None, locale="ja", context=None, on_step=None):
        return _make_result(locale=locale)

    monkeypatch.setattr("backend.interfaces.public_api.run_pipeline", _fake)


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
        result = _make_result(
            final_output={
                "success": False,
                "status": "error",
                "message": "",
                "data": {},
                "errors": ["db down"],
            },
        )

        async def _fake(
            text, db, *, model=None, locale="ja", context=None, on_step=None
        ):
            return result

        with patch("backend.interfaces.public_api.run_pipeline", side_effect=_fake):
            api = RuntimeAPI(mock_db)
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.status == "error"
        assert response.errors[0].code == "pipeline_error"
        assert response.errors[0].message == "A processing step failed."

    async def test_handle_maps_application_error(self, mock_db):
        api = RuntimeAPI(mock_db)

        with patch(
            "backend.interfaces.public_api.run_pipeline",
            new=AsyncMock(side_effect=InvalidInputError("bad request", field="text")),
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.errors[0].code == "invalid_input"
        assert response.errors[0].details["field"] == "text"

    async def test_handle_maps_unexpected_exception(self, mock_db):
        api = RuntimeAPI(mock_db)

        with patch(
            "backend.interfaces.public_api.run_pipeline",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.intent == "unknown"
        assert response.errors[0].code == "internal_error"

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
        assert span.attributes["runtime.status"] == "empty"
        assert span.attributes["runtime.success"] is True
        record_metric.assert_called_once()
        assert record_metric.call_args.kwargs["transport"] == "public_api"
