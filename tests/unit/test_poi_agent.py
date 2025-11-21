"""
Unit tests for POIAgent following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
from unittest.mock import Mock, AsyncMock
from datetime import datetime

from agents.base import AgentInput, AgentOutput, AgentState
from agents.poi_agent import POIAgent
from domain.entities import Point, Coordinates, APIError
from clients.google_maps import GoogleMapsClient


@pytest.fixture
def mock_google_maps_client():
    """Create a mock GoogleMapsClient."""
    client = Mock(spec=GoogleMapsClient)
    client.get_place_details = AsyncMock()
    client.search_nearby = AsyncMock()
    return client


@pytest.fixture
def poi_agent(mock_google_maps_client):
    """Create a POIAgent instance with mocked dependencies."""
    return POIAgent(google_maps_client=mock_google_maps_client)


@pytest.fixture
def sample_point():
    """Create a sample point for testing."""
    return Point(
        id="point-1",
        name="Akihabara Station",
        cn_name="秋叶原站",
        coordinates=Coordinates(latitude=35.698683, longitude=139.773035),
        bangumi_id="steins-gate",
        bangumi_title="Steins;Gate",
        episode=1,
        time_seconds=120,
        screenshot_url="https://example.com/ss1.jpg",
        address="Chiyoda City, Tokyo",
        opening_hours=None,  # Will be enriched by POIAgent
        admission_fee=None
    )


@pytest.fixture
def sample_place_details():
    """Create sample place details from Google Places API."""
    return {
        "place_id": "ChIJAAAAAAAAAAAREA",
        "name": "Akihabara Station",
        "formatted_address": "Chiyoda City, Tokyo 101-0028, Japan",
        "opening_hours": {
            "weekday_text": [
                "Monday: 5:00 AM – 12:00 AM",
                "Tuesday: 5:00 AM – 12:00 AM",
                "Wednesday: 5:00 AM – 12:00 AM",
                "Thursday: 5:00 AM – 12:00 AM",
                "Friday: 5:00 AM – 12:00 AM",
                "Saturday: 5:00 AM – 12:00 AM",
                "Sunday: 5:00 AM – 12:00 AM"
            ],
            "periods": [
                {
                    "open": {"day": 1, "time": "0500"},
                    "close": {"day": 1, "time": "0000"}
                }
            ],
            "open_now": True
        },
        "rating": 4.2,
        "user_ratings_total": 1523,
        "types": ["train_station", "transit_station", "point_of_interest"],
        "website": "https://www.jreast.co.jp/",
        "photos": [
            {
                "photo_reference": "photo_ref_1",
                "height": 1080,
                "width": 1920
            }
        ],
        "reviews": [
            {
                "rating": 5,
                "text": "Great station, very convenient!",
                "time": 1700000000
            }
        ]
    }


class TestPOIAgent:
    """Test suite for POIAgent."""

    @pytest.mark.asyncio
    async def test_agent_initialization(self, mock_google_maps_client):
        """Test POIAgent initialization."""
        agent = POIAgent(google_maps_client=mock_google_maps_client)

        assert agent.name == "poi_agent"
        assert agent.description == "Queries business hours and POI details"
        assert agent.state == AgentState.IDLE
        assert agent.google_maps_client == mock_google_maps_client

    @pytest.mark.asyncio
    async def test_enrich_single_point(
        self, poi_agent, mock_google_maps_client, sample_point, sample_place_details
    ):
        """Test enriching a single point with POI details."""
        # Arrange
        mock_google_maps_client.get_place_details.return_value = sample_place_details

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": [sample_point.model_dump()],
                "enrich_details": True
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.error is None
        assert "enriched_points" in result.data
        assert len(result.data["enriched_points"]) == 1

        enriched_point = result.data["enriched_points"][0]
        assert "poi_details" in enriched_point
        assert enriched_point["poi_details"]["rating"] == 4.2
        assert enriched_point["poi_details"]["open_now"] is True
        assert "weekday_text" in enriched_point["poi_details"]["opening_hours"]

        # Verify API was called
        mock_google_maps_client.get_place_details.assert_called_once()

    @pytest.mark.asyncio
    async def test_enrich_multiple_points(
        self, poi_agent, mock_google_maps_client, sample_point, sample_place_details
    ):
        """Test enriching multiple points."""
        # Arrange
        points = [
            sample_point.model_dump(),
            sample_point.model_copy(update={"id": "point-2"}).model_dump()
        ]

        mock_google_maps_client.get_place_details.return_value = sample_place_details

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": points,
                "enrich_details": True
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert len(result.data["enriched_points"]) == 2
        assert result.data["points_processed"] == 2
        assert result.data["points_enriched"] == 2

        # Verify API was called twice
        assert mock_google_maps_client.get_place_details.call_count == 2

    @pytest.mark.asyncio
    async def test_search_nearby_places(
        self, poi_agent, mock_google_maps_client, sample_point
    ):
        """Test searching for nearby places."""
        # Arrange
        nearby_places = [
            {
                "place_id": "place_1",
                "name": "Cafe A",
                "distance": 50,
                "types": ["cafe", "food"]
            },
            {
                "place_id": "place_2",
                "name": "Restaurant B",
                "distance": 100,
                "types": ["restaurant", "food"]
            }
        ]

        mock_google_maps_client.search_nearby.return_value = nearby_places

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "coordinates": sample_point.coordinates.model_dump(),
                "search_nearby": True,
                "place_type": "food",
                "radius_meters": 200
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert "nearby_places" in result.data
        assert len(result.data["nearby_places"]) == 2
        assert result.data["search_type"] == "food"
        assert result.data["search_radius_meters"] == 200

        # Verify API was called correctly
        mock_google_maps_client.search_nearby.assert_called_once_with(
            coordinates=sample_point.coordinates,
            radius_meters=200,
            place_type="food"
        )

    @pytest.mark.asyncio
    async def test_enrich_with_api_error(
        self, poi_agent, mock_google_maps_client, sample_point
    ):
        """Test handling API errors during enrichment."""
        # Arrange
        mock_google_maps_client.get_place_details.side_effect = APIError(
            "Google Maps API quota exceeded"
        )

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": [sample_point.model_dump()],
                "enrich_details": True
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True  # Partial success
        assert "enriched_points" in result.data
        assert len(result.data["enriched_points"]) == 1
        assert result.data["points_enriched"] == 0  # No points were enriched
        assert result.data["errors"] == 1

    @pytest.mark.asyncio
    async def test_batch_processing(
        self, poi_agent, mock_google_maps_client, sample_point, sample_place_details
    ):
        """Test batch processing of points."""
        # Arrange
        # Create 10 points
        points = [
            sample_point.model_copy(update={"id": f"point-{i}"}).model_dump()
            for i in range(10)
        ]

        mock_google_maps_client.get_place_details.return_value = sample_place_details

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": points,
                "enrich_details": True,
                "batch_size": 5  # Process in batches of 5
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert len(result.data["enriched_points"]) == 10
        assert result.data["points_processed"] == 10
        assert result.data["batch_size"] == 5

    @pytest.mark.asyncio
    async def test_skip_enrichment(
        self, poi_agent, mock_google_maps_client, sample_point
    ):
        """Test skipping enrichment when not requested."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": [sample_point.model_dump()],
                "enrich_details": False  # Don't enrich
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.data["enriched_points"] == [sample_point.model_dump()]
        assert result.data["points_enriched"] == 0

        # API should not be called
        mock_google_maps_client.get_place_details.assert_not_called()

    @pytest.mark.asyncio
    async def test_with_cached_data(
        self, poi_agent, mock_google_maps_client, sample_point
    ):
        """Test that agent uses cached data when available."""
        # Arrange
        # Point already has opening hours (cached/pre-filled)
        point_with_hours = sample_point.model_copy(
            update={"opening_hours": "09:00-17:00"}
        )

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": [point_with_hours.model_dump()],
                "enrich_details": True,
                "skip_if_has_hours": True
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.data["points_cached"] == 1
        assert result.data["points_enriched"] == 0

        # API should not be called for cached data
        mock_google_maps_client.get_place_details.assert_not_called()

    @pytest.mark.asyncio
    async def test_input_validation_for_enrichment(self, poi_agent):
        """Test input validation for enrichment mode."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "enrich_details": True
                # Missing points
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_for_search(self, poi_agent):
        """Test input validation for search mode."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "search_nearby": True
                # Missing coordinates
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_default_radius_for_search(
        self, poi_agent, mock_google_maps_client, sample_point
    ):
        """Test default radius is used when not specified."""
        # Arrange
        mock_google_maps_client.search_nearby.return_value = []

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "coordinates": sample_point.coordinates.model_dump(),
                "search_nearby": True,
                "place_type": "restaurant"
                # No radius specified
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert result.success is True
        mock_google_maps_client.search_nearby.assert_called_once_with(
            coordinates=sample_point.coordinates,
            radius_meters=500,  # Default radius
            place_type="restaurant"
        )

    @pytest.mark.asyncio
    async def test_metadata_includes_timing(
        self, poi_agent, mock_google_maps_client, sample_point, sample_place_details
    ):
        """Test that result metadata includes execution timing."""
        # Arrange
        mock_google_maps_client.get_place_details.return_value = sample_place_details

        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": [sample_point.model_dump()],
                "enrich_details": True
            }
        )

        # Act
        result = await poi_agent.execute(input_data)

        # Assert
        assert "execution_time" in result.metadata
        assert result.metadata["execution_time"] >= 0
        assert "timestamp" in result.metadata
        assert result.metadata["agent"] == "poi_agent"

    @pytest.mark.asyncio
    async def test_agent_cleanup(
        self, poi_agent, mock_google_maps_client, sample_point
    ):
        """Test agent cleanup after execution."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-321",
            data={
                "points": [sample_point.model_dump()],
                "enrich_details": False
            }
        )

        # Act
        await poi_agent.execute(input_data)
        await poi_agent.cleanup()

        # Assert
        assert poi_agent.state == AgentState.IDLE
        assert poi_agent._start_time is None

    @pytest.mark.asyncio
    async def test_agent_info(self, poi_agent):
        """Test agent info retrieval."""
        # Act
        info = poi_agent.get_info()

        # Assert
        assert info["name"] == "poi_agent"
        assert info["description"] == "Queries business hours and POI details"
        assert info["state"] == "idle"
        assert info["start_time"] is None