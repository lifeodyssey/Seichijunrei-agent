"""Unit tests for SQLAgent — query generation and execution."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.intent_agent import ExtractedParams, IntentOutput
from agents.sql_agent import KNOWN_LOCATIONS, SQLAgent, SQLResult


@pytest.fixture
def mock_db():
    """Mock SupabaseClient with async pool."""
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    return db


@pytest.fixture
def agent(mock_db):
    return SQLAgent(mock_db)


class TestSQLResult:
    """Test SQLResult dataclass."""

    def test_success_when_no_error(self):
        r = SQLResult(query="SELECT 1", params=[], rows=[{"a": 1}], row_count=1)
        assert r.success is True

    def test_failure_when_error(self):
        r = SQLResult(query="", params=[], error="boom")
        assert r.success is False


class TestSearchByBangumi:
    """Test bangumi search query generation."""

    @pytest.mark.asyncio
    async def test_basic_search(self, agent, mock_db):
        intent = IntentOutput(
            intent="search_by_bangumi",
            confidence=0.95,
            extracted_params=ExtractedParams(bangumi="115908"),
        )
        result = await agent.execute(intent)
        assert result.success
        mock_db.pool.fetch.assert_called_once()
        call_args = mock_db.pool.fetch.call_args
        sql = call_args[0][0]
        assert "WHERE p.bangumi_id = $1" in sql
        assert "LIMIT" in sql
        assert call_args[0][1] == "115908"

    @pytest.mark.asyncio
    async def test_search_with_episode(self, agent, mock_db):
        intent = IntentOutput(
            intent="search_by_bangumi",
            confidence=0.95,
            extracted_params=ExtractedParams(bangumi="115908", episode=3),
        )
        result = await agent.execute(intent)
        assert result.success
        call_args = mock_db.pool.fetch.call_args
        sql = call_args[0][0]
        assert "p.episode = $2" in sql
        assert call_args[0][1] == "115908"
        assert call_args[0][2] == 3

    @pytest.mark.asyncio
    async def test_missing_bangumi_id(self, agent):
        intent = IntentOutput(
            intent="search_by_bangumi",
            confidence=0.95,
            extracted_params=ExtractedParams(),
        )
        result = await agent.execute(intent)
        assert not result.success
        assert "Missing bangumi ID" in result.error


class TestSearchByLocation:
    """Test location-based search query generation."""

    @pytest.mark.asyncio
    async def test_known_location(self, agent, mock_db):
        intent = IntentOutput(
            intent="search_by_location",
            confidence=0.90,
            extracted_params=ExtractedParams(location="宇治"),
        )
        result = await agent.execute(intent)
        assert result.success
        call_args = mock_db.pool.fetch.call_args
        sql = call_args[0][0]
        assert "ST_DWithin" in sql
        lon, lat = KNOWN_LOCATIONS["宇治"][1], KNOWN_LOCATIONS["宇治"][0]
        assert call_args[0][1] == lon
        assert call_args[0][2] == lat

    @pytest.mark.asyncio
    async def test_unknown_location(self, agent):
        intent = IntentOutput(
            intent="search_by_location",
            confidence=0.90,
            extracted_params=ExtractedParams(location="不存在的地方"),
        )
        result = await agent.execute(intent)
        assert not result.success
        assert "Unknown location" in result.error


class TestPlanRoute:
    """Test route planning query generation."""

    @pytest.mark.asyncio
    async def test_route_with_origin(self, agent, mock_db):
        intent = IntentOutput(
            intent="plan_route",
            confidence=0.95,
            extracted_params=ExtractedParams(bangumi="115908", origin="京都站"),
        )
        result = await agent.execute(intent)
        assert result.success
        call_args = mock_db.pool.fetch.call_args
        sql = call_args[0][0]
        assert "ST_Distance" in sql
        assert "ORDER BY distance_m" in sql
        assert "LIMIT" in sql

    @pytest.mark.asyncio
    async def test_route_without_origin(self, agent, mock_db):
        intent = IntentOutput(
            intent="plan_route",
            confidence=0.95,
            extracted_params=ExtractedParams(bangumi="115908"),
        )
        result = await agent.execute(intent)
        assert result.success
        call_args = mock_db.pool.fetch.call_args
        sql = call_args[0][0]
        assert "ORDER BY p.episode" in sql

    @pytest.mark.asyncio
    async def test_route_missing_bangumi(self, agent):
        intent = IntentOutput(
            intent="plan_route",
            confidence=0.95,
            extracted_params=ExtractedParams(origin="京都站"),
        )
        result = await agent.execute(intent)
        assert not result.success


class TestUnsupportedIntent:
    """Test handling of intents without SQL handlers."""

    @pytest.mark.asyncio
    async def test_general_qa(self, agent):
        intent = IntentOutput(
            intent="general_qa",
            confidence=0.80,
            extracted_params=ExtractedParams(),
        )
        result = await agent.execute(intent)
        assert not result.success
        assert "No SQL handler" in result.error

    @pytest.mark.asyncio
    async def test_unclear(self, agent):
        intent = IntentOutput(
            intent="unclear",
            confidence=0.85,
            extracted_params=ExtractedParams(),
        )
        result = await agent.execute(intent)
        assert not result.success


class TestSQLSafety:
    """Verify SQL injection safety."""

    @pytest.mark.asyncio
    async def test_no_string_interpolation(self, agent, mock_db):
        """Ensure user input never appears directly in SQL string."""
        intent = IntentOutput(
            intent="search_by_bangumi",
            confidence=0.95,
            extracted_params=ExtractedParams(bangumi="'; DROP TABLE points; --"),
        )
        result = await agent.execute(intent)
        assert result.success
        call_args = mock_db.pool.fetch.call_args
        sql = call_args[0][0]
        assert "DROP TABLE" not in sql
        assert call_args[0][1] == "'; DROP TABLE points; --"
