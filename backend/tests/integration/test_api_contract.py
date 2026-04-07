"""Contract tests for the FastAPI service API endpoints.

These tests assert the request/response shape (status codes, required keys,
types) for every endpoint exposed by the FastAPI adapter.  They serve as a
safety net during the FastAPI cutover — no LLM or real DB calls are made.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.config.settings import Settings
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.fastapi_service import create_fastapi_app
from backend.interfaces.public_api import PublicAPIResponse, RuntimeAPI


# ── Helpers ──────────────────────────────────────────────────────────────────


def _canned_pipeline_result() -> PipelineResult:
    """A minimal successful PipelineResult for mocking RuntimeAPI.handle."""
    plan = ExecutionPlan(
        steps=[
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "12345"})
        ],
        reasoning="contract test",
        locale="ja",
    )
    return PipelineResult(
        intent="search_bangumi",
        plan=plan,
        step_results=[
            StepResult(
                tool="search_bangumi",
                success=True,
                data={"rows": [], "row_count": 0},
            )
        ],
        final_output={
            "success": True,
            "status": "ok",
            "message": "Found 0 pilgrimage spots.",
            "results": {"rows": [], "row_count": 0},
        },
    )


def _canned_public_response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        session_id="sess-contract",
        message="Found 0 pilgrimage spots.",
        data={"results": {"rows": [], "row_count": 0}},
        ui={"component": "PilgrimageGrid"},
    )


def _mock_db() -> MagicMock:
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.get_conversations = AsyncMock(return_value=[{"id": "c1", "title": "Test"}])
    db.get_conversation = AsyncMock(return_value={"user_id": "user-1"})
    db.get_messages = AsyncMock(return_value=[{"role": "user", "content": "hi"}])
    db.get_user_routes = AsyncMock(return_value=[{"route_id": "r1"}])
    db.save_feedback = AsyncMock(return_value="feedback-1")
    db.upsert_session = AsyncMock()
    db.upsert_conversation = AsyncMock()
    db.insert_message = AsyncMock()
    db.insert_request_log = AsyncMock()
    return db


def _build_app(*, runtime_api: RuntimeAPI | None = None, db: MagicMock | None = None) -> TestClient:
    resolved_db = db or _mock_db()
    api = runtime_api or RuntimeAPI(resolved_db, session_store=InMemorySessionStore())
    app = create_fastapi_app(
        runtime_api=api,
        settings=Settings(),
        db=resolved_db,
    )
    return TestClient(app)


def _mock_runtime_api(response: PublicAPIResponse | None = None) -> MagicMock:
    """Return a MagicMock that quacks like RuntimeAPI.handle."""
    api = MagicMock(spec=RuntimeAPI)
    api.handle = AsyncMock(return_value=response or _canned_public_response())
    api._db = _mock_db()
    api._session_store = InMemorySessionStore()
    return api


# ── GET /healthz ─────────────────────────────────────────────────────────────


class TestHealthz:
    def test_returns_200(self) -> None:
        client = _build_app()
        with client:
            resp = client.get("/healthz")
        assert resp.status_code == 200

    def test_response_has_required_keys(self) -> None:
        client = _build_app()
        with client:
            body = client.get("/healthz").json()
        assert "status" in body
        assert "service" in body
        assert isinstance(body["status"], str)
        assert isinstance(body["service"], str)

    def test_response_includes_optional_diagnostics(self) -> None:
        client = _build_app()
        with client:
            body = client.get("/healthz").json()
        for key in ("app_env", "observability_enabled", "db_adapter", "session_store"):
            assert key in body


# ── GET / (root) ─────────────────────────────────────────────────────────────


class TestRoot:
    def test_returns_200_with_service_info(self) -> None:
        client = _build_app()
        with client:
            resp = client.get("/")
        assert resp.status_code == 200
        body = resp.json()
        assert "service" in body
        assert "endpoints" in body
        assert isinstance(body["endpoints"], dict)


# ── POST /v1/runtime ─────────────────────────────────────────────────────────


class TestRuntime:
    def test_returns_200_with_public_api_shape(self) -> None:
        api = _mock_runtime_api()
        db = _mock_db()
        app = create_fastapi_app(runtime_api=api, settings=Settings(), db=db)
        with TestClient(app) as client:
            resp = client.post(
                "/v1/runtime",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        for key in ("success", "status", "intent", "message", "data", "errors"):
            assert key in body, f"missing key: {key}"
        assert isinstance(body["success"], bool)
        assert isinstance(body["status"], str)
        assert isinstance(body["intent"], str)
        assert isinstance(body["message"], str)
        assert isinstance(body["data"], dict)
        assert isinstance(body["errors"], list)

    def test_response_includes_optional_ui_field(self) -> None:
        api = _mock_runtime_api()
        db = _mock_db()
        app = create_fastapi_app(runtime_api=api, settings=Settings(), db=db)
        with TestClient(app) as client:
            body = client.post(
                "/v1/runtime",
                json={"text": "京吹"},
                headers={"X-User-Id": "user-1"},
            ).json()
        # ui may be null or a dict with "component"
        if body.get("ui") is not None:
            assert isinstance(body["ui"], dict)
            assert "component" in body["ui"]

    def test_blank_text_returns_422(self) -> None:
        client = _build_app()
        with client:
            resp = client.post("/v1/runtime", json={"text": "  "})
        assert resp.status_code == 422
        body = resp.json()
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]

    def test_invalid_json_returns_400(self) -> None:
        client = _build_app()
        with client:
            resp = client.post(
                "/v1/runtime",
                content=b"not-json{{{",
                headers={"Content-Type": "application/json"},
            )
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"]["code"] == "invalid_json"

    def test_missing_body_returns_422(self) -> None:
        client = _build_app()
        with client:
            resp = client.post(
                "/v1/runtime",
                content=b"{}",
                headers={"Content-Type": "application/json"},
            )
        # Empty text and no selected_point_ids -> validation error
        assert resp.status_code == 422


# ── GET /v1/conversations ────────────────────────────────────────────────────


class TestConversations:
    def test_returns_200_list(self) -> None:
        db = _mock_db()
        client = _build_app(db=db)
        with client:
            resp = client.get(
                "/v1/conversations",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)

    def test_missing_user_header_returns_400_error_shape(self) -> None:
        client = _build_app()
        with client:
            resp = client.get("/v1/conversations")
        assert resp.status_code == 400
        body = resp.json()
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]


# ── GET /v1/conversations/{id}/messages ──────────────────────────────────────


class TestConversationMessages:
    def test_returns_200_with_messages_key(self) -> None:
        db = _mock_db()
        client = _build_app(db=db)
        with client:
            resp = client.get(
                "/v1/conversations/sess-1/messages",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "messages" in body
        assert isinstance(body["messages"], list)

    def test_ownership_mismatch_returns_404(self) -> None:
        db = _mock_db()
        db.get_conversation = AsyncMock(return_value={"user_id": "other-user"})
        client = _build_app(db=db)
        with client:
            resp = client.get(
                "/v1/conversations/sess-1/messages",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 404
        body = resp.json()
        assert body["error"]["code"] == "not_found"

    def test_missing_conversation_returns_404(self) -> None:
        db = _mock_db()
        db.get_conversation = AsyncMock(return_value=None)
        client = _build_app(db=db)
        with client:
            resp = client.get(
                "/v1/conversations/nonexistent/messages",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 404


# ── PATCH /v1/conversations/{id} ─────────────────────────────────────────────


class TestConversationPatch:
    def test_returns_200_on_success(self) -> None:
        db = _mock_db()
        db.update_conversation_title = AsyncMock()
        client = _build_app(db=db)
        with client:
            resp = client.patch(
                "/v1/conversations/sess-1",
                json={"title": "New title"},
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "ok" in body

    def test_blank_title_returns_422(self) -> None:
        db = _mock_db()
        db.update_conversation_title = AsyncMock()
        client = _build_app(db=db)
        with client:
            resp = client.patch(
                "/v1/conversations/sess-1",
                json={"title": "   "},
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 422

    def test_missing_user_header_returns_400(self) -> None:
        db = _mock_db()
        db.update_conversation_title = AsyncMock()
        client = _build_app(db=db)
        with client:
            resp = client.patch(
                "/v1/conversations/sess-1",
                json={"title": "hello"},
            )
        assert resp.status_code == 400


# ── GET /v1/routes ───────────────────────────────────────────────────────────


class TestRoutes:
    def test_returns_200_with_routes_key(self) -> None:
        db = _mock_db()
        client = _build_app(db=db)
        with client:
            resp = client.get(
                "/v1/routes",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "routes" in body
        assert isinstance(body["routes"], list)

    def test_missing_user_header_returns_400(self) -> None:
        client = _build_app()
        with client:
            resp = client.get("/v1/routes")
        assert resp.status_code == 400
        body = resp.json()
        assert "error" in body


# ── POST /v1/feedback ────────────────────────────────────────────────────────


class TestFeedback:
    def test_returns_200_with_feedback_id(self) -> None:
        db = _mock_db()
        client = _build_app(db=db)
        with client:
            resp = client.post(
                "/v1/feedback",
                json={"rating": "good", "query_text": "京吹"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "feedback_id" in body
        assert isinstance(body["feedback_id"], str)

    def test_blank_query_text_returns_422(self) -> None:
        client = _build_app()
        with client:
            resp = client.post(
                "/v1/feedback",
                json={"rating": "good", "query_text": "  "},
            )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "invalid_request"

    def test_invalid_rating_returns_422(self) -> None:
        client = _build_app()
        with client:
            resp = client.post(
                "/v1/feedback",
                json={"rating": "amazing", "query_text": "test"},
            )
        assert resp.status_code == 422

    def test_invalid_json_returns_400(self) -> None:
        client = _build_app()
        with client:
            resp = client.post(
                "/v1/feedback",
                content=b"not json!",
                headers={"Content-Type": "application/json"},
            )
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"]["code"] == "invalid_json"


# ── Error shape contract ─────────────────────────────────────────────────────


class TestErrorShape:
    """All error responses must follow {error: {code, message}} shape."""

    _ERROR_CASES = [
        ("GET", "/v1/conversations", None, None, 400),
        ("GET", "/v1/routes", None, None, 400),
        ("POST", "/v1/runtime", {"text": "  "}, None, 422),
    ]

    @pytest.mark.parametrize(
        ("method", "path", "json_body", "headers", "expected_status"),
        _ERROR_CASES,
        ids=[f"{m} {p}" for m, p, *_ in _ERROR_CASES],
    )
    def test_error_responses_have_standard_shape(
        self,
        method: str,
        path: str,
        json_body: dict[str, object] | None,
        headers: dict[str, str] | None,
        expected_status: int,
    ) -> None:
        client = _build_app()
        with client:
            resp = client.request(method, path, json=json_body, headers=headers or {})
        assert resp.status_code == expected_status
        body = resp.json()
        assert "error" in body
        error = body["error"]
        assert "code" in error
        assert "message" in error
        assert isinstance(error["code"], str)
        assert isinstance(error["message"], str)
