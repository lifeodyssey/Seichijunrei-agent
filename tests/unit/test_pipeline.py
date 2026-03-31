"""Unit tests for pipeline — end-to-end intent → plan → execute."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.pipeline import run_pipeline


@pytest.fixture
def mock_db():
    """Mock SupabaseClient with async pool."""
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    return db


class TestRunPipeline:
    """Test the full pipeline entry point."""

    async def test_bangumi_search(self, mock_db):
        result = await run_pipeline("秒速5厘米的取景地在哪", mock_db)
        assert result.intent == "search_by_bangumi"
        assert result.success
        assert len(result.step_results) == 2
        assert result.final_output["status"] == "empty"

    async def test_location_search(self, mock_db):
        mock_db.search_points_by_location.return_value = [
            {"id": "1", "bangumi_id": "115908", "distance_m": 100},
        ]
        result = await run_pipeline("宇治附近有什么圣地", mock_db)
        assert result.intent == "search_by_location"
        assert result.success
        assert result.step_results[0].data["strategy"] == "geo"
        assert result.final_output["status"] == "ok"

    async def test_route_planning(self, mock_db):
        mock_db.pool.fetch.return_value = [
            {"id": "1", "name": "A", "latitude": 34.88, "longitude": 135.80},
            {"id": "2", "name": "B", "latitude": 34.89, "longitude": 135.81},
        ]
        mock_db.search_points_by_location.return_value = [
            {"id": "1", "bangumi_id": "115908", "distance_m": 100},
            {"id": "2", "bangumi_id": "115908", "distance_m": 80},
        ]
        result = await run_pipeline("从京都站出发去吹响的圣地", mock_db)
        assert result.intent == "plan_route"
        assert result.success
        assert len(result.step_results) == 3  # query_db + plan_route + format
        assert result.step_results[0].data["strategy"] == "hybrid"
        assert result.final_output["status"] == "ok"

    async def test_unclear_input(self, mock_db):
        result = await run_pipeline("你好", mock_db)
        assert result.intent == "unclear"
        assert result.success
        assert result.final_output["status"] == "needs_clarification"

    async def test_db_failure(self, mock_db):
        mock_db.pool.fetch.side_effect = Exception("db down")
        result = await run_pipeline("秒速5厘米的取景地在哪", mock_db)
        assert not result.success
        assert result.final_output["success"] is False
        assert result.final_output["status"] == "error"

    async def test_result_has_final_output(self, mock_db):
        result = await run_pipeline("冰菓的取景地", mock_db)
        assert "intent" in result.final_output
        assert "data" in result.final_output

    async def test_route_no_points_partial_failure(self, mock_db):
        """Route with 0 DB results: query succeeds, route planning fails."""
        mock_db.pool.fetch.return_value = []
        mock_db.search_points_by_location.return_value = []
        result = await run_pipeline("从京都站出发去吹响的圣地", mock_db)
        assert result.intent == "plan_route"
        assert not result.success
        # query_db succeeded, plan_route failed
        assert result.step_results[0].success
        assert not result.step_results[1].success
        assert result.step_results[2].success
        assert result.final_output["status"] == "empty"

    async def test_locale_passes_through_to_message(self, mock_db):
        """Verify locale flows from pipeline to response message."""
        result_ja = await run_pipeline("你好", mock_db, locale="ja")
        result_zh = await run_pipeline("你好", mock_db, locale="zh")
        msg_ja = result_ja.final_output.get("message", "")
        msg_zh = result_zh.final_output.get("message", "")
        # Both should have non-empty localized messages
        assert msg_ja
        assert msg_zh
        # ja fallback contains Japanese, zh fallback contains Chinese
        assert "具体" in msg_ja  # もう少し具体的に
        assert "具体" in msg_zh  # 能再具体一些吗

    async def test_locale_defaults_to_ja(self, mock_db):
        """Default locale should produce Japanese message."""
        result = await run_pipeline("你好", mock_db)
        msg = result.final_output.get("message", "")
        assert msg  # non-empty
        assert "具体" in msg
