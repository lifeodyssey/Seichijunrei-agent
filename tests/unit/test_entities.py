"""Unit tests for domain entities following TDD principles."""

from datetime import datetime
from math import isclose

import pytest
from pydantic import ValidationError

from clients.errors import APIError
from domain.entities import (
    Bangumi,
    Coordinates,
    Point,
    Route,
    RouteSegment,
    SeichijunreiSession,
    Station,
    TransportInfo,
)
from domain.errors import InvalidStationError, NoBangumiFoundError, TooManyPointsError


class TestCoordinates:
    """Test Coordinates value object."""

    def test_create_valid_coordinates(self):
        """Test creating valid coordinates."""
        coords = Coordinates(latitude=35.6812, longitude=139.7671)
        assert coords.latitude == 35.6812
        assert coords.longitude == 139.7671

    def test_coordinates_are_immutable(self):
        """Test that coordinates cannot be modified."""
        coords = Coordinates(latitude=35.6812, longitude=139.7671)
        with pytest.raises(ValidationError):
            coords.latitude = 40.0

    def test_coordinates_validation(self):
        """Test coordinate validation boundaries."""
        # Valid boundaries
        Coordinates(latitude=90, longitude=180)
        Coordinates(latitude=-90, longitude=-180)

        # Invalid latitude
        with pytest.raises(ValidationError, match="less than or equal to 90"):
            Coordinates(latitude=91, longitude=0)

        with pytest.raises(ValidationError, match="greater than or equal to -90"):
            Coordinates(latitude=-91, longitude=0)

        # Invalid longitude
        with pytest.raises(ValidationError, match="less than or equal to 180"):
            Coordinates(latitude=0, longitude=181)

        with pytest.raises(ValidationError, match="greater than or equal to -180"):
            Coordinates(latitude=0, longitude=-181)

    def test_coordinates_rounding(self):
        """Test that coordinates are rounded to 6 decimal places."""
        coords = Coordinates(latitude=35.68123456789, longitude=139.76712345678)
        assert coords.latitude == 35.681235
        assert coords.longitude == 139.767123

    def test_to_tuple(self):
        """Test converting coordinates to tuple."""
        coords = Coordinates(latitude=35.6812, longitude=139.7671)
        assert coords.to_tuple() == (35.6812, 139.7671)

    def test_to_string(self):
        """Test converting coordinates to string."""
        coords = Coordinates(latitude=35.6812, longitude=139.7671)
        assert coords.to_string() == "35.6812,139.7671"

    def test_distance_calculation(self):
        """Test Haversine distance calculation."""
        tokyo = Coordinates(latitude=35.6812, longitude=139.7671)
        osaka = Coordinates(latitude=34.6937, longitude=135.5023)

        distance = tokyo.distance_to(osaka)
        # Distance should be approximately 400km
        assert isclose(distance, 400, rel_tol=50)


class TestStation:
    """Test Station entity."""

    def test_create_station(self):
        """Test creating a station."""
        coords = Coordinates(latitude=35.6812, longitude=139.7671)
        station = Station(
            name="Tokyo Station",
            coordinates=coords,
            city="Tokyo",
            prefecture="Tokyo",
        )
        assert station.name == "Tokyo Station"
        assert station.coordinates == coords
        assert station.city == "Tokyo"
        assert station.prefecture == "Tokyo"

    def test_station_name_validation(self):
        """Test station name is trimmed."""
        coords = Coordinates(latitude=35.6812, longitude=139.7671)
        station = Station(name="  Tokyo Station  ", coordinates=coords)
        assert station.name == "Tokyo Station"

    def test_station_without_optional_fields(self):
        """Test creating station without optional fields."""
        coords = Coordinates(latitude=35.6812, longitude=139.7671)
        station = Station(name="Tokyo Station", coordinates=coords)
        assert station.city is None
        assert station.prefecture is None


class TestBangumi:
    """Test Bangumi (anime series) entity."""

    def test_create_bangumi(self):
        """Test creating a bangumi."""
        bangumi = Bangumi(
            id="BG001",
            title="君の名は。",
            cn_title="你的名字",
            cover_url="https://example.com/cover.jpg",
            points_count=10,
            distance_km=5.5,
            primary_color="#FF5733",
        )
        assert bangumi.id == "BG001"
        assert bangumi.title == "君の名は。"
        assert bangumi.cn_title == "你的名字"
        assert bangumi.points_count == 10
        assert bangumi.distance_km == 5.5
        assert bangumi.primary_color == "#FF5733"

    def test_bangumi_hashable(self):
        """Test that bangumi can be hashed (for sets)."""
        bangumi1 = Bangumi(
            id="BG001",
            title="Title",
            cn_title="Chinese Title",
            cover_url="https://example.com/cover.jpg",
            points_count=10,
        )
        bangumi2 = Bangumi(
            id="BG001",
            title="Different Title",
            cn_title="Different Chinese",
            cover_url="https://example.com/different.jpg",
            points_count=20,
        )
        # Same ID means same hash
        assert hash(bangumi1) == hash(bangumi2)

    def test_bangumi_validation(self):
        """Test bangumi validation."""
        # ID cannot be empty
        with pytest.raises(ValueError):
            Bangumi(
                id="",
                title="Title",
                cn_title="Chinese",
                cover_url="https://example.com/cover.jpg",
                points_count=10,
            )

        # Points count must be non-negative
        with pytest.raises(ValueError):
            Bangumi(
                id="BG001",
                title="Title",
                cn_title="Chinese",
                cover_url="https://example.com/cover.jpg",
                points_count=-1,
            )


class TestPoint:
    """Test Point (pilgrimage location) entity."""

    def test_create_point(self):
        """Test creating a pilgrimage point."""
        coords = Coordinates(latitude=35.6867, longitude=139.7189)
        point = Point(
            id="PP001",
            name="須賀神社階段",
            cn_name="须贺神社阶梯",
            coordinates=coords,
            bangumi_id="BG001",
            bangumi_title="君の名は。",
            episode=1,
            time_seconds=125,
            screenshot_url="https://example.com/screenshot.jpg",
            address="Tokyo, Shinjuku",
            opening_hours="24/7",
            admission_fee="Free",
        )
        assert point.id == "PP001"
        assert point.name == "須賀神社階段"
        assert point.cn_name == "须贺神社阶梯"
        assert point.coordinates == coords
        assert point.bangumi_id == "BG001"
        assert point.episode == 1
        assert point.time_seconds == 125

    def test_point_time_formatted(self):
        """Test time formatting."""
        coords = Coordinates(latitude=35.6867, longitude=139.7189)
        point = Point(
            id="PP001",
            name="Location",
            cn_name="地点",
            coordinates=coords,
            bangumi_id="BG001",
            bangumi_title="Title",
            episode=1,
            time_seconds=125,
            screenshot_url="https://example.com/shot.jpg",
        )
        assert point.time_formatted == "2:05"

        point2 = Point(
            id="PP002",
            name="Location2",
            cn_name="地点2",
            coordinates=coords,
            bangumi_id="BG001",
            bangumi_title="Title",
            episode=1,
            time_seconds=59,
            screenshot_url="https://example.com/shot.jpg",
        )
        assert point2.time_formatted == "0:59"

    def test_point_hashable(self):
        """Test that points can be hashed."""
        coords = Coordinates(latitude=35.6867, longitude=139.7189)
        point1 = Point(
            id="PP001",
            name="Name1",
            cn_name="中文1",
            coordinates=coords,
            bangumi_id="BG001",
            bangumi_title="Title",
            episode=1,
            time_seconds=125,
            screenshot_url="https://example.com/shot.jpg",
        )
        point2 = Point(
            id="PP001",
            name="Name2",
            cn_name="中文2",
            coordinates=coords,
            bangumi_id="BG002",
            bangumi_title="Title2",
            episode=2,
            time_seconds=200,
            screenshot_url="https://example.com/shot2.jpg",
        )
        # Same ID means same hash
        assert hash(point1) == hash(point2)


class TestTransportInfo:
    """Test TransportInfo entity."""

    def test_create_transport_info(self):
        """Test creating transport information."""
        transport = TransportInfo(
            mode="walk",
            distance_meters=500,
            duration_minutes=7,
            instructions="Walk north for 500 meters",
        )
        assert transport.mode == "walk"
        assert transport.distance_meters == 500
        assert transport.duration_minutes == 7
        assert transport.instructions == "Walk north for 500 meters"

    def test_distance_km_property(self):
        """Test distance conversion to kilometers."""
        transport = TransportInfo(
            mode="walk", distance_meters=1500, duration_minutes=20
        )
        assert transport.distance_km == 1.5

    def test_duration_formatted(self):
        """Test duration formatting."""
        # Minutes only
        transport1 = TransportInfo(
            mode="walk", distance_meters=500, duration_minutes=45
        )
        assert transport1.duration_formatted == "45min"

        # Hours and minutes
        transport2 = TransportInfo(
            mode="transit", distance_meters=50000, duration_minutes=125
        )
        assert transport2.duration_formatted == "2h 5min"

        # Exact hours
        transport3 = TransportInfo(
            mode="driving", distance_meters=100000, duration_minutes=120
        )
        assert transport3.duration_formatted == "2h 0min"

    def test_transit_details(self):
        """Test transit mode with details."""
        details = {
            "line": "JR Yamanote Line",
            "departure": "Tokyo Station",
            "arrival": "Shinjuku Station",
            "stops": 5,
        }
        transport = TransportInfo(
            mode="transit",
            distance_meters=5000,
            duration_minutes=15,
            transit_details=details,
        )
        assert transport.transit_details == details


class TestRoute:
    """Test Route entity and related components."""

    @pytest.fixture
    def sample_route_data(self):
        """Create sample data for route testing."""
        station = Station(
            name="Tokyo Station",
            coordinates=Coordinates(latitude=35.6812, longitude=139.7671),
        )

        points = [
            Point(
                id=f"PP00{i}",
                name=f"Location {i}",
                cn_name=f"地点 {i}",
                coordinates=Coordinates(
                    latitude=35.6812 + i * 0.01, longitude=139.7671 + i * 0.01
                ),
                bangumi_id="BG001" if i <= 2 else "BG002",
                bangumi_title="Anime 1" if i <= 2 else "Anime 2",
                episode=1,
                time_seconds=100 * i,
                screenshot_url=f"https://example.com/shot{i}.jpg",
            )
            for i in range(1, 5)
        ]

        segments = []
        cumulative_distance = 0
        cumulative_duration = 0

        for i, point in enumerate(points, 1):
            transport = None
            if i > 1:
                transport = TransportInfo(
                    mode="walk",
                    distance_meters=500 * i,
                    duration_minutes=7 * i,
                )
                cumulative_distance += transport.distance_km
                cumulative_duration += transport.duration_minutes

            segment = RouteSegment(
                order=i,
                point=point,
                transport=transport,
                cumulative_distance_km=cumulative_distance,
                cumulative_duration_minutes=cumulative_duration,
            )
            segments.append(segment)

        return station, segments

    def test_create_route(self, sample_route_data):
        """Test creating a route."""
        station, segments = sample_route_data

        route = Route(
            origin=station,
            segments=segments,
            total_distance_km=10.5,
            total_duration_minutes=90,
            google_maps_url="https://maps.google.com/route",
        )

        assert route.origin == station
        assert len(route.segments) == 4
        assert route.total_distance_km == 10.5
        assert route.total_duration_minutes == 90

    def test_route_duration_formatted(self, sample_route_data):
        """Test route duration formatting."""
        station, segments = sample_route_data

        route1 = Route(
            origin=station,
            segments=segments,
            total_distance_km=10.5,
            total_duration_minutes=45,
        )
        assert route1.total_duration_formatted == "45min"

        route2 = Route(
            origin=station,
            segments=segments,
            total_distance_km=20,
            total_duration_minutes=125,
        )
        assert route2.total_duration_formatted == "2h 5min"

    def test_route_points_count(self, sample_route_data):
        """Test counting points in route."""
        station, segments = sample_route_data

        route = Route(
            origin=station,
            segments=segments,
            total_distance_km=10.5,
            total_duration_minutes=90,
        )
        assert route.points_count == 4

    def test_route_bangumi_grouping(self, sample_route_data):
        """Test grouping points by bangumi."""
        station, segments = sample_route_data

        route = Route(
            origin=station,
            segments=segments,
            total_distance_km=10.5,
            total_duration_minutes=90,
        )

        groups = route.get_bangumi_groups()
        assert len(groups) == 2
        assert "BG001" in groups
        assert "BG002" in groups
        assert len(groups["BG001"]) == 2  # First 2 points
        assert len(groups["BG002"]) == 2  # Last 2 points


class TestSeichijunreiSession:
    """Test SeichijunreiSession entity."""

    def test_create_session(self):
        """Test creating a pilgrimage session."""
        session = SeichijunreiSession(session_id="test-session-123")
        assert session.session_id == "test-session-123"
        assert session.station is None
        assert session.selected_bangumi_ids == []
        assert session.search_radius_km == 5.0
        assert session.nearby_bangumi == []
        assert session.points == []
        assert session.route is None
        assert isinstance(session.created_at, datetime)
        assert isinstance(session.updated_at, datetime)

    def test_session_with_data(self):
        """Test session with populated data."""
        station = Station(
            name="Tokyo Station",
            coordinates=Coordinates(latitude=35.6812, longitude=139.7671),
        )

        bangumi = Bangumi(
            id="BG001",
            title="Title",
            cn_title="中文标题",
            cover_url="https://example.com/cover.jpg",
            points_count=10,
        )

        session = SeichijunreiSession(
            session_id="test-session-456",
            station=station,
            selected_bangumi_ids=["BG001", "BG002"],
            search_radius_km=10.0,
            nearby_bangumi=[bangumi],
        )

        assert session.station == station
        assert "BG001" in session.selected_bangumi_ids
        assert session.search_radius_km == 10.0
        assert len(session.nearby_bangumi) == 1

    def test_session_update_timestamp(self):
        """Test updating session timestamp."""
        session = SeichijunreiSession(session_id="test-session-789")
        original_updated = session.updated_at

        # Small delay to ensure timestamp changes
        import time

        time.sleep(0.01)

        session.update()
        assert session.updated_at > original_updated

    def test_search_radius_validation(self):
        """Test search radius validation."""
        # Valid ranges
        SeichijunreiSession(session_id="test", search_radius_km=1.0)
        SeichijunreiSession(session_id="test", search_radius_km=20.0)

        # Invalid ranges
        with pytest.raises(ValueError):
            SeichijunreiSession(session_id="test", search_radius_km=0.5)

        with pytest.raises(ValueError):
            SeichijunreiSession(session_id="test", search_radius_km=21.0)


class TestDomainExceptions:
    """Test domain-specific exceptions."""

    def test_invalid_station_error(self):
        """Test InvalidStationError exception."""
        error = InvalidStationError("Unknown station: XYZ")
        assert str(error) == "Unknown station: XYZ"
        assert isinstance(error, Exception)

    def test_no_bangumi_found_error(self):
        """Test NoBangumiFoundError exception."""
        error = NoBangumiFoundError("No anime locations found within 5km")
        assert str(error) == "No anime locations found within 5km"

    def test_too_many_points_error(self):
        """Test TooManyPointsError exception."""
        error = TooManyPointsError("Cannot optimize route with >50 points")
        assert str(error) == "Cannot optimize route with >50 points"

    def test_api_error(self):
        """Test APIError exception."""
        error = APIError("Google Maps API rate limit exceeded")
        assert str(error) == "Google Maps API rate limit exceeded"
