"""
Unit tests for RouteAgent following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
from unittest.mock import Mock, AsyncMock
from datetime import datetime

from agents.base import AgentInput, AgentOutput, AgentState, AgentValidationError
from agents.route_agent import RouteAgent
from domain.entities import (
    Station, Point, Route, RouteSegment, TransportInfo, Coordinates,
    APIError, TooManyPointsError
)
from clients.google_maps import GoogleMapsClient


@pytest.fixture
def mock_maps_client():
    """Create a mock GoogleMapsClient."""
    client = Mock(spec=GoogleMapsClient)
    client.get_multi_waypoint_route = AsyncMock()
    return client


@pytest.fixture
def route_agent(mock_maps_client):
    """Create a RouteAgent instance with mocked dependencies."""
    return RouteAgent(maps_client=mock_maps_client)


@pytest.fixture
def sample_station():
    """Create a sample station for testing."""
    return Station(
        name="Shinjuku Station",
        coordinates=Coordinates(latitude=35.6896, longitude=139.7006),
        city="Tokyo",
        prefecture="Tokyo"
    )


@pytest.fixture
def sample_points():
    """Create sample pilgrimage points for testing."""
    return [
        Point(
            id="point-1",
            name="Shinjuku Gyoen",
            cn_name="新宿御苑",
            coordinates=Coordinates(latitude=35.6851, longitude=139.7100),
            bangumi_id="115908",
            bangumi_title="Your Name",
            episode=12,
            time_seconds=345,
            screenshot_url="https://example.com/screenshot1.jpg",
            address="11 Naitocho, Shinjuku"
        ),
        Point(
            id="point-2",
            name="Yoyogi Park",
            cn_name="代代木公园",
            coordinates=Coordinates(latitude=35.6700, longitude=139.7200),
            bangumi_id="126461",
            bangumi_title="Weathering with You",
            episode=5,
            time_seconds=180,
            screenshot_url="https://example.com/screenshot2.jpg",
            address="2-1 Yoyogikamizonocho, Shibuya"
        )
    ]


@pytest.fixture
def sample_route(sample_station, sample_points):
    """Create a sample optimized route for testing."""
    # Create transport info
    transport1 = TransportInfo(
        mode="walking",
        distance_meters=1200,
        duration_minutes=15,
        instructions="Walk south on Shinjuku Street"
    )

    transport2 = TransportInfo(
        mode="walking",
        distance_meters=800,
        duration_minutes=10,
        instructions="Walk west to Yoyogi Park"
    )

    # Create route segments
    segments = [
        RouteSegment(
            order=1,
            point=sample_points[0],
            transport=transport1,
            cumulative_distance_km=1.2,
            cumulative_duration_minutes=15
        ),
        RouteSegment(
            order=2,
            point=sample_points[1],
            transport=transport2,
            cumulative_distance_km=2.0,
            cumulative_duration_minutes=25
        )
    ]

    return Route(
        origin=sample_station,
        segments=segments,
        total_distance_km=2.0,
        total_duration_minutes=25,
        google_maps_url="https://www.google.com/maps/dir/35.6896,139.7006/35.6851,139.7100/35.6700,139.7200"
    )


class TestRouteAgent:
    """Test suite for RouteAgent."""

    @pytest.mark.asyncio
    async def test_agent_initialization(self, mock_maps_client):
        """Test RouteAgent initialization."""
        agent = RouteAgent(maps_client=mock_maps_client)

        assert agent.name == "route_agent"
        assert agent.description == "Optimizes pilgrimage routes using Google Maps"
        assert agent.state == AgentState.IDLE
        assert agent.maps_client == mock_maps_client

    @pytest.mark.asyncio
    async def test_optimize_route_with_two_points(
        self, route_agent, mock_maps_client, sample_station, sample_points, sample_route
    ):
        """Test successful route optimization with 2 points."""
        # Arrange
        mock_maps_client.get_multi_waypoint_route.return_value = sample_route

        input_data = AgentInput(
            session_id="test-session-123",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.error is None
        assert "route" in result.data
        assert result.data["waypoints_count"] == 2
        assert result.data["optimized"] is True

        # Verify client was called correctly
        mock_maps_client.get_multi_waypoint_route.assert_called_once()
        call_args = mock_maps_client.get_multi_waypoint_route.call_args
        assert call_args[1]["origin"].name == sample_station.name
        assert len(call_args[1]["waypoints"]) == 2

    @pytest.mark.asyncio
    async def test_optimize_route_with_25_points(
        self, route_agent, mock_maps_client, sample_station
    ):
        """Test route optimization with 25 points (boundary case)."""
        # Arrange: Create 25 points
        points = []
        for i in range(25):
            point = Point(
                id=f"point-{i}",
                name=f"Location {i}",
                cn_name=f"地点{i}",
                coordinates=Coordinates(
                    latitude=35.6896 + i * 0.001,
                    longitude=139.7006 + i * 0.001
                ),
                bangumi_id="test-bangumi",
                bangumi_title="Test Anime",
                episode=1,
                time_seconds=100,
                screenshot_url="https://example.com/screenshot.jpg"
            )
            points.append(point)

        # Create mock route
        mock_route = Mock(spec=Route)
        mock_route.origin = sample_station
        mock_route.segments = []
        mock_route.total_distance_km = 10.5
        mock_route.total_duration_minutes = 150
        mock_route.google_maps_url = "https://example.com/route"
        mock_route.model_dump.return_value = {
            "origin": sample_station.model_dump(),
            "segments": [],
            "total_distance_km": 10.5,
            "total_duration_minutes": 150
        }

        mock_maps_client.get_multi_waypoint_route.return_value = mock_route

        input_data = AgentInput(
            session_id="test-session-456",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.data["waypoints_count"] == 25

    @pytest.mark.asyncio
    async def test_route_order_optimized(
        self, route_agent, mock_maps_client, sample_station, sample_points, sample_route
    ):
        """Test that route order is optimized by Google Maps."""
        # Arrange
        mock_maps_client.get_multi_waypoint_route.return_value = sample_route

        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        route_data = result.data["route"]
        assert len(route_data["segments"]) == 2
        # Verify segments have correct order
        assert route_data["segments"][0]["order"] == 1
        assert route_data["segments"][1]["order"] == 2

    @pytest.mark.asyncio
    async def test_input_validation_missing_origin(self, route_agent, sample_points):
        """Test input validation fails when origin is missing."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_origin_not_dict(self, route_agent, sample_points):
        """Test input validation fails when origin is not a dictionary."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": "not a dict",
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_missing_points(self, route_agent, sample_station):
        """Test input validation fails when points are missing."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": sample_station.model_dump()
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_empty_points_list(self, route_agent, sample_station):
        """Test input validation fails when points list is empty."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": sample_station.model_dump(),
                "points": []
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_too_many_points(self, route_agent, sample_station):
        """Test input validation fails when there are more than 25 points."""
        # Arrange: Create 26 points
        points = []
        for i in range(26):
            point = Point(
                id=f"point-{i}",
                name=f"Location {i}",
                cn_name=f"地点{i}",
                coordinates=Coordinates(latitude=35.0 + i * 0.001, longitude=139.0),
                bangumi_id="test",
                bangumi_title="Test",
                episode=1,
                time_seconds=100,
                screenshot_url="https://example.com/test.jpg"
            )
            points.append(point)

        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_api_error_handling(
        self, route_agent, mock_maps_client, sample_station, sample_points
    ):
        """Test handling of Google Maps API errors."""
        # Arrange
        mock_maps_client.get_multi_waypoint_route.side_effect = APIError(
            "Google Maps API quota exceeded"
        )

        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_google_maps_url_generated(
        self, route_agent, mock_maps_client, sample_station, sample_points, sample_route
    ):
        """Test that Google Maps URL is included in the route."""
        # Arrange
        mock_maps_client.get_multi_waypoint_route.return_value = sample_route

        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        route_data = result.data["route"]
        assert "google_maps_url" in route_data
        assert route_data["google_maps_url"] is not None
        # Convert to string if it's an HttpUrl object
        url_str = str(route_data["google_maps_url"])
        assert "google.com/maps" in url_str

    @pytest.mark.asyncio
    async def test_metadata_includes_execution_time(
        self, route_agent, mock_maps_client, sample_station, sample_points, sample_route
    ):
        """Test that metadata includes execution timing information."""
        # Arrange
        mock_maps_client.get_multi_waypoint_route.return_value = sample_route

        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        assert "execution_time" in result.metadata
        assert isinstance(result.metadata["execution_time"], (int, float))
        assert result.metadata["execution_time"] >= 0

    @pytest.mark.asyncio
    async def test_agent_cleanup(self, route_agent, mock_maps_client):
        """Test that agent cleanup works properly."""
        # Arrange
        mock_maps_client.close = AsyncMock()

        # Act
        await route_agent.cleanup()

        # Assert
        assert route_agent.state == AgentState.IDLE

    @pytest.mark.asyncio
    async def test_agent_info(self, route_agent):
        """Test agent info method."""
        # Act
        info = route_agent.get_info()

        # Assert
        assert info["name"] == "route_agent"
        assert info["description"] == "Optimizes pilgrimage routes using Google Maps"
        assert info["state"] == AgentState.IDLE.value

    @pytest.mark.asyncio
    async def test_cumulative_distance_and_time_calculated(
        self, route_agent, mock_maps_client, sample_station, sample_points, sample_route
    ):
        """Test that cumulative distance and time are correctly calculated."""
        # Arrange
        mock_maps_client.get_multi_waypoint_route.return_value = sample_route

        input_data = AgentInput(
            session_id="test-session",
            data={
                "origin": sample_station.model_dump(),
                "points": [p.model_dump() for p in sample_points]
            }
        )

        # Act
        result = await route_agent.execute(input_data)

        # Assert
        route_data = result.data["route"]
        assert route_data["total_distance_km"] == 2.0
        assert route_data["total_duration_minutes"] == 25

        # Check cumulative values in segments
        segments = route_data["segments"]
        assert segments[0]["cumulative_distance_km"] == 1.2
        assert segments[0]["cumulative_duration_minutes"] == 15
        assert segments[1]["cumulative_distance_km"] == 2.0
        assert segments[1]["cumulative_duration_minutes"] == 25
