from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from agents.models import ExecutionPlan, ToolName
from agents.planner_agent import ReActPlannerAgent


@pytest.fixture
def mock_plan_bangumi() -> ExecutionPlan:
    from agents.models import PlanStep

    return ExecutionPlan(
        steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})],
        reasoning="user asked about a specific anime",
        locale="ja",
    )


class TestReActPlannerAgent:
    def test_format_context_block_full(self) -> None:
        from agents.planner_agent import _format_context_block

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
        from agents.planner_agent import _format_context_block

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

    async def test_create_plan_returns_execution_plan(self, mock_plan_bangumi):
        with patch("agents.planner_agent.create_agent") as mock_create:
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent

            planner = ReActPlannerAgent()
            plan = await planner.create_plan("吹響の聖地在哪", locale="ja")

        assert isinstance(plan, ExecutionPlan)
        assert plan.locale == "ja"
        assert len(plan.steps) >= 1

    async def test_create_plan_passes_locale_in_prompt(self, mock_plan_bangumi):
        with patch("agents.planner_agent.create_agent") as mock_create:
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
