"""Unit tests for the thin public API facade."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from agents.executor_agent import PipelineResult
from agents.models import ExecutionPlan, PlanStep, ToolName
from application.errors import InvalidInputError
from infrastructure.session.memory import InMemorySessionStore
from interfaces.public_api import PublicAPIRequest, PublicAPIResponse, RuntimeAPI, handle_public_request


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
        steps=steps or [PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "123"})],
    )
    result = PipelineResult(intent=intent, plan=plan)
    result.final_output = final_output or {
        "success": True,
        "status": "empty",
        "message": "該当する巡礼地が見つかりませんでした。",
        "data": {"results": {"rows": [], "row_count": 0}},
    }
    return result


@pytest.fixture(autouse=True)
def _mock_pipeline():
    """Mock run_pipeline — the ReActPlannerAgent requires an LLM."""
    async def _fake(text, db, *, model=None, locale="ja"):
        return _make_result(locale=locale)

    with patch("interfaces.public_api.run_pipeline", side_effect=_fake):
        yield


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
        assert saved_state["last_intent"] == "search_bangumi"
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
        assert second.session["last_intent"] == "search_bangumi"

    async def test_handle_maps_pipeline_result(self, mock_db):
        api = RuntimeAPI(mock_db)

        response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is True
        assert response.intent == "search_bangumi"
        assert response.status == "empty"
        assert "results" in response.data
        assert response.errors == []

    async def test_handle_can_include_debug(self, mock_db):
        result = _make_result(
            intent="plan_route",
            steps=[
                PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "吹响"}),
                PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "115908"}),
                PlanStep(tool=ToolName.PLAN_ROUTE, params={"origin": "京都駅"}),
            ],
            final_output={
                "success": True,
                "status": "ok",
                "message": "ルートを作成しました。",
                "data": {
                    "results": {"rows": [{"id": "1", "bangumi_id": "115908"}], "row_count": 1},
                    "route": {
                        "ordered_points": [
                            {"id": "1", "name": "A", "latitude": 34.88, "longitude": 135.80},
                            {"id": "2", "name": "B", "latitude": 34.89, "longitude": 135.81},
                        ],
                        "point_count": 2,
                    },
                },
            },
        )

        async def _fake(text, db, *, model=None, locale="ja"):
            return result

        with patch("interfaces.public_api.run_pipeline", side_effect=_fake):
            api = RuntimeAPI(mock_db)
            response = await api.handle(
                PublicAPIRequest(text="从京都站出发去吹响的圣地", include_debug=True)
            )

        assert response.debug is not None
        assert response.debug["plan"]["steps"] == [
            "resolve_anime",
            "search_bangumi",
            "plan_route",
        ]
        assert len(response.debug["step_results"]) == 0  # mock doesn't execute steps
        assert response.route_history[0]["route_id"] == "route-1"
        mock_db.save_route.assert_awaited_once()

    async def test_request_log_called_after_response(self, monkeypatch):
        """insert_request_log is called once after a successful pipeline run."""
        result = _make_result(
            final_output={
                "success": True,
                "status": "ok",
                "message": "Found 3 spots.",
                "data": {},
            },
        )

        async def fake_run_pipeline(text, db, *, model=None, locale="ja"):
            return result

        monkeypatch.setattr("interfaces.public_api.run_pipeline", fake_run_pipeline)

        db = MagicMock()
        db.upsert_session = AsyncMock()
        db.insert_request_log = AsyncMock(return_value="log-1")
        api = RuntimeAPI(db=db)

        await api.handle(
            PublicAPIRequest(text="吹響の聖地", locale="ja", session_id="s1")
        )

        db.insert_request_log.assert_awaited_once()
        kwargs = db.insert_request_log.call_args.kwargs
        assert kwargs["query_text"] == "吹響の聖地"
        assert kwargs["locale"] == "ja"
        assert kwargs["intent"] == "search_bangumi"

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

        async def _fake(text, db, *, model=None, locale="ja"):
            return result

        with patch("interfaces.public_api.run_pipeline", side_effect=_fake):
            api = RuntimeAPI(mock_db)
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.success is False
        assert response.status == "error"
        assert response.errors[0].code == "pipeline_error"
        assert response.errors[0].message == "A processing step failed."

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

        with (
            patch(
                "interfaces.public_api.get_runtime_tracer",
                return_value=DummyTracer(span),
            ),
            patch("interfaces.public_api.record_runtime_request") as record_metric,
        ):
            response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.intent == "search_bangumi"
        assert span.attributes["runtime.intent"] == "search_bangumi"
        assert span.attributes["runtime.status"] == "empty"
        assert span.attributes["runtime.success"] is True
        record_metric.assert_called_once()
        assert record_metric.call_args.kwargs["transport"] == "public_api"


class TestLocalePassthrough:
    async def test_locale_field_accepted_in_request(self):
        req = PublicAPIRequest(text="hello", locale="zh")
        assert req.locale == "zh"

    async def test_locale_defaults_to_ja(self):
        req = PublicAPIRequest(text="hello")
        assert req.locale == "ja"

    async def test_handle_passes_locale_to_pipeline(self, mock_db):
        result = _make_result(
            intent="answer_question",
            locale="zh",
            steps=[PlanStep(tool=ToolName.ANSWER_QUESTION)],
            final_output={
                "success": True,
                "status": "ok",
                "message": "你好！有什么可以帮助你的？",
                "data": {},
            },
        )

        async def _fake(text, db, *, model=None, locale="ja"):
            return result

        with patch("interfaces.public_api.run_pipeline", side_effect=_fake):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            response = await api.handle(PublicAPIRequest(text="你好", locale="zh"))

        assert response.intent == "answer_question"
        assert response.message  # non-empty

    async def test_handle_ja_locale_produces_japanese_message(self, mock_db):
        result = _make_result(
            intent="answer_question",
            locale="ja",
            steps=[PlanStep(tool=ToolName.ANSWER_QUESTION)],
            final_output={
                "success": True,
                "status": "ok",
                "message": "こんにちは！何かお手伝いしましょうか？",
                "data": {},
            },
        )

        async def _fake(text, db, *, model=None, locale="ja"):
            return result

        with patch("interfaces.public_api.run_pipeline", side_effect=_fake):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            response = await api.handle(PublicAPIRequest(text="你好", locale="ja"))

        assert response.intent == "answer_question"
        assert response.message  # non-empty


class TestPublicAPIRequestLocaleEn:
    def test_en_locale_accepted(self):
        req = PublicAPIRequest(text="where is kyoani", locale="en")
        assert req.locale == "en"

    def test_invalid_locale_rejected(self):
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="test", locale="fr")


class TestPublicAPIResponseUIField:
    def test_response_has_ui_field(self):
        resp = PublicAPIResponse(
            success=True,
            status="ok",
            intent="search_bangumi",
            ui={"component": "PilgrimageGrid", "props": {}},
        )
        assert resp.ui is not None
        assert resp.ui["component"] == "PilgrimageGrid"

    def test_response_ui_optional(self):
        resp = PublicAPIResponse(success=True, status="ok", intent="search_bangumi")
        assert resp.ui is None


class TestHandlePublicRequest:
    async def test_helper_delegates_to_runtime_api(self, mock_db):
        store = InMemorySessionStore()
        response = await handle_public_request(
            PublicAPIRequest(text="你好"),
            mock_db,
            session_store=store,
        )

        assert response.intent == "search_bangumi"
        assert response.status == "empty"
        assert response.session["interaction_count"] == 1
