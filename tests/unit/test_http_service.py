"""Unit tests for the HTTP runtime service adapter."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.test_utils import TestClient, TestServer

from config.settings import Settings
from infrastructure.session.memory import InMemorySessionStore
from interfaces.http_service import create_http_app
from interfaces.public_api import RuntimeAPI


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
    db.get_conversations = AsyncMock(return_value=[])
    db.search_points_by_location = AsyncMock(return_value=[])
    db.upsert_session = AsyncMock()
    db.update_conversation_title = AsyncMock(return_value=True)
    db.save_route = AsyncMock(return_value="route-1")
    return db


class TestHTTPService:
    async def test_runtime_endpoint_passes_user_id_header(self, mock_db):
        runtime_api = MagicMock()
        runtime_api.handle = AsyncMock(
            return_value=RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            and MagicMock(
                model_dump=MagicMock(),
            )
        )
        runtime_api.handle.return_value = MagicMock(
            success=True,
            status="ok",
            intent="search_bangumi",
            errors=[],
            model_dump=MagicMock(
                return_value={
                    "success": True,
                    "status": "ok",
                    "intent": "search_bangumi",
                    "message": "",
                    "data": {},
                    "session": {},
                    "route_history": [],
                    "errors": [],
                    "ui": None,
                    "debug": None,
                    "session_id": "sess-1",
                }
            ),
        )
        app = create_http_app(runtime_api=runtime_api, settings=Settings())

        async with TestClient(TestServer(app)) as client:
            response = await client.post(
                "/v1/runtime",
                json={"text": "秒速5厘米的取景地在哪"},
                headers={"X-User-Id": "user-1"},
            )

        assert response.status == 200
        assert runtime_api.handle.await_args.kwargs["user_id"] == "user-1"

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
        from agents.executor_agent import PipelineResult
        from agents.models import ExecutionPlan, PlanStep, ToolName

        plan = ExecutionPlan(
            reasoning="test",
            locale="ja",
            steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "123"})],
        )
        result = PipelineResult(intent="search_bangumi", plan=plan)
        result.final_output = {
            "success": True,
            "status": "empty",
            "message": "該当する巡礼地が見つかりませんでした。",
            "data": {"results": {"rows": [], "row_count": 0}},
        }

        async def fake_pipeline(
            text,
            db,
            *,
            model=None,
            locale="ja",
            context=None,
            on_step=None,
        ):
            return result

        with patch("interfaces.public_api.run_pipeline", side_effect=fake_pipeline):
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
        assert body["intent"] == "search_bangumi"
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

    async def test_runtime_endpoint_records_http_observability(self, mock_db):
        from agents.executor_agent import PipelineResult
        from agents.models import ExecutionPlan, PlanStep, ToolName

        plan = ExecutionPlan(
            reasoning="test",
            locale="ja",
            steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi": "123"})],
        )
        result = PipelineResult(intent="search_bangumi", plan=plan)
        result.final_output = {
            "success": True,
            "status": "empty",
            "message": "",
            "data": {"results": {"rows": [], "row_count": 0}},
        }

        async def fake_pipeline(
            text,
            db,
            *,
            model=None,
            locale="ja",
            context=None,
            on_step=None,
        ):
            return result

        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )
        span = DummySpan()

        with (
            patch("interfaces.public_api.run_pipeline", side_effect=fake_pipeline),
            patch(
                "interfaces.http_service.get_http_tracer",
                return_value=DummyTracer(span),
            ),
            patch("interfaces.http_service.record_http_request") as record_metric,
        ):
            async with TestClient(TestServer(app)) as client:
                response = await client.post(
                    "/v1/runtime",
                    json={"text": "秒速5厘米的取景地在哪"},
                )
                assert response.status == 200

        assert span.attributes["http.method"] == "POST"
        assert span.attributes["http.route"] == "/v1/runtime"
        assert span.attributes["http.status_code"] == 200
        record_metric.assert_called_once()
        assert record_metric.call_args.kwargs["route"] == "/v1/runtime"

    async def test_service_lifecycle_initializes_observability_when_enabled(self):
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

        settings = Settings(
            observability_enabled=True,
            observability_exporter_type="none",
        )

        with (
            patch("interfaces.http_service.setup_observability") as setup_obs,
            patch("interfaces.http_service.shutdown_observability") as shutdown_obs,
        ):
            app = create_http_app(
                settings=settings,
                db=db,
                session_store=session_store,
            )

            async with TestClient(TestServer(app)) as client:
                response = await client.get("/healthz")
                assert response.status == 200

        setup_obs.assert_called_once_with(settings)
        shutdown_obs.assert_called_once()

    async def test_runtime_endpoint_accepts_locale(self, mock_db):
        from agents.executor_agent import PipelineResult
        from agents.models import ExecutionPlan, PlanStep, ToolName

        plan = ExecutionPlan(
            reasoning="test",
            locale="zh",
            steps=[PlanStep(tool=ToolName.ANSWER_QUESTION)],
        )
        result = PipelineResult(intent="answer_question", plan=plan)
        result.final_output = {
            "success": True,
            "status": "ok",
            "message": "你好！有什么可以帮助你的？",
            "data": {},
        }

        async def fake_pipeline(
            text,
            db,
            *,
            model=None,
            locale="ja",
            context=None,
            on_step=None,
        ):
            return result

        with patch("interfaces.public_api.run_pipeline", side_effect=fake_pipeline):
            app = create_http_app(
                runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
                settings=Settings(),
            )

            async with TestClient(TestServer(app)) as client:
                response = await client.post(
                    "/v1/runtime",
                    json={"text": "你好", "locale": "zh"},
                )
                assert response.status == 200
                body = await response.json()

        assert body["intent"] == "answer_question"
        assert body["message"]  # non-empty localized message

    async def test_get_conversations_returns_list(self, mock_db):
        mock_db.get_conversations.return_value = [
            {
                "session_id": "sess-1",
                "title": "京吹の聖地",
                "first_query": "京吹の聖地を探して",
                "created_at": "2026-04-02T10:00:00Z",
                "updated_at": "2026-04-02T10:00:00Z",
            }
        ]
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
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

    async def test_get_conversations_requires_user_id(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.get("/v1/conversations")

        assert response.status == 400

    async def test_patch_conversation_title(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.patch(
                "/v1/conversations/sess-1",
                json={"title": "New Title"},
                headers={"X-User-Id": "user-1"},
            )

        assert response.status == 200
        mock_db.update_conversation_title.assert_awaited_once()

    async def test_patch_conversation_validates_title(self, mock_db):
        app = create_http_app(
            runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
            settings=Settings(),
        )

        async with TestClient(TestServer(app)) as client:
            response = await client.patch(
                "/v1/conversations/sess-1",
                json={"title": ""},
                headers={"X-User-Id": "user-1"},
            )

        assert response.status == 422
