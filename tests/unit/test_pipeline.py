from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.executor_agent import PipelineResult
from agents.models import ExecutionPlan, PlanStep, ToolName
from agents.pipeline import run_pipeline


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


class TestRunPipeline:
    async def test_bangumi_pipeline(self, mock_db):
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})],
            reasoning="test",
            locale="ja",
        )
        with patch("agents.pipeline.ReActPlannerAgent") as MockPlanner:
            MockPlanner.return_value.create_plan = AsyncMock(return_value=plan)
            result = await run_pipeline("吹響の聖地", mock_db)

        assert isinstance(result, PipelineResult)
        assert result.intent == "search_bangumi"
        assert result.success

    async def test_pipeline_returns_pipeline_result(self, mock_db):
        plan = ExecutionPlan(
            steps=[PlanStep(tool=ToolName.ANSWER_QUESTION, params={"answer": "巡礼とは..."})],
            reasoning="qa",
            locale="ja",
        )
        with patch("agents.pipeline.ReActPlannerAgent") as MockPlanner:
            MockPlanner.return_value.create_plan = AsyncMock(return_value=plan)
            result = await run_pipeline("聖地巡礼とは", mock_db)

        assert result.intent == "answer_question"
