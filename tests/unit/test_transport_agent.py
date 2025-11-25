"""
Unit tests for TransportAgent following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
from unittest.mock import Mock, AsyncMock
from datetime import datetime

from agents.base import AgentInput, AgentOutput, AgentState, AgentValidationError
from agents.transport_agent import TransportAgent
from domain.entities import (
    Station, Point, Route, RouteSegment, TransportInfo, Coordinates,
    APIError
)
from clients.google_maps import GoogleMapsClient


@pytest.fixture
def mock_maps_client():
    """Create a mock GoogleMapsClient."""
    client = Mock(spec=GoogleMapsClient)
    client.get_directions = AsyncMock()
    return client


@pytest.fixture
def transport_agent(mock_maps_client):
    """Create a TransportAgent instance with mocked dependencies."""
    return TransportAgent(maps_client=mock_maps_client)


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
def sample_route(sample_station):
    """Create a sample route with 2 segments (all walking)."""
    point1 = Point(
        id="point-1",
        name="Shinjuku Gyoen",
        cn_name="新宿御苑",
        coordinates=Coordinates(latitude=35.6851, longitude=139.7100),
        bangumi_id="115908",
        bangumi_title="Your Name",
        episode=12,
        time_seconds=345,
        screenshot_url="https://example.com/screenshot1.jpg"
    )

    point2 = Point(
        id="point-2",
        name="Yoyogi Park",
        cn_name="代代木公园",
        coordinates=Coordinates(latitude=35.6700, longitude=139.7200),
        bangumi_id="126461",
        bangumi_title="Weathering with You",
        episode=5,
        time_seconds=180,
        screenshot_url="https://example.com/screenshot2.jpg"
    )

    # Create initial route with walking transport
    transport1 = TransportInfo(
        mode="walking",
        distance_meters=1200,
        duration_minutes=15,
        instructions="Walk south"
    )

    transport2 = TransportInfo(
        mode="walking",
        distance_meters=800,
        duration_minutes=10,
        instructions="Walk west"
    )

    segments = [
        RouteSegment(
            order=1,
            point=point1,
            transport=transport1,
            cumulative_distance_km=1.2,
            cumulative_duration_minutes=15
        ),
        RouteSegment(
            order=2,
            point=point2,
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
        google_maps_url="https://www.google.com/maps/dir/..."
    )


@pytest.fixture
def sample_long_distance_route(sample_station):
    """Create a route with a long-distance segment (should use transit)."""
    point1 = Point(
        id="point-1",
        name="Tokyo Tower",
        cn_name="东京塔",
        coordinates=Coordinates(latitude=35.6586, longitude=139.7454),
        bangumi_id="test",
        bangumi_title="Test Anime",
        episode=1,
        time_seconds=100,
        screenshot_url="https://example.com/test.jpg"
    )

    # Long distance: 3.5km
    transport1 = TransportInfo(
        mode="walking",
        distance_meters=3500,
        duration_minutes=45,
        instructions="Walk a long way"
    )

    segments = [
        RouteSegment(
            order=1,
            point=point1,
            transport=transport1,
            cumulative_distance_km=3.5,
            cumulative_duration_minutes=45
        )
    ]

    return Route(
        origin=sample_station,
        segments=segments,
        total_distance_km=3.5,
        total_duration_minutes=45,
        google_maps_url="https://www.google.com/maps/dir/..."
    )


class TestTransportAgent:
    """Test suite for TransportAgent."""

    @pytest.mark.asyncio
    async def test_agent_initialization(self, mock_maps_client):
        """Test TransportAgent initialization."""
        agent = TransportAgent(maps_client=mock_maps_client)

        assert agent.name == "transport_agent"
        assert agent.description == "Optimizes transport modes for route segments"
        assert agent.state == AgentState.IDLE
        assert agent.maps_client == mock_maps_client
        assert agent.TRANSIT_THRESHOLD_KM == 1.5

    @pytest.mark.asyncio
    async def test_optimize_short_distance_route_all_walking(
        self, transport_agent, mock_maps_client, sample_route
    ):
        """Test route with all short distances (should remain walking)."""
        # Arrange
        walking_transport = TransportInfo(
            mode="walking",
            distance_meters=1200,
            duration_minutes=15,
            instructions="Walk"
        )
        mock_maps_client.get_directions.return_value = walking_transport

        input_data = AgentInput(
            session_id="test-session-123",
            data={"route": sample_route.model_dump()}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is True
        route_data = result.data["route"]

        # All segments should be walking (short distances)
        for segment in route_data["segments"]:
            assert segment["transport"]["mode"] == "walking"

    @pytest.mark.asyncio
    async def test_optimize_long_distance_switches_to_transit(
        self, transport_agent, mock_maps_client, sample_long_distance_route
    ):
        """Test long-distance segment switches from walking to transit."""
        # Arrange
        # Walking takes 45 min
        walking_transport = TransportInfo(
            mode="walking",
            distance_meters=3500,
            duration_minutes=45,
            instructions="Walk very far"
        )

        # Transit takes only 12 min (faster)
        transit_transport = TransportInfo(
            mode="transit",
            distance_meters=3500,
            duration_minutes=12,
            instructions="Take subway",
            transit_details={"lines": [{"name": "Yamanote Line"}]}
        )

        # Mock returns walking first, then transit
        mock_maps_client.get_directions.side_effect = [
            walking_transport,
            transit_transport
        ]

        input_data = AgentInput(
            session_id="test-session-456",
            data={"route": sample_long_distance_route.model_dump()}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is True
        route_data = result.data["route"]

        # Should switch to transit for long distance
        assert route_data["segments"][0]["transport"]["mode"] == "transit"
        assert route_data["segments"][0]["transport"]["duration_minutes"] == 12
        assert "transit_details" in route_data["segments"][0]["transport"]

    @pytest.mark.asyncio
    async def test_keep_walking_if_transit_not_faster(
        self, transport_agent, mock_maps_client, sample_long_distance_route
    ):
        """Test keeps walking if transit is not actually faster."""
        # Arrange
        walking_transport = TransportInfo(
            mode="walking",
            distance_meters=3500,
            duration_minutes=30,
            instructions="Walk"
        )

        # Transit is slower due to transfers
        transit_transport = TransportInfo(
            mode="transit",
            distance_meters=3500,
            duration_minutes=35,
            instructions="Take 2 trains with transfer"
        )

        mock_maps_client.get_directions.side_effect = [
            walking_transport,
            transit_transport
        ]

        input_data = AgentInput(
            session_id="test-session-789",
            data={"route": sample_long_distance_route.model_dump()}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is True
        route_data = result.data["route"]

        # Should keep walking since it's faster
        assert route_data["segments"][0]["transport"]["mode"] == "walking"
        assert route_data["segments"][0]["transport"]["duration_minutes"] == 30

    @pytest.mark.asyncio
    async def test_cumulative_values_recalculated(
        self, transport_agent, mock_maps_client, sample_route
    ):
        """Test that cumulative distance and time are recalculated correctly."""
        # Arrange
        # First segment: short distance (walking only)
        transport1 = TransportInfo(
            mode="walking",
            distance_meters=1000,
            duration_minutes=12,
            instructions="Walk"
        )

        # Second segment: long distance (walking + transit comparison)
        transport2_walking = TransportInfo(
            mode="walking",
            distance_meters=1500,
            duration_minutes=25,
            instructions="Walk more"
        )

        transport2_transit = TransportInfo(
            mode="transit",
            distance_meters=1500,
            duration_minutes=18,
            instructions="Take train"
        )

        # Mock returns: segment1 walking, segment2 walking, segment2 transit
        mock_maps_client.get_directions.side_effect = [
            transport1,          # Segment 1 (short, walking)
            transport2_walking,  # Segment 2 (long, walking)
            transport2_transit   # Segment 2 (long, transit - chosen)
        ]

        input_data = AgentInput(
            session_id="test-session",
            data={"route": sample_route.model_dump()}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        route_data = result.data["route"]
        segments = route_data["segments"]

        # First segment
        assert segments[0]["cumulative_distance_km"] == 1.0
        assert segments[0]["cumulative_duration_minutes"] == 12

        # Second segment (cumulative) - should use transit (18 min < 25 min)
        assert segments[1]["transport"]["mode"] == "transit"
        assert segments[1]["cumulative_distance_km"] == 2.5
        assert segments[1]["cumulative_duration_minutes"] == 30

        # Total route values updated
        assert route_data["total_distance_km"] == 2.5
        assert route_data["total_duration_minutes"] == 30

    @pytest.mark.asyncio
    async def test_input_validation_missing_route(self, transport_agent):
        """Test input validation fails when route is missing."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_route_not_dict(self, transport_agent):
        """Test input validation fails when route is not a dictionary."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={"route": "not a dict"}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_missing_segments(self, transport_agent):
        """Test input validation fails when route has no segments."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={
                "route": {
                    "origin": {
                        "name": "Test Station",
                        "coordinates": {"latitude": 35.0, "longitude": 139.0}
                    }
                    # Missing segments
                }
            }
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_input_validation_empty_segments(self, transport_agent):
        """Test input validation fails when segments list is empty."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session",
            data={
                "route": {
                    "origin": {
                        "name": "Test Station",
                        "coordinates": {"latitude": 35.0, "longitude": 139.0}
                    },
                    "segments": [],
                    "total_distance_km": 0,
                    "total_duration_minutes": 0
                }
            }
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_api_error_handling(
        self, transport_agent, mock_maps_client, sample_route
    ):
        """Test handling of Google Maps API errors."""
        # Arrange
        mock_maps_client.get_directions.side_effect = APIError(
            "Google Maps API quota exceeded"
        )

        input_data = AgentInput(
            session_id="test-session",
            data={"route": sample_route.model_dump()}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_metadata_includes_execution_time(
        self, transport_agent, mock_maps_client, sample_route
    ):
        """Test that metadata includes execution timing information."""
        # Arrange
        walking_transport = TransportInfo(
            mode="walking",
            distance_meters=1200,
            duration_minutes=15,
            instructions="Walk"
        )
        mock_maps_client.get_directions.return_value = walking_transport

        input_data = AgentInput(
            session_id="test-session",
            data={"route": sample_route.model_dump()}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert "execution_time" in result.metadata
        assert isinstance(result.metadata["execution_time"], (int, float))
        assert result.metadata["execution_time"] >= 0

    @pytest.mark.asyncio
    async def test_agent_cleanup(self, transport_agent):
        """Test that agent cleanup works properly."""
        # Act
        await transport_agent.cleanup()

        # Assert
        assert transport_agent.state == AgentState.IDLE

    @pytest.mark.asyncio
    async def test_agent_info(self, transport_agent):
        """Test agent info method."""
        # Act
        info = transport_agent.get_info()

        # Assert
        assert info["name"] == "transport_agent"
        assert info["description"] == "Optimizes transport modes for route segments"
        assert info["state"] == AgentState.IDLE.value

    @pytest.mark.asyncio
    async def test_optimized_flag_set(
        self, transport_agent, mock_maps_client, sample_route
    ):
        """Test that optimized flag is set in output."""
        # Arrange
        walking_transport = TransportInfo(
            mode="walking",
            distance_meters=1200,
            duration_minutes=15,
            instructions="Walk"
        )
        mock_maps_client.get_directions.return_value = walking_transport

        input_data = AgentInput(
            session_id="test-session",
            data={"route": sample_route.model_dump()}
        )

        # Act
        result = await transport_agent.execute(input_data)

        # Assert
        assert result.data["optimized"] is True
        assert "segments_optimized" in result.data
