from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from backend.agents.models import ExecutionPlan, ToolName
from backend.agents.planner_agent import PLANNER_SYSTEM_PROMPT, ReActPlannerAgent


@pytest.fixture
def mock_plan_bangumi() -> ExecutionPlan:
    from backend.agents.models import PlanStep

    return ExecutionPlan(
        steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})],
        reasoning="user asked about a specific anime",
        locale="ja",
    )


class TestReActPlannerAgent:
    def test_planner_system_prompt_includes_greet_user_rules(self) -> None:
        assert "greet_user(message: str)" in PLANNER_SYSTEM_PROMPT
        assert "Use greet_user(message: str) for greetings" in PLANNER_SYSTEM_PROMPT
        assert (
            "Use greet_user(message: str) for identity questions"
            in PLANNER_SYSTEM_PROMPT
        )

    def test_planner_system_prompt_prioritizes_real_tasks_over_greetings(self) -> None:
        assert "Do not use it for real pilgrimage queries" in PLANNER_SYSTEM_PROMPT
        assert "hello, plan a route for Your Name in Tokyo" in PLANNER_SYSTEM_PROMPT

    def test_format_context_block_full(self) -> None:
        from backend.agents.planner_agent import _format_context_block

        block = {
            "current_bangumi_id": "253",
            "current_anime_title": "響け！ユーフォニアム",
            "last_location": "宇治",
            "last_intent": "search_bangumi",
            "visited_bangumi_ids": ["253"],
        }

        result = _format_context_block(block)
        assert "[context]" in result
        assert "anime: 響け！ユーフォニアム (bangumi_id: 253)" in result
        assert "last_location: 宇治" in result
        assert "last_intent: search_bangumi" in result
        assert "visited_ids: 253" in result

    def test_format_context_block_minimal(self) -> None:
        from backend.agents.planner_agent import _format_context_block

        block = {
            "current_bangumi_id": None,
            "current_anime_title": None,
            "last_location": "京都",
            "last_intent": None,
            "visited_bangumi_ids": [],
        }

        result = _format_context_block(block)
        assert "last_location: 京都" in result
        assert "anime:" not in result

    def test_format_context_block_renders_summary_first(self) -> None:
        from backend.agents.planner_agent import _format_context_block

        block = {
            "summary": "previous summary",
            "current_bangumi_id": "253",
            "current_anime_title": "響け！ユーフォニアム",
            "last_location": "宇治",
            "last_intent": "search_bangumi",
            "visited_bangumi_ids": ["253"],
        }

        result = _format_context_block(block)
        lines = result.splitlines()
        assert lines[1] == "summary: previous summary"

    async def test_create_plan_returns_execution_plan(self, mock_plan_bangumi):
        with patch("backend.agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            plan = await planner.create_plan("吹響の聖地在哪", locale="ja")

        assert isinstance(plan, ExecutionPlan)
        assert plan.locale == "ja"
        assert len(plan.steps) >= 1

    async def test_create_plan_passes_locale_in_prompt(self, mock_plan_bangumi):
        with patch("backend.agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            await planner.create_plan(
                "where is kyoani",
                locale="en",
                context={
                    "current_bangumi_id": "253",
                    "current_anime_title": "響け！ユーフォニアム",
                    "last_location": "宇治",
                    "last_intent": "search_bangumi",
                    "visited_bangumi_ids": ["253"],
                },
            )

            call_args = mock_agent.run.call_args[0][0]
            assert "en" in call_args
            assert "[context]" in call_args
            assert "anime: 響け！ユーフォニアム (bangumi_id: 253)" in call_args
            assert "visited_ids: 253" in call_args

    async def test_create_plan_supports_greet_user_step(self):
        from backend.agents.models import PlanStep

        greet_plan = ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.GREET_USER,
                    params={"message": "我是圣地巡礼，可以帮你找动漫取景地。"},
                )
            ],
            reasoning="pure greeting",
            locale="zh",
        )

        with patch("backend.agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=greet_plan)
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            plan = await planner.create_plan("你好", locale="zh")

        assert plan.steps == greet_plan.steps
        assert plan.steps[0].tool == ToolName.GREET_USER

    async def test_create_plan_prefixes_context_block(self, mock_plan_bangumi):
        with patch("backend.agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            await planner.create_plan(
                "where is kyoani",
                locale="en",
                context={
                    "current_bangumi_id": "253",
                    "current_anime_title": "響け！ユーフォニアム",
                    "last_location": "宇治",
                    "last_intent": "search_bangumi",
                    "visited_bangumi_ids": ["253", "105"],
                },
            )

            call_args = mock_agent.run.call_args[0][0]
            assert "[context]" in call_args
            assert "anime: 響け！ユーフォニアム (bangumi_id: 253)" in call_args
            assert "visited_ids: 253, 105" in call_args
