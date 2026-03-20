"""Unit tests for pipeline — end-to-end intent → plan → execute."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.pipeline import run_pipeline


@pytest.fixture
def mock_db():
    """Mock SupabaseClient with async pool."""
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    return db


class TestRunPipeline:
    """Test the full pipeline entry point."""

    async def test_bangumi_search(self, mock_db):
        result = await run_pipeline("秒速5厘米的取景地在哪", mock_db)
        assert result.intent == "search_by_bangumi"
        assert result.success
        assert len(result.step_results) == 2

    async def test_location_search(self, mock_db):
        result = await run_pipeline("宇治附近有什么圣地", mock_db)
        assert result.intent == "search_by_location"
        assert result.success

    async def test_route_planning(self, mock_db):
        mock_db.pool.fetch.return_value = [
            {"id": "1", "name": "A", "latitude": 34.88, "longitude": 135.80},
            {"id": "2", "name": "B", "latitude": 34.89, "longitude": 135.81},
        ]
        result = await run_pipeline("从京都站出发去吹响的圣地", mock_db)
        assert result.intent == "plan_route"
        assert result.success
        assert len(result.step_results) == 3  # query_db + plan_route + format

    async def test_unclear_input(self, mock_db):
        result = await run_pipeline("你好", mock_db)
        assert result.intent == "unclear"
        assert result.success

    async def test_db_failure(self, mock_db):
        mock_db.pool.fetch.side_effect = Exception("db down")
        result = await run_pipeline("秒速5厘米的取景地在哪", mock_db)
        assert not result.success
        assert result.final_output["success"] is False

    async def test_result_has_final_output(self, mock_db):
        result = await run_pipeline("冰菓的取景地", mock_db)
        assert "intent" in result.final_output
        assert "data" in result.final_output

    async def test_route_no_points_partial_failure(self, mock_db):
        """Route with 0 DB results: query succeeds, route planning fails."""
        mock_db.pool.fetch.return_value = []
        result = await run_pipeline("从京都站出发去吹响的圣地", mock_db)
        assert result.intent == "plan_route"
        assert not result.success
        # query_db succeeded, plan_route failed
        assert result.step_results[0].success
        assert not result.step_results[1].success
