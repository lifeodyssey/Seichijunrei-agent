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
            await planner.create_plan("where is kyoani", locale="en")

            call_args = mock_agent.run.call_args[0][0]
            assert "en" in call_args
