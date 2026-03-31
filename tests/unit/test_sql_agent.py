"""Unit tests for SQLAgent."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.models import RetrievalRequest
from agents.sql_agent import SQLAgent, SQLResult


@pytest.fixture
def mock_db():
    """Mock SupabaseClient with async pool."""
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    return db


class TestSQLResult:
    """Test SQLResult dataclass."""

    def test_success_when_no_error(self):
        r = SQLResult(query="SELECT 1", params=[], rows=[{"a": 1}], row_count=1)
        assert r.success is True

    def test_failure_when_error(self):
        r = SQLResult(query="", params=[], error="boom")
        assert r.success is False


class TestSQLAgentExecute:
    @pytest.mark.asyncio
    async def test_bangumi_query(self, mock_db):
        agent = SQLAgent(mock_db)
        req = RetrievalRequest(tool="search_bangumi", bangumi_id="115908")
        result = await agent.execute(req)
        assert result.success
        mock_db.pool.fetch.assert_awaited_once()
        sql = mock_db.pool.fetch.call_args[0][0]
        assert "bangumi_id" in sql
        assert "$1" in sql

    @pytest.mark.asyncio
    async def test_bangumi_with_episode(self, mock_db):
        agent = SQLAgent(mock_db)
        req = RetrievalRequest(tool="search_bangumi", bangumi_id="115908", episode=3)
        result = await agent.execute(req)
        assert result.success
        sql = mock_db.pool.fetch.call_args[0][0]
        assert "episode" in sql

    @pytest.mark.asyncio
    async def test_nearby_query(self, mock_db):
        mock_db.search_points_by_location = AsyncMock(return_value=[])
        agent = SQLAgent(mock_db)
        req = RetrievalRequest(tool="search_nearby", location="宇治", radius=3000)
        result = await agent.execute(req)
        assert result.success
