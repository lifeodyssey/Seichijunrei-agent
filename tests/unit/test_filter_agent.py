"""
Unit tests for FilterAgent following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
from unittest.mock import Mock, AsyncMock
from datetime import datetime, time

from agents.base import AgentInput, AgentOutput, AgentState
from agents.filter_agent import FilterAgent
from domain.entities import Point, Coordinates


@pytest.fixture
def filter_agent():
    """Create a FilterAgent instance."""
    return FilterAgent()


@pytest.fixture
def sample_points():
    """Create sample pilgrimage points for testing."""
    return [
        Point(
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
            opening_hours="05:00-24:00",
            admission_fee=None
        ),
        Point(
            id="point-2",
            name="Radio Kaikan",
            cn_name="无线电会馆",
            coordinates=Coordinates(latitude=35.697920, longitude=139.771634),
            bangumi_id="steins-gate",
            bangumi_title="Steins;Gate",
            episode=1,
            time_seconds=180,
            screenshot_url="https://example.com/ss2.jpg",
            address="1-15-16 Sotokanda, Chiyoda City",
            opening_hours="10:00-20:00",
            admission_fee="Free"
        ),
        Point(
            id="point-3",
            name="Tokyo Tower",
            cn_name="东京塔",
            coordinates=Coordinates(latitude=35.658581, longitude=139.745433),
            bangumi_id="your-name",
            bangumi_title="Your Name",
            episode=1,
            time_seconds=240,
            screenshot_url="https://example.com/ss3.jpg",
            address="4-2-8 Shibakoen, Minato City",
            opening_hours="09:00-23:00",
            admission_fee="1200 JPY"
        ),
        Point(
            id="point-4",
            name="Private Museum",
            cn_name="私人博物馆",
            coordinates=Coordinates(latitude=35.660000, longitude=139.740000),
            bangumi_id="anime-x",
            bangumi_title="Anime X",
            episode=2,
            time_seconds=300,
            screenshot_url="https://example.com/ss4.jpg",
            address="Secret Location",
            opening_hours=None,  # No opening hours info
            admission_fee="5000 JPY"
        )
    ]


@pytest.fixture
def user_preferences():
    """Create sample user preferences for filtering."""
    return {
        "max_admission_fee": 2000,  # Maximum admission fee in JPY
        "wheelchair_accessible": False,  # Not required for this test
        "current_time": "14:00",  # Current time for checking opening hours
        "bangumi_ids": None,  # No specific bangumi filter
        "max_distance_km": 5.0,  # Maximum distance from reference point
        "reference_coordinates": {
            "latitude": 35.698683,
            "longitude": 139.773035
        }
    }


class TestFilterAgent:
    """Test suite for FilterAgent."""

    @pytest.mark.asyncio
    async def test_agent_initialization(self):
        """Test FilterAgent initialization."""
        agent = FilterAgent()

        assert agent.name == "filter_agent"
        assert agent.description == "Filters locations based on user preferences"
        assert agent.state == AgentState.IDLE

    @pytest.mark.asyncio
    async def test_filter_by_admission_fee(self, filter_agent, sample_points):
        """Test filtering points by admission fee."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {
                    "max_admission_fee": 1500  # Only allow up to 1500 JPY
                }
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.error is None
        filtered = result.data["filtered_points"]

        # Should include: point-1 (free), point-2 (free), point-3 (1200 JPY)
        # Should exclude: point-4 (5000 JPY)
        assert len(filtered) == 3
        assert all(p["id"] != "point-4" for p in filtered)
        assert result.data["total_before_filter"] == 4
        assert result.data["total_after_filter"] == 3

    @pytest.mark.asyncio
    async def test_filter_by_opening_hours(self, filter_agent, sample_points):
        """Test filtering points by current opening hours."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {
                    "current_time": "09:30",  # Morning time
                    "filter_by_hours": True
                }
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        filtered = result.data["filtered_points"]

        # At 09:30:
        # - point-1: open (05:00-24:00)
        # - point-2: closed (10:00-20:00)
        # - point-3: open (09:00-23:00)
        # - point-4: unknown hours (should be included by default)
        assert len(filtered) == 3
        assert all(p["id"] != "point-2" for p in filtered)

    @pytest.mark.asyncio
    async def test_filter_by_distance(self, filter_agent, sample_points):
        """Test filtering points by distance from reference point."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {
                    "max_distance_km": 1.0,  # 1km radius
                    "reference_coordinates": {
                        "latitude": 35.698683,  # Akihabara Station
                        "longitude": 139.773035
                    }
                }
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        filtered = result.data["filtered_points"]

        # Only points within 1km of Akihabara should remain
        # point-1 and point-2 are very close, point-3 and point-4 are far
        assert len(filtered) == 2
        assert all(p["id"] in ["point-1", "point-2"] for p in filtered)

    @pytest.mark.asyncio
    async def test_filter_by_bangumi(self, filter_agent, sample_points):
        """Test filtering points by specific bangumi IDs."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {
                    "bangumi_ids": ["steins-gate"]  # Only Steins;Gate locations
                }
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        filtered = result.data["filtered_points"]

        # Should only include Steins;Gate points
        assert len(filtered) == 2
        assert all(p["bangumi_id"] == "steins-gate" for p in filtered)

    @pytest.mark.asyncio
    async def test_combined_filters(self, filter_agent, sample_points):
        """Test multiple filters applied together."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {
                    "max_admission_fee": 1000,  # Free only (practically)
                    "current_time": "11:00",
                    "filter_by_hours": True,
                    "max_distance_km": 2.0,
                    "reference_coordinates": {
                        "latitude": 35.698683,
                        "longitude": 139.773035
                    }
                }
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        filtered = result.data["filtered_points"]

        # Should apply all filters:
        # - Free admission (excludes point-3 and point-4)
        # - Open at 11:00 (point-1 open, point-2 open at 11:00)
        # - Within 2km (point-1 and point-2 are close)
        assert len(filtered) == 2
        assert all(p["id"] in ["point-1", "point-2"] for p in filtered)

    @pytest.mark.asyncio
    async def test_no_filters_applied(self, filter_agent, sample_points):
        """Test when no preferences are specified (return all points)."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {}  # No filters
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        filtered = result.data["filtered_points"]
        assert len(filtered) == 4  # All points returned
        assert result.data["filters_applied"] == []

    @pytest.mark.asyncio
    async def test_empty_points_list(self, filter_agent):
        """Test filtering an empty list of points."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [],
                "preferences": {"max_admission_fee": 1000}
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert result.data["filtered_points"] == []
        assert result.data["total_before_filter"] == 0
        assert result.data["total_after_filter"] == 0

    @pytest.mark.asyncio
    async def test_input_validation_missing_points(self, filter_agent):
        """Test input validation when points are missing."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "preferences": {}
                # Missing points
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_input_validation_invalid_points(self, filter_agent):
        """Test input validation with invalid points data."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": "not a list",
                "preferences": {}
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is False
        assert "Input validation failed" in result.error

    @pytest.mark.asyncio
    async def test_ranking_by_preference_score(self, filter_agent, sample_points):
        """Test that results are ranked by preference match score."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {
                    "max_admission_fee": 2000,
                    "rank_by_score": True
                }
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        filtered = result.data["filtered_points"]

        # Points should be ranked by score (free > cheap > expensive)
        # Free points should come first
        free_points = [p for p in filtered if p.get("admission_fee") in [None, "Free"]]
        assert len(free_points) > 0
        assert filtered[0]["id"] in ["point-1", "point-2"]  # Free points first

    @pytest.mark.asyncio
    async def test_filter_metadata_includes_details(self, filter_agent, sample_points):
        """Test that result metadata includes filter details."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {
                    "max_admission_fee": 1500,
                    "filter_by_hours": True,
                    "current_time": "14:00"
                }
            }
        )

        # Act
        result = await filter_agent.execute(input_data)

        # Assert
        assert result.success is True
        assert "filters_applied" in result.data
        assert "admission_fee" in result.data["filters_applied"]
        assert "opening_hours" in result.data["filters_applied"]
        assert result.data["total_before_filter"] == 4

    @pytest.mark.asyncio
    async def test_agent_cleanup(self, filter_agent, sample_points):
        """Test agent cleanup after execution."""
        # Arrange
        input_data = AgentInput(
            session_id="test-session-789",
            data={
                "points": [p.model_dump() for p in sample_points],
                "preferences": {}
            }
        )

        # Act
        await filter_agent.execute(input_data)
        await filter_agent.cleanup()

        # Assert
        assert filter_agent.state == AgentState.IDLE
        assert filter_agent._start_time is None

    @pytest.mark.asyncio
    async def test_agent_info(self, filter_agent):
        """Test agent info retrieval."""
        # Act
        info = filter_agent.get_info()

        # Assert
        assert info["name"] == "filter_agent"
        assert info["description"] == "Filters locations based on user preferences"
        assert info["state"] == "idle"
        assert info["start_time"] is None