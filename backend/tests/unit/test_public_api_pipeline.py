"""Unit tests for core pipeline execution via RuntimeAPI."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.executor_agent import PipelineResult
from backend.agents.models import ExecutionPlan, PlanStep, ToolName
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.public_api import (
    PublicAPIRequest,
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
    db.search_points_by_location = AsyncMock(return_value=[])
    db.get_user_memory = AsyncMock(return_value=None)
    db.upsert_session = AsyncMock()
    db.upsert_conversation = AsyncMock()
    db.upsert_user_memory = AsyncMock()
    db.update_conversation_title = AsyncMock()
    db.save_route = AsyncMock(return_value="route-1")
    return db


class TestRuntimeAPIExecution:
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
        assert len(response.debug["step_results"]) == 0
        assert response.route_history[0]["route_id"] == "route-1"
        mock_db.save_route.assert_awaited_once()

    async def test_handle_preserves_coordinate_origin_in_route_history(self, mock_db):
        result = _make_result(
            intent="plan_route",
            steps=[PlanStep(tool=ToolName.PLAN_ROUTE, params={})],
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
                PublicAPIRequest(
                    text="从当前位置出发去吹响的圣地",
                    origin_lat=34.9,
                    origin_lng=135.8,
                )
            )

        assert response.route_history[0]["origin_station"] == "34.9,135.8"
        save_route_kwargs = mock_db.save_route.await_args.kwargs
        assert save_route_kwargs["origin_station"] == "34.9,135.8"
        assert save_route_kwargs["origin_lat"] == 34.9
        assert save_route_kwargs["origin_lon"] == 135.8

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
            text, db, *, model=None, locale="ja", context=None, on_step=None
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


class TestSelectedPointIdsBypass:
    async def test_selected_point_ids_bypass_planner(self, mock_db) -> None:
        captured: dict[str, object] = {}
        executor = MagicMock()

        async def _fake_execute(plan, *, context_block=None, on_step=None):
            captured["plan"] = plan
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
                            {"id": "p1", "latitude": 34.88, "longitude": 135.80},
                            {"id": "p2", "latitude": 34.89, "longitude": 135.81},
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
        assert plan.steps[0].params == {"point_ids": ["p1", "p2"], "origin": "宇治駅"}
        assert response.intent == "plan_selected"
        assert response.ui == {"component": "RoutePlannerWizard"}
