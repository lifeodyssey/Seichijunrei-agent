"""
Unit tests for MapGeneratorTool following TDD principles.
Tests written before implementation (RED phase).
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, AsyncMock, patch

from tools.map_generator import MapGeneratorTool
from domain.entities import (
    Station, Point, Route, RouteSegment, TransportInfo, Bangumi,
    Coordinates, PilgrimageSession
)


@pytest.fixture
def sample_session():
    """Create a complete PilgrimageSession for testing."""
    station = Station(
        name="Shinjuku Station",
        coordinates=Coordinates(latitude=35.6896, longitude=139.7006),
        city="Tokyo",
        prefecture="Tokyo"
    )

    bangumi1 = Bangumi(
        id="115908",
        title="Kimi no Na wa",
        cn_title="你的名字",
        cover_url="https://example.com/cover1.jpg",
        points_count=3,
        primary_color="#FF6B6B"
    )

    bangumi2 = Bangumi(
        id="126461",
        title="Tenki no Ko",
        cn_title="天气之子",
        cover_url="https://example.com/cover2.jpg",
        points_count=2,
        primary_color="#4ECDC4"
    )

    point1 = Point(
        id="point-1",
        name="Shinjuku Gyoen",
        cn_name="新宿御苑",
        coordinates=Coordinates(latitude=35.6851, longitude=139.7100),
        bangumi_id="115908",
        bangumi_title="Kimi no Na wa",
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
        bangumi_title="Tenki no Ko",
        episode=5,
        time_seconds=180,
        screenshot_url="https://example.com/screenshot2.jpg"
    )

    point3 = Point(
        id="point-3",
        name="Tokyo Tower",
        cn_name="东京塔",
        coordinates=Coordinates(latitude=35.6586, longitude=139.7454),
        bangumi_id="115908",
        bangumi_title="Kimi no Na wa",
        episode=8,
        time_seconds=520,
        screenshot_url="https://example.com/screenshot3.jpg"
    )

    transport1 = TransportInfo(
        mode="walking",
        distance_meters=1200,
        duration_minutes=15,
        instructions="Walk south"
    )

    transport2 = TransportInfo(
        mode="transit",
        distance_meters=2500,
        duration_minutes=12,
        instructions="Take subway",
        transit_details={"lines": [{"name": "Yamanote Line"}]}
    )

    transport3 = TransportInfo(
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
            cumulative_distance_km=3.7,
            cumulative_duration_minutes=27
        ),
        RouteSegment(
            order=3,
            point=point3,
            transport=transport3,
            cumulative_distance_km=4.5,
            cumulative_duration_minutes=37
        )
    ]

    route = Route(
        origin=station,
        segments=segments,
        total_distance_km=4.5,
        total_duration_minutes=37,
        google_maps_url="https://www.google.com/maps/dir/..."
    )

    session = PilgrimageSession(
        session_id="test-session-123",
        station=station,
        selected_bangumi_ids=["115908", "126461"],
        nearby_bangumi=[bangumi1, bangumi2],
        points=[point1, point2, point3],
        route=route
    )

    return session


@pytest.fixture
def map_generator(tmp_path):
    """Create a MapGeneratorTool instance with temporary output directory."""
    output_dir = tmp_path / "maps"
    return MapGeneratorTool(output_dir=str(output_dir))


class TestMapGeneratorTool:
    """Test suite for MapGeneratorTool."""

    @pytest.mark.asyncio
    async def test_tool_initialization(self, tmp_path):
        """Test MapGeneratorTool initialization with custom output directory."""
        # Arrange
        output_dir = tmp_path / "maps"

        # Act
        tool = MapGeneratorTool(output_dir=str(output_dir))

        # Assert
        assert tool.output_dir == output_dir
        assert output_dir.exists()

    @pytest.mark.asyncio
    async def test_tool_initialization_default_directory(self):
        """Test MapGeneratorTool uses default 'output/maps' if not specified."""
        # Act
        tool = MapGeneratorTool()

        # Assert
        assert "maps" in str(tool.output_dir)

    @pytest.mark.asyncio
    async def test_generate_map_from_session(self, map_generator, sample_session):
        """Test map generation from complete PilgrimageSession."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        assert output_path is not None
        assert Path(output_path).exists()
        assert str(output_path).endswith(".html")

    @pytest.mark.asyncio
    async def test_map_file_contains_folium_content(
        self, map_generator, sample_session
    ):
        """Test generated map file contains valid Folium HTML structure."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        with open(output_path, "r", encoding="utf-8") as f:
            content = f.read()
            assert "folium" in content.lower()
            assert "leaflet" in content.lower()
            assert "map" in content.lower()

    @pytest.mark.asyncio
    async def test_map_contains_correct_number_of_markers(
        self, map_generator, sample_session
    ):
        """Test map has markers for origin station + all points."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        with open(output_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Should have 1 origin marker + 3 point markers = 4 total
            # Folium markers appear as L.marker in the HTML
            marker_count = content.count("L.marker")
            assert marker_count >= 4

    @pytest.mark.asyncio
    async def test_map_markers_have_bilingual_popups(
        self, map_generator, sample_session
    ):
        """Test markers have popups with Chinese and Japanese names."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        with open(output_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Check for Chinese names
            assert "新宿御苑" in content  # point1 cn_name
            assert "代代木公园" in content  # point2 cn_name
            # Check for Japanese names
            assert "Shinjuku Gyoen" in content
            assert "Yoyogi Park" in content

    @pytest.mark.asyncio
    async def test_map_has_route_polylines(self, map_generator, sample_session):
        """Test map draws polylines connecting points in order."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        with open(output_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Folium polylines appear as L.polyline
            assert "L.polyline" in content or "PolyLine" in content

    @pytest.mark.asyncio
    async def test_map_centered_on_route(self, map_generator, sample_session):
        """Test map is centered on the route centroid."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        with open(output_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Map should contain coordinates near Tokyo area (35.x, 139.x)
            assert "35." in content
            assert "139." in content

    @pytest.mark.asyncio
    async def test_output_filename_uses_session_id(
        self, map_generator, sample_session
    ):
        """Test output file is named using session_id."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        assert "test-session-123" in str(output_path)

    @pytest.mark.asyncio
    async def test_input_validation_missing_route(self, map_generator):
        """Test tool raises error when session has no route."""
        # Arrange
        session = PilgrimageSession(
            session_id="test-no-route",
            station=Station(
                name="Test Station",
                coordinates=Coordinates(latitude=35.0, longitude=139.0)
            )
            # No route
        )

        # Act & Assert
        with pytest.raises(ValueError, match="route"):
            await map_generator.generate(session)

    @pytest.mark.asyncio
    async def test_input_validation_empty_segments(self, map_generator):
        """Test tool raises error when route has no segments."""
        # Arrange
        station = Station(
            name="Test Station",
            coordinates=Coordinates(latitude=35.0, longitude=139.0)
        )
        route = Route(
            origin=station,
            segments=[],  # Empty
            total_distance_km=0,
            total_duration_minutes=0
        )
        session = PilgrimageSession(
            session_id="test-empty-segments",
            station=station,
            route=route
        )

        # Act & Assert
        with pytest.raises(ValueError, match="segments"):
            await map_generator.generate(session)

    @pytest.mark.asyncio
    async def test_map_includes_bangumi_color_coding(
        self, map_generator, sample_session
    ):
        """Test markers are color-coded by bangumi."""
        # Act
        output_path = await map_generator.generate(sample_session)

        # Assert
        with open(output_path, "r", encoding="utf-8") as f:
            content = f.read()
            # Should contain colors from bangumi primary_color
            # Note: Folium may encode colors differently
            assert ("FF6B6B" in content.upper() or
                    "ff6b6b" in content or
                    "#FF6B6B" in content)
