"""Contract tests for the FastAPI service API endpoints.

These tests assert the request/response shape (status codes, required keys,
types) for every endpoint exposed by the FastAPI adapter.  They serve as a
safety net during the FastAPI cutover — DB is a real testcontainer PostgreSQL,
RuntimeAPI is mocked so we only verify HTTP contract.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.config.settings import Settings
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.fastapi_service import create_fastapi_app
from backend.interfaces.public_api import PublicAPIResponse, RuntimeAPI

# ── Helpers ──────────────────────────────────────────────────────────────────


def _canned_pipeline_result() -> PipelineResult:
    """A minimal successful PipelineResult for mocking RuntimeAPI.handle."""
    plan = ExecutionPlan(
        steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "12345"})],
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


def _build_test_app(
    *,
    db: SupabaseClient | object,
    runtime_api: RuntimeAPI | MagicMock | None = None,
) -> FastAPI:
    """Build a FastAPI app pre-configured for testing.

    Bypasses the production lifespan by pre-setting app.state directly.
    This avoids event-loop mismatch between the ASGI transport and the
    testcontainer asyncpg pool.
    """
    settings = Settings()
    resolved_api: RuntimeAPI | MagicMock = runtime_api or RuntimeAPI(
        db,
        session_store=InMemorySessionStore(),
    )

    @asynccontextmanager
    async def _noop_lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield

    app = create_fastapi_app(
        runtime_api=resolved_api,
        settings=settings,
        db=db,
    )
    # Replace production lifespan with no-op; set state directly
    app.router.lifespan_context = _noop_lifespan
    app.state.settings = settings
    app.state.runtime_api = resolved_api
    app.state.db_client = db
    return app


def _build_app(
    *,
    runtime_api: RuntimeAPI | MagicMock | None = None,
    db: SupabaseClient | None = None,
) -> httpx.AsyncClient:
    if db is None:
        raise RuntimeError(
            "tc_db fixture required: _build_app() needs a real SupabaseClient. "
            "Pass the tc_db fixture as db= parameter."
        )
    app = _build_test_app(db=db, runtime_api=runtime_api)
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


def _mock_runtime_api(
    db: SupabaseClient, response: PublicAPIResponse | None = None
) -> MagicMock:
    """Return a MagicMock that quacks like RuntimeAPI.handle."""
    api = MagicMock(spec=RuntimeAPI)
    api.handle = AsyncMock(return_value=response or _canned_public_response())
    api._db = db
    api._session_store = InMemorySessionStore()
    return api


async def _seed_conversation(
    db: SupabaseClient, session_id: str, user_id: str, first_query: str = "test"
) -> None:
    """Insert a conversation row for tests that need one."""
    pool = db.pool
    await pool.execute(
        """
        INSERT INTO conversations (session_id, user_id, first_query)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id) DO NOTHING
        """,
        session_id,
        user_id,
        first_query,
    )


async def _seed_message(
    db: SupabaseClient, session_id: str, role: str = "user", content: str = "hi"
) -> None:
    """Insert a message row for tests that need one."""
    pool = db.pool
    await pool.execute(
        """
        INSERT INTO conversation_messages (session_id, role, content)
        VALUES ($1, $2, $3)
        """,
        session_id,
        role,
        content,
    )


async def _cleanup_test_data(db: SupabaseClient) -> None:
    """Remove test-inserted rows to preserve isolation."""
    pool = db.pool
    await pool.execute(
        "DELETE FROM conversation_messages WHERE session_id LIKE 'sess-%'"
    )
    await pool.execute("DELETE FROM conversations WHERE session_id LIKE 'sess-%'")
    await pool.execute(
        "DELETE FROM feedback WHERE query_text IN ('京吹', 'test', '  ')"
    )


# ── GET /healthz ─────────────────────────────────────────────────────────────


class TestHealthz:
    async def test_returns_200(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get("/healthz")
        assert resp.status_code == 200

    async def test_response_has_required_keys(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            body = (await client.get("/healthz")).json()
        assert "status" in body
        assert "service" in body
        assert isinstance(body["status"], str)
        assert isinstance(body["service"], str)

    async def test_response_includes_optional_diagnostics(
        self, tc_db: SupabaseClient
    ) -> None:
        async with _build_app(db=tc_db) as client:
            body = (await client.get("/healthz")).json()
        for key in ("app_env", "observability_enabled", "db_adapter", "session_store"):
            assert key in body


# ── GET / (root) ─────────────────────────────────────────────────────────────


class TestRoot:
    async def test_returns_200_with_service_info(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get("/")
        assert resp.status_code == 200
        body = resp.json()
        assert "service" in body
        assert "endpoints" in body
        assert isinstance(body["endpoints"], dict)


# ── POST /v1/runtime ─────────────────────────────────────────────────────────


class TestRuntime:
    async def test_returns_200_with_public_api_shape(
        self, tc_db: SupabaseClient
    ) -> None:
        api = _mock_runtime_api(tc_db)
        async with _build_app(runtime_api=api, db=tc_db) as client:
            resp = await client.post(
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

    async def test_response_includes_optional_ui_field(
        self, tc_db: SupabaseClient
    ) -> None:
        api = _mock_runtime_api(tc_db)
        async with _build_app(runtime_api=api, db=tc_db) as client:
            body = (
                await client.post(
                    "/v1/runtime",
                    json={"text": "京吹"},
                    headers={"X-User-Id": "user-1"},
                )
            ).json()
        # ui may be null or a dict with "component"
        if body.get("ui") is not None:
            assert isinstance(body["ui"], dict)
            assert "component" in body["ui"]

    async def test_blank_text_returns_422(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post("/v1/runtime", json={"text": "  "})
        assert resp.status_code == 422
        body = resp.json()
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]

    async def test_invalid_json_returns_400(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
                "/v1/runtime",
                content=b"not-json{{{",
                headers={"Content-Type": "application/json"},
            )
        assert resp.status_code == 400
        body = resp.json()
        assert body["error"]["code"] == "invalid_json"

    async def test_missing_body_returns_422(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
                "/v1/runtime",
                content=b"{}",
                headers={"Content-Type": "application/json"},
            )
        # Empty text and no selected_point_ids -> validation error
        assert resp.status_code == 422


# ── GET /v1/conversations ────────────────────────────────────────────────────


class TestConversations:
    async def test_returns_200_list(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get(
                "/v1/conversations",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert isinstance(body, list)

    async def test_missing_user_header_returns_400_error_shape(
        self, tc_db: SupabaseClient
    ) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get("/v1/conversations")
        assert resp.status_code == 400
        body = resp.json()
        assert "error" in body
        assert "code" in body["error"]
        assert "message" in body["error"]


# ── GET /v1/conversations/{id}/messages ──────────────────────────────────────


class TestConversationMessages:
    async def test_returns_200_with_messages_key(self, tc_db: SupabaseClient) -> None:
        await _seed_conversation(tc_db, "sess-msg-1", "user-1")
        await _seed_message(tc_db, "sess-msg-1", role="user", content="hi")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.get(
                    "/v1/conversations/sess-msg-1/messages",
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "messages" in body
            assert isinstance(body["messages"], list)
        finally:
            await _cleanup_test_data(tc_db)

    async def test_ownership_mismatch_returns_404(self, tc_db: SupabaseClient) -> None:
        await _seed_conversation(tc_db, "sess-owned", "other-user")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.get(
                    "/v1/conversations/sess-owned/messages",
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 404
            body = resp.json()
            assert body["error"]["code"] == "not_found"
        finally:
            await _cleanup_test_data(tc_db)

    async def test_missing_conversation_returns_404(
        self, tc_db: SupabaseClient
    ) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get(
                "/v1/conversations/sess-nonexistent/messages",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 404


# ── PATCH /v1/conversations/{id} ─────────────────────────────────────────────


class TestConversationPatch:
    async def test_returns_200_on_success(self, tc_db: SupabaseClient) -> None:
        await _seed_conversation(tc_db, "sess-patch-1", "user-1")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.patch(
                    "/v1/conversations/sess-patch-1",
                    json={"title": "New title"},
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "ok" in body
        finally:
            await _cleanup_test_data(tc_db)

    async def test_blank_title_returns_422(self, tc_db: SupabaseClient) -> None:
        await _seed_conversation(tc_db, "sess-patch-2", "user-1")
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.patch(
                    "/v1/conversations/sess-patch-2",
                    json={"title": "   "},
                    headers={"X-User-Id": "user-1"},
                )
            assert resp.status_code == 422
        finally:
            await _cleanup_test_data(tc_db)

    async def test_missing_user_header_returns_400(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.patch(
                "/v1/conversations/sess-patch-3",
                json={"title": "hello"},
            )
        assert resp.status_code == 400


# ── GET /v1/routes ───────────────────────────────────────────────────────────


class TestRoutes:
    async def test_returns_200_with_routes_key(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get(
                "/v1/routes",
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert "routes" in body
        assert isinstance(body["routes"], list)

    async def test_missing_user_header_returns_400(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.get("/v1/routes")
        assert resp.status_code == 400
        body = resp.json()
        assert "error" in body


# ── POST /v1/feedback ────────────────────────────────────────────────────────


class TestFeedback:
    async def test_returns_200_with_feedback_id(self, tc_db: SupabaseClient) -> None:
        try:
            async with _build_app(db=tc_db) as client:
                resp = await client.post(
                    "/v1/feedback",
                    json={"rating": "good", "query_text": "京吹"},
                )
            assert resp.status_code == 200
            body = resp.json()
            assert "feedback_id" in body
            assert isinstance(body["feedback_id"], str)
        finally:
            await _cleanup_test_data(tc_db)

    async def test_blank_query_text_returns_422(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                json={"rating": "good", "query_text": "  "},
            )
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "invalid_request"

    async def test_invalid_rating_returns_422(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
                "/v1/feedback",
                json={"rating": "amazing", "query_text": "test"},
            )
        assert resp.status_code == 422

    async def test_invalid_json_returns_400(self, tc_db: SupabaseClient) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.post(
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
    async def test_error_responses_have_standard_shape(
        self,
        tc_db: SupabaseClient,
        method: str,
        path: str,
        json_body: dict[str, object] | None,
        headers: dict[str, str] | None,
        expected_status: int,
    ) -> None:
        async with _build_app(db=tc_db) as client:
            resp = await client.request(
                method, path, json=json_body, headers=headers or {}
            )
        assert resp.status_code == expected_status
        body = resp.json()
        assert "error" in body
        error = body["error"]
        assert "code" in error
        assert "message" in error
        assert isinstance(error["code"], str)
        assert isinstance(error["message"], str)


# ── DB connection failure ────────────────────────────────────────────────────


class TestDBConnectionFailure:
    """Verify that a broken DB connection raises a clear fixture error."""

    async def test_build_app_without_db_raises(self) -> None:
        with pytest.raises(RuntimeError, match="tc_db fixture required"):
            _build_app(db=None)

    async def test_unconnected_client_surfaces_error(self) -> None:
        """A client that was never connect()-ed should fail on DB operations."""
        bad_client = SupabaseClient(
            "postgresql://localhost:1/nonexistent",
            min_pool_size=1,
            max_pool_size=2,
        )
        app = _build_test_app(db=bad_client)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url="http://test"
        ) as client:
            resp = await client.get(
                "/v1/conversations", headers={"X-User-Id": "user-1"}
            )
        # Should get a 500 error, not a silent success
        assert resp.status_code == 500
