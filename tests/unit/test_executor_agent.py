from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.executor_agent import ExecutorAgent, _infer_primary_tool
from agents.models import ExecutionPlan, PlanStep, ToolName


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.find_bangumi_by_title = AsyncMock(return_value=None)
    db.upsert_bangumi_title = AsyncMock()
    return db


def _plan(*steps: PlanStep, locale: str = "ja") -> ExecutionPlan:
    return ExecutionPlan(steps=list(steps), reasoning="test", locale=locale)


class TestExecutorAgentExecute:
    async def test_search_bangumi_empty(self, mock_db):
        plan = _plan(
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "search_bangumi"
        assert result.success
        assert result.final_output["status"] == "empty"

    async def test_search_nearby_delegates_to_retriever(self, mock_db):
        mock_db.search_points_by_location.return_value = [
            {"id": "p1", "bangumi_id": "115908", "distance_m": 200}
        ]
        plan = _plan(PlanStep(tool=ToolName.SEARCH_NEARBY, params={"location": "宇治"}))
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "search_nearby"
        assert result.success

    async def test_plan_route_uses_nn_sort(self, mock_db):
        rows = [
            {"id": "a", "latitude": 34.88, "longitude": 135.80},
            {"id": "b", "latitude": 34.89, "longitude": 135.79},
        ]
        mock_db.pool.fetch.return_value = rows
        plan = _plan(
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}),
            PlanStep(tool=ToolName.PLAN_ROUTE, params={}),
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "plan_route"
        assert result.success
        route = result.final_output.get("route", {})
        assert route.get("point_count", 0) == 2

    async def test_plan_route_uses_context_last_location_as_origin(self, mock_db):
        rows = [
            {"id": "near", "latitude": 0.05, "longitude": 0.05},
            {"id": "far", "latitude": 10.0, "longitude": 10.0},
        ]
        mock_db.pool.fetch.return_value = rows
        plan = _plan(
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}),
            PlanStep(tool=ToolName.PLAN_ROUTE, params={}),
        )
        executor = ExecutorAgent(mock_db)

        with patch("agents.executor_agent.resolve_location", new=AsyncMock(return_value=(0.0, 0.0))):
            result = await executor.execute(
                plan,
                context_block={"last_location": "京都駅"},
            )

        route = result.final_output.get("route", {})
        ordered_points = route.get("ordered_points", [])
        assert ordered_points and ordered_points[0]["id"] == "near"

    async def test_resolve_anime_db_hit(self, mock_db):
        mock_db.find_bangumi_by_title.return_value = "115908"
        plan = _plan(
            PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "吹响"}),
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": None}),
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.success
        mock_db.find_bangumi_by_title.assert_awaited_once_with("吹响")

    async def test_answer_question(self, mock_db):
        plan = _plan(
            PlanStep(tool=ToolName.ANSWER_QUESTION, params={"answer": "おはよう"})
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert result.intent == "answer_question"
        assert result.success

    async def test_greet_user_returns_info_message(self, mock_db):
        plan = _plan(
            PlanStep(
                tool=ToolName.GREET_USER,
                params={"message": "我是圣地巡礼，可以帮你找动漫取景地。"},
            ),
            locale="zh",
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)

        assert result.intent == "greet_user"
        assert result.success
        assert result.final_output["message"] == "我是圣地巡礼，可以帮你找动漫取景地。"
        assert result.final_output["status"] == "info"
        assert "results" not in result.final_output
        assert "route" not in result.final_output

    async def test_locale_en_message(self, mock_db):
        mock_db.pool.fetch.return_value = [
            {"id": "p1", "bangumi_id": "115908", "latitude": None, "longitude": None}
        ]
        plan = _plan(
            PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}),
            locale="en",
        )
        executor = ExecutorAgent(mock_db)
        result = await executor.execute(plan)
        assert "Found" in result.final_output.get("message", "")

    async def test_execute_calls_on_step_for_each_tool(self, mock_db):
        plan = _plan(
            PlanStep(tool=ToolName.ANSWER_QUESTION, params={"answer": "hi"})
        )
        events: list[tuple[str, str]] = []

        async def on_step(tool: str, status: str, data: dict[str, object]) -> None:
            events.append((tool, status))

        executor = ExecutorAgent(mock_db)
        await executor.execute(plan, on_step=on_step)

        assert ("answer_question", "running") in events
        assert ("answer_question", "done") in events

    def test_infer_primary_tool_includes_greet_user(self):
        plan = _plan(
            PlanStep(tool=ToolName.GREET_USER, params={"message": "Hello there"})
        )

        assert _infer_primary_tool(plan) == "greet_user"

    def test_infer_primary_tool_prefers_real_task_over_greeting(self):
        plan = _plan(
            PlanStep(tool=ToolName.GREET_USER, params={"message": "Hello there"}),
            PlanStep(tool=ToolName.SEARCH_NEARBY, params={"location": "宇治駅"}),
        )

        assert _infer_primary_tool(plan) == "search_nearby"
