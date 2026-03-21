"""Unit tests for ExecutorAgent — step execution and pipeline results."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.executor_agent import (
    ExecutorAgent,
    PipelineResult,
    StepResult,
    _nearest_neighbor_sort,
)
from agents.intent_agent import ExtractedParams, IntentOutput
from agents.planner_agent import create_plan
from agents.retriever import RetrievalResult, RetrievalStrategy


@pytest.fixture
def mock_db():
    """Mock SupabaseClient with async pool."""
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    return db


@pytest.fixture
def executor(mock_db):
    return ExecutorAgent(mock_db)


def _make_intent(intent: str, **kwargs) -> IntentOutput:
    return IntentOutput(
        intent=intent,
        confidence=0.95,
        extracted_params=ExtractedParams(**kwargs),
    )


class TestStepResult:
    """Test StepResult dataclass."""

    def test_success(self):
        r = StepResult(step_type="query_db", success=True, data={"rows": []})
        assert r.success is True
        assert r.error is None

    def test_failure(self):
        r = StepResult(step_type="query_db", success=False, error="boom")
        assert r.success is False


class TestPipelineResult:
    """Test PipelineResult dataclass."""

    def test_success_when_all_steps_pass(self):
        r = PipelineResult(
            intent="search_by_bangumi",
            plan=create_plan(_make_intent("search_by_bangumi", bangumi="927")),
            step_results=[
                StepResult(step_type="query_db", success=True),
                StepResult(step_type="format_response", success=True),
            ],
        )
        assert r.success is True

    def test_failure_when_any_step_fails(self):
        r = PipelineResult(
            intent="search_by_bangumi",
            plan=create_plan(_make_intent("search_by_bangumi", bangumi="927")),
            step_results=[
                StepResult(step_type="query_db", success=False, error="db down"),
            ],
        )
        assert r.success is False


class TestExecutorQueryDB:
    """Test query_db step execution."""

    async def test_bangumi_search(self, executor, mock_db):
        intent = _make_intent("search_by_bangumi", bangumi="115908")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.success
        assert len(result.step_results) == 2
        assert result.step_results[0].step_type == "query_db"
        mock_db.pool.fetch.assert_called_once()
        assert result.step_results[0].data["strategy"] == "sql"
        assert result.step_results[0].data["empty"] is True
        assert result.step_results[0].data["summary"]["count"] == 0

    async def test_location_search(self, executor, mock_db):
        mock_db.search_points_by_location.return_value = [
            {"id": "1", "name": "A", "bangumi_id": "115908", "distance_m": 100},
        ]
        intent = _make_intent("search_by_location", location="宇治")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.success
        assert result.step_results[0].step_type == "query_db"
        assert result.step_results[0].data["strategy"] == "geo"
        assert result.step_results[0].data["status"] == "ok"
        mock_db.search_points_by_location.assert_called_once()

    async def test_db_error_stops_pipeline(self, executor, mock_db):
        mock_db.pool.fetch.side_effect = Exception("connection refused")
        intent = _make_intent("search_by_bangumi", bangumi="927")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert not result.success
        assert len(result.step_results) == 2  # failure + formatted response
        assert "connection refused" in result.step_results[0].error
        assert result.step_results[1].step_type == "format_response"


class TestExecutorPlanRoute:
    """Test plan_route step execution."""

    async def test_route_with_points(self, executor, mock_db):
        mock_db.pool.fetch.return_value = [
            {"id": "1", "name": "A", "latitude": 34.88, "longitude": 135.80},
            {"id": "2", "name": "B", "latitude": 34.89, "longitude": 135.81},
            {"id": "3", "name": "C", "latitude": 34.87, "longitude": 135.79},
        ]
        mock_db.search_points_by_location.return_value = [
            {"id": "1", "bangumi_id": "115908", "distance_m": 100},
            {"id": "2", "bangumi_id": "115908", "distance_m": 80},
            {"id": "3", "bangumi_id": "115908", "distance_m": 120},
        ]
        intent = _make_intent("plan_route", bangumi="115908", origin="宇治")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.success
        assert result.step_results[0].data["strategy"] == "hybrid"
        route_step = result.step_results[1]
        assert route_step.step_type == "plan_route"
        assert route_step.data["point_count"] == 3
        assert route_step.data["summary"]["with_coordinates"] == 3

    async def test_route_no_points(self, executor, mock_db):
        """Route planning with no DB results should fail gracefully."""
        mock_db.pool.fetch.return_value = []
        mock_db.search_points_by_location.return_value = []
        intent = _make_intent("plan_route", bangumi="115908")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        # query_db succeeds (0 rows), plan_route fails (no points)
        assert result.step_results[0].success  # query_db
        assert not result.step_results[1].success  # plan_route
        assert result.step_results[2].success  # format_response still runs
        assert result.final_output["status"] == "empty"
        assert "route" in result.final_output["message"].lower()


class TestExecutorFormatResponse:
    """Test format_response step."""

    async def test_unclear_message(self, executor):
        intent = _make_intent("unclear")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.success
        fmt = result.step_results[0]
        assert "more specific" in fmt.data.get("message", "").lower()

    async def test_general_qa_message(self, executor):
        intent = _make_intent("general_qa")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.success
        assert result.final_output["status"] == "info"

    async def test_empty_bangumi_search_has_empty_status(self, executor, mock_db):
        intent = _make_intent("search_by_bangumi", bangumi="927")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.success
        assert result.final_output["status"] == "empty"
        assert "no pilgrimage points" in result.final_output["message"].lower()

    async def test_notices_include_fallback_and_cache(self, executor):
        executor._retriever.execute = AsyncMock(  # noqa: SLF001
            return_value=RetrievalResult(
                strategy=RetrievalStrategy.SQL,
                rows=[{"id": "p1"}],
                row_count=1,
                metadata={"data_origin": "fallback", "cache": "write"},
            )
        )
        intent = _make_intent("search_by_bangumi", bangumi="115908")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        notices = result.final_output["data"]["notices"]
        assert any("cache" in notice.lower() for notice in notices)
        assert any("anitabi" in notice.lower() for notice in notices)


class TestExecutorFinalOutput:
    """Test final output building."""

    async def test_output_has_intent(self, executor, mock_db):
        intent = _make_intent("search_by_bangumi", bangumi="927")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.final_output["intent"] == "search_by_bangumi"
        assert result.final_output["success"] is True
        assert result.final_output["data"]["results"]["strategy"] == "sql"
        assert result.final_output["status"] == "empty"

    async def test_output_has_errors_on_failure(self, executor, mock_db):
        mock_db.pool.fetch.side_effect = Exception("timeout")
        intent = _make_intent("search_by_bangumi", bangumi="927")
        plan = create_plan(intent)
        result = await executor.execute(plan, intent)
        assert result.final_output["success"] is False
        assert "errors" in result.final_output
        assert result.final_output["status"] == "error"
        assert "retrieve" in result.final_output["message"].lower()


class TestNearestNeighborSort:
    """Test the nearest-neighbor route optimization."""

    def test_empty(self):
        assert _nearest_neighbor_sort([]) == []

    def test_single(self):
        rows = [{"latitude": 34.88, "longitude": 135.80}]
        assert _nearest_neighbor_sort(rows) == rows

    def test_sorts_by_proximity(self):
        rows = [
            {"id": "A", "latitude": 34.88, "longitude": 135.80},
            {"id": "C", "latitude": 34.90, "longitude": 135.82},
            {"id": "B", "latitude": 34.885, "longitude": 135.805},
        ]
        result = _nearest_neighbor_sort(rows)
        # Starting from A, B is closer than C
        assert result[0]["id"] == "A"
        assert result[1]["id"] == "B"
        assert result[2]["id"] == "C"

    def test_rows_without_coords_appended(self):
        rows = [
            {"id": "A", "latitude": 34.88, "longitude": 135.80},
            {"id": "no_coords"},
            {"id": "B", "latitude": 34.89, "longitude": 135.81},
        ]
        result = _nearest_neighbor_sort(rows)
        assert result[-1]["id"] == "no_coords"
