"""
Unit tests for SearchAgent following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
import asyncio
from unittest.mock import Mock, patch, AsyncMock, MagicMock
from datetime import datetime

from agents.base import AgentInput, AgentOutput, AgentState, AgentValidationError
from agents.search_agent import SearchAgent
from domain.entities import Station, Bangumi, Coordinates, NoBangumiFoundError, APIError
from clients.anitabi import AnitabiClient


@pytest.fixture
def mock_anitabi_client():
    """Create a mock AnitabiClient."""
    client = Mock(spec=AnitabiClient)
    client.search_bangumi = AsyncMock()
    return client


@pytest.fixture
def search_agent(mock_anitabi_client):
    """Create a SearchAgent instance with mocked dependencies."""
    return SearchAgent(anitabi_client=mock_anitabi_client)


@pytest.fixture
def sample_station():
    """Create a sample station for testing."""
    return Station(
        name="Tokyo Station",
        coordinates=Coordinates(latitude=35.681236, longitude=139.767125),
        city="Tokyo",
        prefecture="Tokyo"
    )


@pytest.fixture
def sample_bangumi_list():
    """Create sample bangumi list for testing."""
    return [
        Bangumi(
            id="bangumi-1",
            title="Steins;Gate",
            cn_title="命运石之门",
            cover_url="https://example.com/cover1.jpg",
            points_count=5,
            distance_km=1.2
        ),
        Bangumi(
            id="bangumi-2",
            title="Your Name",
            cn_title="你的名字",
            cover_url="https://example.com/cover2.jpg",
            points_count=3,
            distance_km=2.5
        )
    ]


class TestSearchAgent:
    """Test suite for SearchAgent."""

    @pytest.mark.asyncio
    async def test_agent_initialization(self, mock_anitabi_client):
        """Test SearchAgent initialization."""
        agent = SearchAgent(anitabi_client=mock_anitabi_client)

        assert agent.name == "search_agent"
        assert agent.description == "Searches for anime locations near stations"
        assert agent.state == AgentState.IDLE
        assert agent.anitabi_client == mock_anitabi_client

    @pytest.mark.asyncio
    async def test_successful_search_with_results(
        self, search_agent, mock_anitabi_client, sample_station, sample_bangumi_list
    ):
        """Test successful search that returns results."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = sample_bangumi_list

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump(),
                "radius_km": 5.0
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.error is None
        assert "bangumi_list" in result.data
        assert len(result.data["bangumi_list"]) == 2
        assert result.data["bangumi_list"][0]["id"] == "bangumi-1"
        assert result.data["count"] == 2
        assert result.data["search_radius_km"] == 5.0

        # Verify API was called correctly
        mock_anitabi_client.search_bangumi.assert_called_once_with(
            station=sample_station,
            radius_km=5.0
        )

    @pytest.mark.asyncio
    async def test_search_with_no_results(
        self, search_agent, mock_anitabi_client, sample_station
    ):
        """Test search that returns no results."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = []

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump(),
                "radius_km": 3.0
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.error is None
        assert result.data["bangumi_list"] == []
        assert result.data["count"] == 0
        assert result.data["search_radius_km"] == 3.0

    @pytest.mark.asyncio
    async def test_search_with_api_error(
        self, search_agent, mock_anitabi_client, sample_station
    ):
        """Test search when API returns an error."""
        # Arrange
        mock_anitabi_client.search_bangumi.side_effect = APIError("API connection failed")

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump()
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error == "API connection failed"
        assert result.data == {}

    @pytest.mark.asyncio
    async def test_search_with_default_radius(
        self, search_agent, mock_anitabi_client, sample_station, sample_bangumi_list
    ):
        """Test search uses default radius when not specified."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = sample_bangumi_list

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump()
                # No radius_km specified
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is True
        mock_anitabi_client.search_bangumi.assert_called_once_with(
            station=sample_station,
            radius_km=5.0  # Default radius
        )
        assert result.data["search_radius_km"] == 5.0

    @pytest.mark.asyncio
    async def test_search_with_custom_radius(
        self, search_agent, mock_anitabi_client, sample_station
    ):
        """Test search with custom radius."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = []

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump(),
                "radius_km": 10.0
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        mock_anitabi_client.search_bangumi.assert_called_once_with(
            station=sample_station,
            radius_km=10.0
        )

    @pytest.mark.asyncio
    async def test_input_validation_missing_station(self, search_agent):
        """Test input validation when station is missing."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-123",
            data={}  # Missing station
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_invalid_station(self, search_agent):
        """Test input validation with invalid station data."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": "not a valid station dict"
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_invalid_radius(self, search_agent, sample_station):
        """Test input validation with invalid radius."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump(),
                "radius_km": -5.0  # Invalid negative radius
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_search_with_noresults_exception(
        self, search_agent, mock_anitabi_client, sample_station
    ):
        """Test search when API raises NoBangumiFoundError."""
        # Arrange
        mock_anitabi_client.search_bangumi.side_effect = NoBangumiFoundError(
            "No anime found in this area"
        )

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump()
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert result.success is True  # This is not an error, just no results
        assert result.error is None
        assert result.data["bangumi_list"] == []
        assert result.data["count"] == 0

    @pytest.mark.asyncio
    async def test_agent_state_transitions(
        self, search_agent, mock_anitabi_client, sample_station, sample_bangumi_list
    ):
        """Test agent state transitions during execution."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = sample_bangumi_list

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump()
            }
        )

        # Act
        await search_agent.execute(input_data)

        # Assert final state
        assert search_agent.state == AgentState.COMPLETED

    @pytest.mark.asyncio
    async def test_search_metadata_includes_timing(
        self, search_agent, mock_anitabi_client, sample_station, sample_bangumi_list
    ):
        """Test that result metadata includes execution timing."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = sample_bangumi_list

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump()
            }
        )

        # Act
        result = await search_agent.execute(input_data)

        # Assert
        assert "execution_time" in result.metadata
        assert result.metadata["execution_time"] >= 0
        assert "timestamp" in result.metadata
        assert "agent" in result.metadata
        assert result.metadata["agent"] == "search_agent"

    @pytest.mark.asyncio
    async def test_concurrent_searches(
        self, mock_anitabi_client, sample_station, sample_bangumi_list
    ):
        """Test multiple concurrent searches."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = sample_bangumi_list

        # Create multiple agents for concurrent execution
        agents = [SearchAgent(anitabi_client=mock_anitabi_client) for _ in range(3)]

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump()
            }
        )

        # Act - Execute searches concurrently
        results = await asyncio.gather(*[
            agent.execute(input_data) for agent in agents
        ])

        # Assert
        assert len(results) == 3
        for result in results:
            assert result.success is True
            assert len(result.data["bangumi_list"]) == 2

        # Verify API was called 3 times
        assert mock_anitabi_client.search_bangumi.call_count == 3

    @pytest.mark.asyncio
    async def test_agent_cleanup(
        self, search_agent, mock_anitabi_client, sample_station, sample_bangumi_list
    ):
        """Test agent cleanup after execution."""
        # Arrange
        mock_anitabi_client.search_bangumi.return_value = sample_bangumi_list

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "station": sample_station.model_dump()
            }
        )

        # Act
        await search_agent.execute(input_data)
        await search_agent.cleanup()

        # Assert
        assert search_agent.state == AgentState.IDLE
        assert search_agent._start_time is None

    @pytest.mark.asyncio
    async def test_agent_info(self, search_agent):
        """Test agent info retrieval."""
        # Act
        info = search_agent.get_info()

        # Assert
        assert info["name"] == "search_agent"
        assert info["description"] == "Searches for anime locations near stations"
        assert info["state"] == "idle"
        assert info["start_time"] is None