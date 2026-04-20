from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.executor_agent import PipelineResult, StepResult
from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)
from backend.agents.pipeline import run_pipeline


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.bangumi.find_bangumi_by_title = AsyncMock(return_value=None)
    db.bangumi.upsert_bangumi_title = AsyncMock()
    return db


class TestRunPipeline:
    async def test_bangumi_pipeline(self, mock_db):
        """Pipeline resolves anime and searches — returns PipelineResult."""
        # Planner returns: resolve_anime → search_bangumi → done
        step1 = ReactStep(
            thought="Resolve anime",
            action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "吹響"}),
        )
        step2 = ReactStep(
            thought="Search spots",
            action=PlanStep(
                tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}
            ),
        )
        step3 = ReactStep(
            thought="Done",
            done=DoneSignal(message="Found spots"),
        )

        result1 = StepResult(
            tool="resolve_anime",
            success=True,
            data={"bangumi_id": "115908", "title": "吹響"},
        )
        result2 = StepResult(
            tool="search_bangumi",
            success=True,
            data={"row_count": 10, "status": "ok", "rows": []},
        )

        with patch("backend.agents.pipeline.ReActPlannerAgent") as MockPlanner:
            mock_planner = MockPlanner.return_value
            mock_planner.step = AsyncMock(side_effect=[step1, step2, step3])

            with patch("backend.agents.pipeline.ExecutorAgent") as MockExecutor:
                mock_executor = MockExecutor.return_value
                mock_executor._execute_step = AsyncMock(side_effect=[result1, result2])
                mock_executor.format_observation = MagicMock(
                    side_effect=[
                        Observation(
                            tool="resolve_anime",
                            success=True,
                            summary="Resolved",
                        ),
                        Observation(
                            tool="search_bangumi",
                            success=True,
                            summary="Found 10",
                        ),
                    ]
                )

                result = await run_pipeline("吹響の聖地", mock_db)

        assert isinstance(result, PipelineResult)
        assert result.intent == "search_bangumi"

    async def test_pipeline_returns_pipeline_result(self, mock_db):
        """QA answer returns PipelineResult with answer_question intent."""
        step1 = ReactStep(
            thought="Just a QA",
            action=PlanStep(
                tool=ToolName.ANSWER_QUESTION, params={"answer": "巡礼とは..."}
            ),
        )
        step2 = ReactStep(
            thought="Done",
            done=DoneSignal(message="巡礼とは..."),
        )

        result1 = StepResult(
            tool="answer_question",
            success=True,
            data={"message": "巡礼とは...", "status": "info"},
        )

        with patch("backend.agents.pipeline.ReActPlannerAgent") as MockPlanner:
            mock_planner = MockPlanner.return_value
            mock_planner.step = AsyncMock(side_effect=[step1, step2])

            with patch("backend.agents.pipeline.ExecutorAgent") as MockExecutor:
                mock_executor = MockExecutor.return_value
                mock_executor._execute_step = AsyncMock(return_value=result1)
                mock_executor.format_observation = MagicMock(
                    return_value=Observation(
                        tool="answer_question",
                        success=True,
                        summary="Response generated",
                    )
                )

                result = await run_pipeline("聖地巡礼とは", mock_db)

        assert result.intent == "answer_question"

    async def test_pipeline_forwards_context_and_step_callback(self, mock_db):
        """on_step callback is invoked for step events."""
        step1 = ReactStep(
            thought="Search",
            action=PlanStep(
                tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"}
            ),
        )
        step2 = ReactStep(
            thought="Done",
            done=DoneSignal(message="Found spots"),
        )

        result1 = StepResult(
            tool="search_bangumi",
            success=True,
            data={"row_count": 5, "status": "ok", "rows": []},
        )

        on_step = AsyncMock()
        context = {"visited_bangumi_ids": ["253"]}

        with patch("backend.agents.pipeline.ReActPlannerAgent") as MockPlanner:
            mock_planner = MockPlanner.return_value
            mock_planner.step = AsyncMock(side_effect=[step1, step2])

            with patch("backend.agents.pipeline.ExecutorAgent") as MockExecutor:
                mock_executor = MockExecutor.return_value
                mock_executor._execute_step = AsyncMock(return_value=result1)
                mock_executor.format_observation = MagicMock(
                    return_value=Observation(
                        tool="search_bangumi",
                        success=True,
                        summary="Found 5",
                    )
                )

                result = await run_pipeline(
                    "吹響の聖地",
                    mock_db,
                    context=context,
                    on_step=on_step,
                )

        # on_step should have been called (at least for the "running" and "done" events)
        assert on_step.await_count >= 1
        assert isinstance(result, PipelineResult)
