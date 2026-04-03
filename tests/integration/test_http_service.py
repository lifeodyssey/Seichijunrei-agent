"""Integration coverage for HTTP service endpoints."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from aiohttp.test_utils import make_mocked_request

from config.settings import Settings
from infrastructure.session.memory import InMemorySessionStore
from interfaces.http_service import (
    _handle_get_conversations,
    _handle_patch_conversation,
    _handle_runtime_stream,
    create_http_app,
)
from interfaces.public_api import RuntimeAPI


def _build_db() -> MagicMock:
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool

    db.search_points_by_location = AsyncMock(return_value=[])
    db.upsert_session = AsyncMock()
    db.save_route = AsyncMock(return_value="route-1")
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
    return db


@pytest.fixture
def mock_db() -> MagicMock:
    return _build_db()


class FakeStreamResponse:
    last_instance: "FakeStreamResponse" | None = None

    def __init__(self) -> None:
        FakeStreamResponse.last_instance = self
        self.headers: dict[str, str] = {}
        self.chunks: list[str] = []

    async def prepare(self, request) -> None:  # noqa: ANN001
        return None

    async def write(self, data: bytes) -> None:
        self.chunks.append(data.decode("utf-8"))

    async def write_eof(self) -> None:
        return None


class TestHTTPServiceSSE:
    async def test_runtime_stream_emits_done_event(self, mock_db):
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
            if on_step is not None:
                await on_step("search_bangumi", "running", {})
                await on_step("search_bangumi", "done", {"rows": []})
            return result

        app = create_http_app(
            runtime_api=RuntimeAPI(
                mock_db,
                session_store=InMemorySessionStore(),
            ),
            settings=Settings(),
        )
        request = make_mocked_request(
            "POST",
            "/v1/runtime/stream",
            app=app,
            headers={"Authorization": "Bearer test-key"},
        )
        request.json = AsyncMock(return_value={"text": "秒速5厘米的取景地在哪"})

        with (
            patch("interfaces.public_api.run_pipeline", side_effect=fake_pipeline),
            patch("interfaces.http_service.web.StreamResponse", FakeStreamResponse),
        ):
            response = await _handle_runtime_stream(request)

        assert response is FakeStreamResponse.last_instance
        assert response.headers["Content-Type"] == "text/event-stream; charset=utf-8"
        body = "".join(response.chunks)
        assert "event: step" in body
        assert "event: done" in body
        assert '"event": "step"' in body
        assert '"data": {"rows": []}' in body
        assert '"event": "done"' in body


async def test_get_conversations_smoke(mock_db) -> None:
    app = create_http_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    request = make_mocked_request(
        "GET",
        "/v1/conversations",
        app=app,
        headers={"X-User-Id": "user-1"},
    )
    response = await _handle_get_conversations(request)
    body = json.loads(response.text)

    assert response.status == 200
    assert body[0]["session_id"] == "sess-1"


async def test_patch_conversation_smoke(mock_db) -> None:
    app = create_http_app(
        runtime_api=RuntimeAPI(mock_db, session_store=InMemorySessionStore()),
        settings=Settings(),
    )

    request = make_mocked_request(
        "PATCH",
        "/v1/conversations/sess-1",
        app=app,
        headers={"X-User-Id": "user-1"},
        match_info={"session_id": "sess-1"},
    )
    request.json = AsyncMock(return_value={"title": "新的标题"})
    response = await _handle_patch_conversation(request)
    body = json.loads(response.text)

    assert response.status == 200
    assert body == {"ok": True}
    mock_db.update_conversation_title.assert_awaited_once_with(
        "sess-1",
        "新的标题",
        user_id="user-1",
    )
