"""
Unit tests for OrchestratorAgent following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from agents.base import AgentInput, AgentOutput, AgentState
from agents.orchestrator_agent import OrchestratorAgent
from domain.entities import (
    Station, Point, Route, RouteSegment, TransportInfo, Coordinates,
    Bangumi, Weather, PilgrimageSession, APIError
)


@pytest.fixture
def mock_search_agent():
    """Create a mock SearchAgent."""
    agent = Mock()
    agent.execute = AsyncMock()
    agent.name = "search_agent"
    return agent


@pytest.fixture
def mock_weather_agent():
    """Create a mock WeatherAgent."""
    agent = Mock()
    agent.execute = AsyncMock()
    agent.name = "weather_agent"
    return agent


@pytest.fixture
def mock_filter_agent():
    """Create a mock FilterAgent."""
    agent = Mock()
    agent.execute = AsyncMock()
    agent.name = "filter_agent"
    return agent


@pytest.fixture
def mock_poi_agent():
    """Create a mock POIAgent."""
    agent = Mock()
    agent.execute = AsyncMock()
    agent.name = "poi_agent"
    return agent


@pytest.fixture
def mock_route_agent():
    """Create a mock RouteAgent."""
    agent = Mock()
    agent.execute = AsyncMock()
    agent.name = "route_agent"
    return agent


@pytest.fixture
def mock_transport_agent():
    """Create a mock TransportAgent."""
    agent = Mock()
    agent.execute = AsyncMock()
    agent.name = "transport_agent"
    return agent


@pytest.fixture
def orchestrator_agent(
    mock_search_agent,
    mock_weather_agent,
    mock_filter_agent,
    mock_poi_agent,
    mock_route_agent,
    mock_transport_agent
):
    """Create an OrchestratorAgent with all mocked sub-agents."""
    return OrchestratorAgent(
        search_agent=mock_search_agent,
        weather_agent=mock_weather_agent,
        filter_agent=mock_filter_agent,
        poi_agent=mock_poi_agent,
        route_agent=mock_route_agent,
        transport_agent=mock_transport_agent
    )


@pytest.fixture
def sample_station():
    """Sample station data."""
    return {
        "name": "Shinjuku Station",
        "coordinates": {"latitude": 35.6896, "longitude": 139.7006},
        "city": "Tokyo",
        "prefecture": "Tokyo"
    }


@pytest.fixture
def sample_bangumi_list():
    """Sample bangumi list."""
    return [
        {
            "id": "115908",
            "title": "Your Name",
            "cn_title": "你的名字",
            "cover_url": "https://example.com/cover1.jpg",
            "points_count": 15,
            "distance_km": 1.2
        },
        {
            "id": "126461",
            "title": "Weathering with You",
            "cn_title": "天气之子",
            "cover_url": "https://example.com/cover2.jpg",
            "points_count": 10,
            "distance_km": 2.0
        }
    ]


@pytest.fixture
def sample_points():
    """Sample points list."""
    return [
        {
            "id": "point-1",
            "name": "Shinjuku Gyoen",
            "cn_name": "新宿御苑",
            "coordinates": {"latitude": 35.6851, "longitude": 139.7100},
            "bangumi_id": "115908",
            "bangumi_title": "Your Name",
            "episode": 12,
            "time_seconds": 345,
            "screenshot_url": "https://example.com/screenshot1.jpg"
        },
        {
            "id": "point-2",
            "name": "Yoyogi Park",
            "cn_name": "代代木公园",
            "coordinates": {"latitude": 35.6700, "longitude": 139.7200},
            "bangumi_id": "126461",
            "bangumi_title": "Weathering with You",
            "episode": 5,
            "time_seconds": 180,
            "screenshot_url": "https://example.com/screenshot2.jpg"
        }
    ]


@pytest.fixture
def sample_route(sample_station, sample_points):
    """Sample route data."""
    transport1 = {
        "mode": "walking",
        "distance_meters": 1200,
        "duration_minutes": 15,
        "instructions": "Walk south"
    }

    transport2 = {
        "mode": "transit",
        "distance_meters": 1500,
        "duration_minutes": 10,
        "instructions": "Take subway"
    }

    return {
        "origin": sample_station,
        "segments": [
            {
                "order": 1,
                "point": sample_points[0],
                "transport": transport1,
                "cumulative_distance_km": 1.2,
                "cumulative_duration_minutes": 15
            },
            {
                "order": 2,
                "point": sample_points[1],
                "transport": transport2,
                "cumulative_distance_km": 2.7,
                "cumulative_duration_minutes": 25
            }
        ],
        "total_distance_km": 2.7,
        "total_duration_minutes": 25,
        "google_maps_url": "https://www.google.com/maps/dir/..."
    }


@pytest.fixture
def sample_weather():
    """Sample weather data."""
    return {
        "date": "2025-11-24",
        "location": "Tokyo",
        "condition": "Sunny",
        "temperature_high": 18,
        "temperature_low": 12,
        "precipitation_chance": 10,
        "wind_speed_kmh": 15,
        "recommendation": "Perfect weather for pilgrimage"
    }


class TestOrchestratorAgent:
    """Test suite for OrchestratorAgent."""

    @pytest.mark.asyncio
    async def test_agent_initialization(
        self,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        mock_route_agent,
        mock_transport_agent
    ):
        """Test OrchestratorAgent initialization."""
        agent = OrchestratorAgent(
            search_agent=mock_search_agent,
            weather_agent=mock_weather_agent,
            filter_agent=mock_filter_agent,
            poi_agent=mock_poi_agent,
            route_agent=mock_route_agent,
            transport_agent=mock_transport_agent
        )

        assert agent.name == "orchestrator_agent"
        assert agent.description == "Orchestrates complete pilgrimage planning workflow"
        assert agent.state == AgentState.IDLE
        assert agent.search_agent == mock_search_agent
        assert agent.weather_agent == mock_weather_agent
        assert agent.filter_agent == mock_filter_agent
        assert agent.poi_agent == mock_poi_agent
        assert agent.route_agent == mock_route_agent
        assert agent.transport_agent == mock_transport_agent

    @pytest.mark.asyncio
    async def test_complete_workflow_success(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        mock_route_agent,
        mock_transport_agent,
        sample_station,
        sample_bangumi_list,
        sample_points,
        sample_route,
        sample_weather
    ):
        """Test complete workflow executes successfully."""
        # Arrange - Mock all agent responses
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list,
                "count": 2
            },
            metadata={}
        )

        mock_weather_agent.execute.return_value = AgentOutput(
            success=True,
            data={"weather": sample_weather},
            metadata={}
        )

        mock_filter_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "selected_bangumi_ids": ["115908", "126461"],
                "filtered_count": 2
            },
            metadata={}
        )

        mock_poi_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "points": sample_points,
                "count": 2
            },
            metadata={}
        )

        mock_route_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "route": sample_route,
                "optimized": True
            },
            metadata={}
        )

        mock_transport_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "route": sample_route,
                "optimized": True
            },
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session-123",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert "session" in result.data
        assert result.data["steps_completed"] == 6

        # Verify all agents were called
        assert mock_search_agent.execute.called
        assert mock_weather_agent.execute.called
        assert mock_filter_agent.execute.called
        assert mock_poi_agent.execute.called
        assert mock_route_agent.execute.called
        assert mock_transport_agent.execute.called

    @pytest.mark.asyncio
    async def test_search_agent_called_first(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_filter_agent,
        sample_station,
        sample_bangumi_list
    ):
        """Test SearchAgent is called first with station_name."""
        # Arrange
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list
            },
            metadata={}
        )

        # Mock other agents to avoid full execution
        mock_filter_agent.execute.return_value = AgentOutput(
            success=False,
            error="Stopping early for test",
            data={},
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        await orchestrator_agent.execute(input_data)

        # Assert SearchAgent was called with correct input
        assert mock_search_agent.execute.called
        call_args = mock_search_agent.execute.call_args[0][0]
        assert call_args.data["station_name"] == "Shinjuku Station"

    @pytest.mark.asyncio
    async def test_filter_agent_receives_search_results(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        sample_station,
        sample_bangumi_list
    ):
        """Test FilterAgent receives SearchAgent results."""
        # Arrange
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list
            },
            metadata={}
        )

        mock_weather_agent.execute.return_value = AgentOutput(
            success=True,
            data={"weather": {}},
            metadata={}
        )

        mock_filter_agent.execute.return_value = AgentOutput(
            success=True,
            data={"selected_bangumi_ids": ["115908"]},
            metadata={}
        )

        # Mock POIAgent to stop early
        mock_poi_agent.execute.return_value = AgentOutput(
            success=False,
            error="Stopping for test",
            data={},
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        await orchestrator_agent.execute(input_data)

        # Assert FilterAgent received bangumi list
        assert mock_filter_agent.execute.called
        call_args = mock_filter_agent.execute.call_args[0][0]
        assert "bangumi_list" in call_args.data
        assert len(call_args.data["bangumi_list"]) == 2

    @pytest.mark.asyncio
    async def test_input_validation_missing_station_name(self, orchestrator_agent):
        """Test input validation fails when station_name is missing."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_empty_station_name(self, orchestrator_agent):
        """Test input validation fails when station_name is empty."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": ""}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_search_agent_failure_stops_execution(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_filter_agent
    ):
        """Test that SearchAgent failure stops the workflow."""
        # Arrange
        mock_search_agent.execute.return_value = AgentOutput(
            success=False,
            error="Station not found",
            data={},
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "InvalidStation"}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "SearchAgent failed" in result.error
        # FilterAgent should not be called
        assert not mock_filter_agent.execute.called

    @pytest.mark.asyncio
    async def test_poi_agent_empty_points_handled(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        sample_station,
        sample_bangumi_list
    ):
        """Test handling when POIAgent returns no points."""
        # Arrange
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list
            },
            metadata={}
        )

        mock_weather_agent.execute.return_value = AgentOutput(
            success=True,
            data={"weather": {}},
            metadata={}
        )

        mock_filter_agent.execute.return_value = AgentOutput(
            success=True,
            data={"selected_bangumi_ids": ["115908"]},
            metadata={}
        )

        mock_poi_agent.execute.return_value = AgentOutput(
            success=True,
            data={"points": [], "count": 0},  # No points found
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "no pilgrimage points" in result.error.lower()

    @pytest.mark.asyncio
    async def test_weather_agent_failure_continues_execution(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        mock_route_agent,
        mock_transport_agent,
        sample_station,
        sample_bangumi_list,
        sample_points,
        sample_route
    ):
        """Test that WeatherAgent failure doesn't stop workflow."""
        # Arrange
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list
            },
            metadata={}
        )

        # WeatherAgent fails
        mock_weather_agent.execute.return_value = AgentOutput(
            success=False,
            error="Weather API unavailable",
            data={},
            metadata={}
        )

        mock_filter_agent.execute.return_value = AgentOutput(
            success=True,
            data={"selected_bangumi_ids": ["115908"]},
            metadata={}
        )

        mock_poi_agent.execute.return_value = AgentOutput(
            success=True,
            data={"points": sample_points},
            metadata={}
        )

        mock_route_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        mock_transport_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert - Workflow should still succeed
        assert result.success is True
        # But weather should be None
        session = result.data["session"]
        assert session["weather"] is None

    @pytest.mark.asyncio
    async def test_session_state_updates_correctly(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        mock_route_agent,
        mock_transport_agent,
        sample_station,
        sample_bangumi_list,
        sample_points,
        sample_route,
        sample_weather
    ):
        """Test that session state is correctly updated at each step."""
        # Arrange - Setup all mocks
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list
            },
            metadata={}
        )

        mock_weather_agent.execute.return_value = AgentOutput(
            success=True,
            data={"weather": sample_weather},
            metadata={}
        )

        mock_filter_agent.execute.return_value = AgentOutput(
            success=True,
            data={"selected_bangumi_ids": ["115908", "126461"]},
            metadata={}
        )

        mock_poi_agent.execute.return_value = AgentOutput(
            success=True,
            data={"points": sample_points},
            metadata={}
        )

        mock_route_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        mock_transport_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        session = result.data["session"]
        assert session["station"] is not None
        assert session["station"]["name"] == "Shinjuku Station"
        assert len(session["nearby_bangumi"]) == 2
        assert len(session["selected_bangumi_ids"]) == 2
        assert len(session["points"]) == 2
        assert session["route"] is not None
        assert session["weather"] is not None

    @pytest.mark.asyncio
    async def test_final_output_contains_all_data(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        mock_route_agent,
        mock_transport_agent,
        sample_station,
        sample_bangumi_list,
        sample_points,
        sample_route,
        sample_weather
    ):
        """Test that final output contains all necessary data."""
        # Arrange
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list
            },
            metadata={}
        )

        mock_weather_agent.execute.return_value = AgentOutput(
            success=True,
            data={"weather": sample_weather},
            metadata={}
        )

        mock_filter_agent.execute.return_value = AgentOutput(
            success=True,
            data={"selected_bangumi_ids": ["115908"]},
            metadata={}
        )

        mock_poi_agent.execute.return_value = AgentOutput(
            success=True,
            data={"points": sample_points},
            metadata={}
        )

        mock_route_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        mock_transport_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        assert "session" in result.data
        assert "steps_completed" in result.data
        assert result.data["steps_completed"] == 6
        assert "success" in result.data
        assert result.data["success"] is True

    @pytest.mark.asyncio
    async def test_metadata_includes_execution_info(
        self,
        orchestrator_agent,
        mock_search_agent,
        mock_weather_agent,
        mock_filter_agent,
        mock_poi_agent,
        mock_route_agent,
        mock_transport_agent,
        sample_station,
        sample_bangumi_list,
        sample_points,
        sample_route,
        sample_weather
    ):
        """Test that metadata includes execution information."""
        # Arrange
        mock_search_agent.execute.return_value = AgentOutput(
            success=True,
            data={
                "station": sample_station,
                "bangumi_list": sample_bangumi_list
            },
            metadata={}
        )

        mock_weather_agent.execute.return_value = AgentOutput(
            success=True,
            data={"weather": sample_weather},
            metadata={}
        )

        mock_filter_agent.execute.return_value = AgentOutput(
            success=True,
            data={"selected_bangumi_ids": ["115908"]},
            metadata={}
        )

        mock_poi_agent.execute.return_value = AgentOutput(
            success=True,
            data={"points": sample_points},
            metadata={}
        )

        mock_route_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        mock_transport_agent.execute.return_value = AgentOutput(
            success=True,
            data={"route": sample_route},
            metadata={}
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"station_name": "Shinjuku Station"}
        )

        # Act
        result = await orchestrator_agent.execute(input_data)

        # Assert
        assert "execution_time" in result.metadata
        assert isinstance(result.metadata["execution_time"], (int, float))
        assert result.metadata["execution_time"] >= 0

    @pytest.mark.asyncio
    async def test_agent_cleanup(self, orchestrator_agent):
        """Test that agent cleanup works properly."""
        # Act
        await orchestrator_agent.cleanup()

        # Assert
        assert orchestrator_agent.state == AgentState.IDLE

    @pytest.mark.asyncio
    async def test_agent_info(self, orchestrator_agent):
        """Test agent info method."""
        # Act
        info = orchestrator_agent.get_info()

        # Assert
        assert info["name"] == "orchestrator_agent"
        assert info["description"] == "Orchestrates complete pilgrimage planning workflow"
        assert info["state"] == AgentState.IDLE.value
