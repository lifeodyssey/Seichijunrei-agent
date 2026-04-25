"""Unit tests for conversation persistence and user memory upsert logic."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.infrastructure.supabase.client import SupabaseClient
from backend.interfaces.public_api import PublicAPIRequest, RuntimeAPI
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


class TestGreetUserEphemeral:
    async def test_greet_user_is_ephemeral_and_skips_persistence(self):
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.GREET_USER, params={"message": "Hello!"})],
            reasoning="greeting",
            locale="en",
        )
        result = PipelineResult(intent="greet_user", plan=plan)
        result.final_output = {"success": True, "status": "info", "message": "Hello!"}

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ):
            _ = (text, db, model, locale, context, on_step)
            return result

        db = MagicMock()
        db.get_user_memory = AsyncMock(return_value=None)
        db.session.upsert_session = AsyncMock()
        db.session.upsert_conversation = AsyncMock()
        db.user_memory.upsert_user_memory = AsyncMock()
        db.insert_request_log = AsyncMock()

        session_store = MagicMock()
        session_store.get = AsyncMock(return_value=None)
        session_store.set = AsyncMock()
        session_store.delete = AsyncMock()
        session_store.close = AsyncMock()

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(db=db, session_store=session_store)
            response = await api.handle(PublicAPIRequest(text="hi"), user_id="u1")

        assert response.intent == "greet_user"
        assert response.session_id is None
        assert response.session == {}
        assert response.route_history == []
        session_store.get.assert_not_awaited()
        session_store.set.assert_not_awaited()
        db.session.upsert_session.assert_not_awaited()
        db.session.upsert_conversation.assert_not_awaited()
        db.user_memory.upsert_user_memory.assert_not_awaited()
        db.insert_request_log.assert_not_awaited()


class TestRuntimeAPISession:
    async def test_handle_creates_and_persists_session(self, mock_db):
        store = InMemorySessionStore()
        api = RuntimeAPI(mock_db, session_store=store)

        response = await api.handle(PublicAPIRequest(text="秒速5厘米的取景地在哪"))

        assert response.session_id is not None
        assert response.session["interaction_count"] == 1
        saved_state = await store.get(response.session_id)
        assert saved_state is not None
        assert saved_state["last_intent"] == "search_bangumi"
        mock_db.session.upsert_session.assert_awaited_once()

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


class TestConversationPersistence:
    # TODO: re-enable when conversation history title generation is wired back
    # async def test_first_interaction_returns_fallback_title(self, mock_db):
    #     api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
    #     response = await api.handle(PublicAPIRequest(text="京吹"), user_id="u1")
    #     assert response is not None
    #     assert response.generated_title == "京吹"

    async def test_does_not_schedule_title_generation_for_existing_session(
        self,
        mock_db,
    ):
        store = InMemorySessionStore()
        session_id = "session-1"
        await store.set(
            session_id,
            {
                "interactions": [
                    {
                        "text": "以前の会話",
                        "intent": "search_bangumi",
                        "status": "ok",
                        "success": True,
                        "created_at": "2026-04-02T10:00:00+00:00",
                        "context_delta": {},
                    }
                ],
                "route_history": [],
                "last_intent": "search_bangumi",
                "last_status": "ok",
                "last_message": "ok",
                "updated_at": "2026-04-02T10:00:00+00:00",
            },
        )

        with patch("backend.interfaces.persistence.asyncio.create_task") as create_task:
            api = RuntimeAPI(mock_db, session_store=store)
            await api.handle(
                PublicAPIRequest(text="京吹", session_id=session_id),
                user_id="u1",
            )

        create_task.assert_not_called()


class TestUserMemoryUpsert:
    async def test_upserts_user_memory_when_bangumi_id_in_delta(self, mock_db):
        result = _make_result(
            steps=[PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "響け"})],
            final_output={
                "success": True,
                "status": "ok",
                "message": "ok",
                "results": {"rows": [], "row_count": 0},
            },
        )
        result.step_results = [
            StepResult(
                tool="resolve_anime",
                success=True,
                data={"bangumi_id": "253", "title": "響け！ユーフォニアム"},
            )
        ]

        async def _fake(
            *,
            text: str,
            db: object,
            model: object | None = None,
            locale: str = "ja",
            context: dict[str, object] | None = None,
            on_step: object | None = None,
        ):
            _ = (text, db, model, locale, context, on_step)
            return result

        with patch(
            "backend.interfaces.public_api.run_pilgrimage_agent", side_effect=_fake
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            await api.handle(PublicAPIRequest(text="響け"), user_id="u1")

        mock_db.user_memory.upsert_user_memory.assert_awaited_once()
        kwargs = mock_db.user_memory.upsert_user_memory.await_args.kwargs
        assert kwargs["bangumi_id"] == "253"
        assert kwargs["anime_title"] == "響け！ユーフォニアム"

    async def test_skips_user_memory_when_no_bangumi_id(self, mock_db):
        api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

        await api.handle(PublicAPIRequest(text="宇治の近く"), user_id="u1")

        mock_db.user_memory.upsert_user_memory.assert_not_awaited()


# TODO: re-enable when session compaction is wired back
class _DisabledTestCompactThresholdTrigger:
    async def test_handle_triggers_compact_when_session_reaches_threshold(
        self, mock_db
    ) -> None:
        from unittest.mock import patch

        store = InMemorySessionStore()
        session_id = "sess-trigger"
        await store.set(
            session_id,
            {
                "interactions": [
                    {
                        "text": f"q{i}",
                        "intent": "search_bangumi",
                        "status": "ok",
                        "success": True,
                        "created_at": "2026-04-01T00:00:00Z",
                        "context_delta": {},
                    }
                    for i in range(7)
                ],
                "route_history": [],
                "last_intent": "search_bangumi",
                "last_status": "ok",
                "last_message": "",
                "summary": None,
                "updated_at": "2026-04-01T00:00:00Z",
            },
        )
        scheduled: list[object] = []

        def _capture_task(coro: object) -> MagicMock:
            scheduled.append(coro)
            close = getattr(coro, "close", None)
            if callable(close):
                close()
            return MagicMock()

        with patch(
            "backend.interfaces.persistence._spawn_background",
            side_effect=_capture_task,
        ):
            api = RuntimeAPI(mock_db, session_store=store)
            await api.handle(
                PublicAPIRequest(text="京吹", session_id=session_id), user_id=None
            )

        assert len(scheduled) >= 1
