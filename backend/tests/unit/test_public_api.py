"""Unit tests for the thin public API facade."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic import ValidationError

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.application.errors import InvalidInputError
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import (
    PublicAPIRequest,
    PublicAPIResponse,
    RuntimeAPI,
    _build_context_block,
    handle_public_request,
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
    db.get_user_memory = AsyncMock(return_value=None)
    db.upsert_session = AsyncMock()
    db.upsert_conversation = AsyncMock()
    db.upsert_user_memory = AsyncMock()
    db.update_conversation_title = AsyncMock()
    db.save_route = AsyncMock(return_value="route-1")
    return db


class TestPublicAPIRequest:
    def test_rejects_blank_text(self) -> None:
        with pytest.raises(ValidationError):
            PublicAPIRequest(text="   ")


class TestContextExtraction:
    def test_extract_context_delta_from_resolve_anime(self) -> None:
        result = _make_result(
            steps=[
                PlanStep(
                    tool=ToolName.RESOLVE_ANIME,
                    params={"title": "響け！ユーフォニアム"},
                )
            ]
        )
        result.step_results = [
            StepResult(
                tool="resolve_anime",
                success=True,
                data={"bangumi_id": "253", "title": "響け！ユーフォニアム"},
            )
        ]

        from backend.interfaces.public_api import _extract_context_delta

        delta = _extract_context_delta(result)
        assert delta["bangumi_id"] == "253"
        assert delta["anime_title"] == "響け！ユーフォニアム"
        assert delta.get("location") is None

    def test_extract_context_delta_from_search_nearby(self) -> None:
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.SEARCH_NEARBY, params={"location": "宇治"})],
            reasoning="test",
            locale="ja",
        )
        result = PipelineResult(intent="search_nearby", plan=plan)
        result.step_results = [
            StepResult(
                tool="search_nearby",
                success=True,
                data={"rows": []},
            )
        ]

        from backend.interfaces.public_api import _extract_context_delta

        delta = _extract_context_delta(result)
        assert delta["location"] == "宇治"
        assert delta.get("bangumi_id") is None

    def test_extract_context_delta_empty_on_failure(self) -> None:
        result = _make_result()
        result.step_results = [
            StepResult(
                tool="resolve_anime",
                success=False,
                error="not found",
            )
        ]

        from backend.interfaces.public_api import _extract_context_delta

        delta = _extract_context_delta(result)
        assert delta == {}

    def test_build_context_block_from_interactions(self) -> None:
        state = {
            "interactions": [
                {
                    "text": "京吹",
                    "intent": "search_bangumi",
                    "status": "ok",
                    "success": True,
                    "created_at": "2026-04-01T00:00:00",
                    "context_delta": {
                        "bangumi_id": "253",
                        "anime_title": "響け！ユーフォニアム",
                        "location": None,
                    },
                },
                {
                    "text": "附近",
                    "intent": "search_nearby",
                    "status": "ok",
                    "success": True,
                    "created_at": "2026-04-01T00:01:00",
                    "context_delta": {
                        "bangumi_id": None,
                        "anime_title": None,
                        "location": "宇治",
                    },
                },
            ],
            "last_intent": "search_nearby",
        }

        from backend.interfaces.public_api import _build_context_block

        block = _build_context_block(state)
        assert block["current_bangumi_id"] == "253"
        assert block["current_anime_title"] == "響け！ユーフォニアム"
        assert block["last_location"] == "宇治"
        assert block["last_intent"] == "search_nearby"
        assert "253" in block["visited_bangumi_ids"]

    def test_build_context_block_returns_none_when_empty(self) -> None:
        from backend.interfaces.public_api import _build_context_block

        assert _build_context_block({"interactions": [], "last_intent": None}) is None


class TestCompact:
    async def test_compact_replaces_old_interactions_with_summary(self) -> None:
        from backend.interfaces.public_api import _compact_session_interactions

        store = InMemorySessionStore()
        session_id = "sess-compact"
        interactions = [
            {
                "text": f"query {index}",
                "intent": "search_bangumi",
                "status": "ok",
                "success": True,
                "created_at": "2026-04-01T00:00:00Z",
                "context_delta": {},
            }
            for index in range(8)
        ]
        state = {
            "interactions": interactions,
            "route_history": [],
            "last_intent": "search_bangumi",
            "last_status": "ok",
            "last_message": "",
            "summary": None,
            "updated_at": "2026-04-01T00:00:00Z",
        }

        mock_agent = MagicMock()
        mock_agent.run = AsyncMock(
            return_value=MagicMock(output="ユーザーは複数のアニメ聖地を検索しました。")
        )

        with patch(
            "backend.interfaces.session_facade.create_agent", return_value=mock_agent
        ):
            await _compact_session_interactions(session_id, state, store)

        saved = await store.get(session_id)
        assert saved is not None
        assert len(saved["interactions"]) == 2
        assert saved["summary"] == "ユーザーは複数のアニメ聖地を検索しました。"

    async def test_compact_skips_when_fewer_than_8(self) -> None:
        from backend.interfaces.public_api import _compact_session_interactions

        store = InMemorySessionStore()
        state = {
            "interactions": [
                {
                    "text": "q",
                    "intent": "search_bangumi",
                    "status": "ok",
                    "success": True,
                    "created_at": "2026-04-01T00:00:00Z",
                    "context_delta": {},
                }
            ]
            * 5,
            "summary": None,
        }

        with patch("backend.interfaces.session_facade.create_agent") as create_agent:
            await _compact_session_interactions("sess-short", state, store)

        create_agent.assert_not_called()

    def test_build_context_block_includes_summary(self) -> None:
        state = {
            "interactions": [
                {
                    "context_delta": {
                        "bangumi_id": "253",
                        "anime_title": "響け",
                        "location": "宇治",
                    }
                }
            ],
            "summary": "ユーザーは京吹の聖地を検索しました。",
        }

        block = _build_context_block(state)

        assert block is not None
        assert block["summary"] == "ユーザーは京吹の聖地を検索しました。"

    def test_build_context_block_returns_summary_only_context(self) -> None:
        block = _build_context_block({"interactions": [], "summary": "old summary"})

        assert block == {
            "current_bangumi_id": None,
            "current_anime_title": None,
            "last_location": None,
            "last_intent": None,
            "visited_bangumi_ids": [],
            "summary": "old summary",
        }


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
                "results": {
                    "rows": [{"id": "1", "bangumi_id": "115908"}],
                    "row_count": 1,
                },
                "route": {
                    "ordered_points": [
                        {
                            "id": "1",
                            "name": "A",
                            "latitude": 34.88,
                            "longitude": 135.80,
                        },
                        {
                            "id": "2",
                            "name": "B",
                            "latitude": 34.89,
                            "longitude": 135.81,
                        },
                    ],
                    "point_count": 2,
                },
            },
        )

        async def _fake(
            text, db, *, model=None, locale="ja", context=None, on_step=None
        ):
            return result

        with patch("backend.interfaces.public_api.run_pipeline", side_effect=_fake):
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

        async def fake_run_pipeline(
            text,
            db,
            *,
            model=None,
            locale="ja",
            context=None,
            on_step=None,
        ):
            return result

        monkeypatch.setattr(
            "backend.interfaces.public_api.run_pipeline", fake_run_pipeline
        )

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

    async def test_greet_user_is_ephemeral_and_skips_persistence(self):
        from backend.agents.executor_agent import PipelineResult

        plan = ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.GREET_USER,
                    params={"message": "Hello!"},
                )
            ],
            reasoning="greeting",
            locale="en",
        )
        result = PipelineResult(intent="greet_user", plan=plan)
        result.final_output = {"success": True, "status": "info", "message": "Hello!"}

        async def _fake(
            text, db, *, model=None, locale="ja", context=None, on_step=None
        ):
            return result

        db = MagicMock()
        db.get_user_memory = AsyncMock(return_value=None)
        db.upsert_session = AsyncMock()
        db.upsert_conversation = AsyncMock()
        db.upsert_user_memory = AsyncMock()
        db.insert_request_log = AsyncMock()

        session_store = MagicMock()
        session_store.get = AsyncMock(return_value=None)
        session_store.set = AsyncMock()
        session_store.delete = AsyncMock()
        session_store.close = AsyncMock()

        with patch("backend.interfaces.public_api.run_pipeline", side_effect=_fake):
            api = RuntimeAPI(db=db, session_store=session_store)
            response = await api.handle(PublicAPIRequest(text="hi"), user_id="u1")

        assert response.intent == "greet_user"
        assert response.session_id is None
        assert response.session == {}
        assert response.route_history == []

        session_store.get.assert_not_awaited()
        session_store.set.assert_not_awaited()
        db.upsert_session.assert_not_awaited()
        db.upsert_conversation.assert_not_awaited()
        db.upsert_user_memory.assert_not_awaited()
        db.insert_request_log.assert_not_awaited()

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

    async def test_handle_triggers_compact_when_session_reaches_threshold(
        self,
        mock_db,
    ) -> None:
        store = InMemorySessionStore()
        session_id = "sess-trigger"
        await store.set(
            session_id,
            {
                "interactions": [
                    {
                        "text": f"q{index}",
                        "intent": "search_bangumi",
                        "status": "ok",
                        "success": True,
                        "created_at": "2026-04-01T00:00:00Z",
                        "context_delta": {},
                    }
                    for index in range(7)
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
            "backend.interfaces.public_api.asyncio.create_task",
            side_effect=_capture_task,
        ):
            api = RuntimeAPI(mock_db, session_store=store)
            await api.handle(
                PublicAPIRequest(text="京吹", session_id=session_id),
                user_id=None,
            )

        assert len(scheduled) == 1

    async def test_selected_point_ids_bypass_planner(self, mock_db) -> None:
        captured: dict[str, object] = {}
        executor = MagicMock()

        async def _fake_execute(plan, *, context_block=None, on_step=None):
            captured["plan"] = plan
            captured["context_block"] = context_block
            return _make_result(
                intent="plan_selected",
                steps=[
                    PlanStep(
                        tool=ToolName.PLAN_SELECTED,
                        params={"point_ids": ["p1", "p2"], "origin": "宇治駅"},
                    )
                ],
                final_output={
                    "success": True,
                    "status": "ok",
                    "message": "已为2处选定取景地规划路线。",
                    "route": {
                        "ordered_points": [
                            {
                                "id": "p1",
                                "latitude": 34.88,
                                "longitude": 135.80,
                            },
                            {
                                "id": "p2",
                                "latitude": 34.89,
                                "longitude": 135.81,
                            },
                        ],
                        "point_count": 2,
                    },
                },
            )

        executor.execute = AsyncMock(side_effect=_fake_execute)

        with (
            patch(
                "backend.interfaces.public_api.run_pipeline",
                new=AsyncMock(side_effect=AssertionError("planner should be bypassed")),
            ),
            patch("backend.interfaces.public_api.ExecutorAgent", return_value=executor),
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            response = await api.handle(
                PublicAPIRequest(
                    text="",
                    selected_point_ids=["p1", "p2"],
                    origin="宇治駅",
                    locale="zh",
                )
            )

        plan = captured["plan"]
        assert isinstance(plan, ExecutionPlan)
        assert plan.steps[0].tool == ToolName.PLAN_SELECTED
        assert plan.steps[0].params == {
            "point_ids": ["p1", "p2"],
            "origin": "宇治駅",
        }
        assert response.intent == "plan_selected"
        assert response.ui == {"component": "RoutePlannerWizard"}


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
            text, db, *, model=None, locale="ja", context=None, on_step=None
        ):
            return result

        with patch("backend.interfaces.public_api.run_pipeline", side_effect=_fake):
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
            text, db, *, model=None, locale="ja", context=None, on_step=None
        ):
            return result

        with patch("backend.interfaces.public_api.run_pipeline", side_effect=_fake):
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

        async def fake_run_pipeline(
            text,
            db,
            *,
            model=None,
            locale="ja",
            context=None,
            on_step=None,
        ):
            captured["model"] = model
            return _make_result(locale=locale)

        explicit_model = object()
        monkeypatch.setattr(
            "backend.interfaces.public_api.run_pipeline", fake_run_pipeline
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
        self,
        mock_db,
    ):
        api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

        await api.handle(PublicAPIRequest(text="京吹の聖地"), user_id="user-abc")

        mock_db.get_user_memory.assert_awaited_once_with("user-abc")
        mock_db.upsert_conversation.assert_awaited_once()
        args = mock_db.upsert_conversation.await_args.args
        assert args[1] == "user-abc"

    async def test_skips_user_scoped_db_calls_when_user_id_absent(self, mock_db):
        api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

        await api.handle(PublicAPIRequest(text="京吹の聖地"), user_id=None)

        mock_db.get_user_memory.assert_not_awaited()
        mock_db.upsert_conversation.assert_not_awaited()


class TestConversationPersistence:
    async def test_first_interaction_schedules_title_generation(self, mock_db):
        scheduled: list[object] = []

        def _capture_task(coro: object) -> MagicMock:
            scheduled.append(coro)
            close = getattr(coro, "close", None)
            if callable(close):
                close()
            return MagicMock()

        with patch(
            "backend.interfaces.public_api.asyncio.create_task",
            side_effect=_capture_task,
        ):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            await api.handle(PublicAPIRequest(text="京吹"), user_id="u1")

        assert len(scheduled) == 1

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

        with patch("backend.interfaces.public_api.asyncio.create_task") as create_task:
            api = RuntimeAPI(mock_db, session_store=store)
            await api.handle(
                PublicAPIRequest(text="京吹", session_id=session_id),
                user_id="u1",
            )

        create_task.assert_not_called()


class TestUserMemoryUpsert:
    async def test_upserts_user_memory_when_bangumi_id_in_delta(self, mock_db):
        from backend.agents.executor_agent import StepResult

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
            text, db, *, model=None, locale="ja", context=None, on_step=None
        ):
            return result

        with patch("backend.interfaces.public_api.run_pipeline", side_effect=_fake):
            api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())
            await api.handle(PublicAPIRequest(text="響け"), user_id="u1")

        mock_db.upsert_user_memory.assert_awaited_once()
        kwargs = mock_db.upsert_user_memory.await_args.kwargs
        assert kwargs["bangumi_id"] == "253"
        assert kwargs["anime_title"] == "響け！ユーフォニアム"

    async def test_skips_user_memory_when_no_bangumi_id(self, mock_db):
        api = RuntimeAPI(mock_db, session_store=InMemorySessionStore())

        await api.handle(PublicAPIRequest(text="宇治の近く"), user_id="u1")

        mock_db.upsert_user_memory.assert_not_awaited()


class TestBuildContextBlockWithUserMemory:
    def test_merges_cross_session_visited_ids(self):
        session_state = {
            "interactions": [
                {
                    "context_delta": {
                        "bangumi_id": "253",
                        "anime_title": "響け",
                        "location": None,
                    }
                }
            ],
            "last_intent": "search_bangumi",
        }
        user_memory = {
            "visited_anime": [
                {"bangumi_id": "105", "title": "君の名は", "last_at": "2026-03-01"},
                {"bangumi_id": "253", "title": "響け", "last_at": "2026-04-01"},
            ]
        }

        block = _build_context_block(session_state, user_memory=user_memory)

        assert block is not None
        assert "105" in block["visited_bangumi_ids"]
        assert block["visited_bangumi_ids"].count("253") == 1

    def test_returns_none_when_no_context_and_no_user_memory(self):
        assert _build_context_block({"interactions": []}, user_memory=None) is None

    async def test_handle_passes_context_block_to_pipeline(self, mock_db):
        mock_db.get_user_memory.return_value = {
            "visited_anime": [
                {"bangumi_id": "105", "title": "君の名は", "last_at": "2026-03-01"}
            ]
        }
        captured: dict[str, object] = {}

        async def _fake(
            text, db, *, model=None, locale="ja", context=None, on_step=None
        ):
            captured["context"] = context
            return _make_result(locale=locale)

        with patch("backend.interfaces.public_api.run_pipeline", side_effect=_fake):
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
