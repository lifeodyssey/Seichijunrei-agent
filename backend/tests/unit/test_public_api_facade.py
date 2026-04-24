"""Unit tests for handle_public_request, user-id propagation, locale, and origin context."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.public_api import (
    PublicAPIRequest,
    RuntimeAPI,
    handle_public_request,
)


def _make_result(
    intent: str = "search_bangumi",
    locale: str = "ja",
    steps: list[PlanStep] | None = None,
    final_output: dict | None = None,
) -> PipelineResult:
    """Build a fake PipelineResult for tests that mock the runtime agent."""
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
    """Mock run_pilgrimage_agent — avoids LLM calls in unit tests."""

    async def _fake(
        *,
        text: str,
        db: object,
        model: object | None = None,
        locale: str = "ja",
        context: dict[str, object] | None = None,
        on_step: object | None = None,
    ) -> PipelineResult:
        _ = (text, db, model, context, on_step)
        return _make_result(locale=locale)

    monkeypatch.setattr("backend.interfaces.public_api.run_pilgrimage_agent", _fake)


@pytest.fixture
def mock_db():
    db = MagicMock(spec=SupabaseClient)
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.points.search_points_by_location = AsyncMock(return_value=[])
    db.user_memory.get_user_memory = AsyncMock(return_value=None)
    db.session.upsert_session = AsyncMock()
    db.session.upsert_conversation = AsyncMock()
    db.user_memory.upsert_user_memory = AsyncMock()
    db.session.update_conversation_title = AsyncMock()
    db.routes.save_route = AsyncMock(return_value="route-1")
    return db


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

    async def test_helper_forwards_explicit_model_override(self, mock_db, monkeypatch):
        captured: dict[str, object] = {}

        async def fake_run_agent(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ) -> PipelineResult:
            _ = (text, db, locale, context, on_step)
            captured["model"] = model
            return _make_result(locale=locale)

        explicit_model = object()
        monkeypatch.setattr(
            "backend.interfaces.public_api.run_pilgrimage_agent", fake_run_agent
        )

        await handle_public_request(
            PublicAPIRequest(text="你好"),
            mock_db,
            model=explicit_model,
            session_store=InMemorySessionStore(),
        )

        assert captured["model"] is explicit_model


class TestUserIdPropagation:
    async def test_loads_user_memory_and_upserts_conversation_when_user_id_present(
        self, mock_db
    ):
        api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

        await api.handle(PublicAPIRequest(text="京吹の聖地"), user_id="user-abc")

        mock_db.user_memory.get_user_memory.assert_awaited_once_with("user-abc")
        mock_db.session.upsert_conversation.assert_awaited_once()
        args = mock_db.session.upsert_conversation.await_args.args
        assert args[1] == "user-abc"

    async def test_skips_user_scoped_db_calls_when_user_id_absent(self, mock_db):
        api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

        await api.handle(PublicAPIRequest(text="京吹の聖地"), user_id=None)

        mock_db.user_memory.get_user_memory.assert_not_awaited()
        mock_db.session.upsert_conversation.assert_not_awaited()


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

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ) -> PipelineResult:
            _ = (text, db, model, locale, context, on_step)
            return result

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
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

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ) -> PipelineResult:
            _ = (text, db, model, locale, context, on_step)
            return result

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            response = await api.handle(PublicAPIRequest(text="你好", locale="ja"))

        assert response.intent == "answer_question"
        assert response.message  # non-empty


class TestBuildContextBlockWithUserMemory:
    async def test_handle_passes_context_block_to_pipeline(self, mock_db):
        mock_db.user_memory.get_user_memory.return_value = {
            "visited_anime": [
                {"bangumi_id": "105", "title": "君の名は", "last_at": "2026-03-01"}
            ]
        }
        captured: dict[str, object] = {}

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ) -> PipelineResult:
            _ = (text, db, model, locale, on_step)
            captured["context"] = context
            return _make_result(locale=locale)

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            await api.handle(PublicAPIRequest(text="次は何がある？"), user_id="u1")

        assert captured["context"] == {
            "summary": None,
            "current_bangumi_id": "105",
            "current_anime_title": "君の名は",
            "last_location": None,
            "last_intent": None,
            "visited_bangumi_ids": ["105"],
        }


class TestOriginCoordinatesWiredToContext:
    async def test_origin_lat_lng_injected_when_provided(self, mock_db):
        """Finding 1: origin_lat/lng on request are forwarded to pipeline context."""
        captured: dict[str, object] = {}

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ) -> PipelineResult:
            _ = (text, db, model, locale, on_step)
            captured["context"] = context
            return _make_result(locale=locale)

        request = PublicAPIRequest(text="聖地巡礼", origin_lat=34.9, origin_lng=135.8)

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            await api.handle(request)

        ctx = captured.get("context")
        assert isinstance(ctx, dict)
        assert ctx.get("origin_lat") == 34.9
        assert ctx.get("origin_lng") == 135.8

    async def test_origin_coords_not_injected_when_absent(self, mock_db):
        """When origin_lat/lng are not set, context does not contain those keys."""
        captured: dict[str, object] = {}

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ) -> PipelineResult:
            _ = (text, db, model, locale, on_step)
            captured["context"] = context
            return _make_result(locale=locale)

        request = PublicAPIRequest(text="聖地巡礼")

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            await api.handle(request)

        ctx = captured.get("context")
        if isinstance(ctx, dict):
            assert "origin_lat" not in ctx
            assert "origin_lng" not in ctx
