"""Unit tests for gateway contract compliance.

These tests verify that infrastructure adapters correctly implement
application port interfaces and map errors appropriately.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from application.errors import ExternalServiceError, InvalidInputError
from application.ports import AnitabiGateway, BangumiGateway, RoutePlanner
from clients.errors import APIError, NotFoundError
from domain.entities import Bangumi, Coordinates, Point, Station
from domain.errors import InvalidStationError, NoBangumiFoundError
from infrastructure.gateways.anitabi import AnitabiClientGateway
from infrastructure.gateways.bangumi import BangumiClientGateway
from infrastructure.gateways.route_planner import SimpleRoutePlannerGateway

# --- Test Fixtures ---


@pytest.fixture
def mock_anitabi_client():
    """Create a mock AnitabiClient."""
    client = AsyncMock()
    return client


@pytest.fixture
def mock_bangumi_client():
    """Create a mock BangumiClient."""
    client = AsyncMock()
    return client


@pytest.fixture
def mock_route_planner():
    """Create a mock SimpleRoutePlanner."""
    planner = MagicMock()
    return planner


@pytest.fixture
def sample_station():
    """Create a sample Station entity."""
    return Station(
        name="Tokyo",
        coordinates=Coordinates(latitude=35.6812, longitude=139.7671),
        city="Tokyo",
        prefecture="Tokyo",
    )


@pytest.fixture
def sample_point():
    """Create a sample Point entity."""
    return Point(
        id="pt-001",
        name="Shrine",
        cn_name="神社",
        coordinates=Coordinates(latitude=35.7, longitude=139.8),
        bangumi_id="bg-001",
        bangumi_title="Test Anime",
        episode=1,
        time_seconds=120,
        screenshot_url="https://example.com/screenshot.jpg",
    )


@pytest.fixture
def sample_bangumi():
    """Create a sample Bangumi entity."""
    return Bangumi(
        id="bg-001",
        title="Test Anime",
        cn_title="测试动画",
        cover_url="https://example.com/cover.jpg",
        points_count=5,
        distance_km=2.5,
    )


# --- AnitabiGateway Contract Tests ---


class TestAnitabiGatewayContract:
    """Tests for AnitabiClientGateway port implementation."""

    def test_gateway_implements_port(self, mock_anitabi_client):
        """Gateway class should implement AnitabiGateway protocol."""
        gateway = AnitabiClientGateway(client=mock_anitabi_client)
        # Protocol compliance: check required methods exist
        assert hasattr(gateway, "get_bangumi_points")
        assert hasattr(gateway, "get_station_info")
        assert hasattr(gateway, "search_bangumi")

    @pytest.mark.asyncio
    async def test_get_bangumi_points_returns_list_of_points(
        self, mock_anitabi_client, sample_point
    ):
        """get_bangumi_points should return list[Point]."""
        mock_anitabi_client.get_bangumi_points.return_value = [sample_point]
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        result = await gateway.get_bangumi_points("bg-001")

        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], Point)
        mock_anitabi_client.get_bangumi_points.assert_called_once_with("bg-001")

    @pytest.mark.asyncio
    async def test_get_bangumi_points_maps_api_error(self, mock_anitabi_client):
        """API errors should be mapped to ExternalServiceError."""
        mock_anitabi_client.get_bangumi_points.side_effect = APIError("API failed")
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(ExternalServiceError) as exc_info:
            await gateway.get_bangumi_points("bg-001")

        assert exc_info.value.service == "anitabi"

    @pytest.mark.asyncio
    async def test_get_station_info_returns_station(
        self, mock_anitabi_client, sample_station
    ):
        """get_station_info should return Station entity."""
        mock_anitabi_client.get_station_info.return_value = sample_station
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        result = await gateway.get_station_info("Tokyo")

        assert isinstance(result, Station)
        assert result.name == "Tokyo"
        mock_anitabi_client.get_station_info.assert_called_once_with("Tokyo")

    @pytest.mark.asyncio
    async def test_get_station_info_maps_not_found_to_invalid_station(
        self, mock_anitabi_client
    ):
        """Station NotFoundError should map to InvalidStationError."""
        mock_anitabi_client.get_station_info.side_effect = NotFoundError(
            "Station not found: Unknown", resource_type="station"
        )
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(InvalidStationError):
            await gateway.get_station_info("Unknown")

    @pytest.mark.asyncio
    async def test_get_station_info_maps_api_error(self, mock_anitabi_client):
        """General API errors should be mapped to ExternalServiceError."""
        mock_anitabi_client.get_station_info.side_effect = APIError("Server error")
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(ExternalServiceError) as exc_info:
            await gateway.get_station_info("Tokyo")

        assert exc_info.value.service == "anitabi"

    @pytest.mark.asyncio
    async def test_search_bangumi_returns_list_of_bangumi(
        self, mock_anitabi_client, sample_station, sample_bangumi
    ):
        """search_bangumi should return list[Bangumi]."""
        mock_anitabi_client.search_bangumi.return_value = [sample_bangumi]
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        result = await gateway.search_bangumi(station=sample_station, radius_km=10.0)

        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], Bangumi)
        mock_anitabi_client.search_bangumi.assert_called_once_with(
            station=sample_station, radius_km=10.0
        )

    @pytest.mark.asyncio
    async def test_search_bangumi_maps_not_found_to_no_bangumi(
        self, mock_anitabi_client, sample_station
    ):
        """Bangumi NotFoundError should map to NoBangumiFoundError."""
        mock_anitabi_client.search_bangumi.side_effect = NotFoundError(
            "No bangumi found near Tokyo", resource_type="bangumi"
        )
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(NoBangumiFoundError):
            await gateway.search_bangumi(station=sample_station, radius_km=10.0)

    @pytest.mark.asyncio
    async def test_search_bangumi_maps_api_error(
        self, mock_anitabi_client, sample_station
    ):
        """General API errors should be mapped to ExternalServiceError."""
        mock_anitabi_client.search_bangumi.side_effect = APIError("Network error")
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(ExternalServiceError) as exc_info:
            await gateway.search_bangumi(station=sample_station, radius_km=10.0)

        assert exc_info.value.service == "anitabi"

    @pytest.mark.asyncio
    async def test_gateway_context_manager(self, mock_anitabi_client):
        """Gateway should support async context manager protocol."""
        async with AnitabiClientGateway(client=mock_anitabi_client) as gateway:
            assert gateway is not None

        mock_anitabi_client.close.assert_called_once()


# --- BangumiGateway Contract Tests ---


class TestBangumiGatewayContract:
    """Tests for BangumiClientGateway port implementation."""

    def test_gateway_implements_port(self, mock_bangumi_client):
        """Gateway class should implement BangumiGateway protocol."""
        gateway = BangumiClientGateway(client=mock_bangumi_client)
        # Protocol compliance: check required methods exist
        assert hasattr(gateway, "search_subject")
        assert hasattr(gateway, "get_subject")

    @pytest.mark.asyncio
    async def test_search_subject_returns_list_of_dicts(self, mock_bangumi_client):
        """search_subject should return list[dict]."""
        mock_bangumi_client.search_subject.return_value = [
            {"id": 1, "name": "Test Anime"}
        ]
        gateway = BangumiClientGateway(client=mock_bangumi_client)

        result = await gateway.search_subject(
            keyword="test", subject_type=2, max_results=10
        )

        assert isinstance(result, list)
        assert len(result) == 1
        assert isinstance(result[0], dict)
        mock_bangumi_client.search_subject.assert_called_once_with(
            keyword="test", subject_type=2, max_results=10
        )

    @pytest.mark.asyncio
    async def test_search_subject_maps_value_error_to_invalid_input(
        self, mock_bangumi_client
    ):
        """ValueError should be mapped to InvalidInputError."""
        mock_bangumi_client.search_subject.side_effect = ValueError("Invalid keyword")
        gateway = BangumiClientGateway(client=mock_bangumi_client)

        with pytest.raises(InvalidInputError):
            await gateway.search_subject(keyword="", subject_type=2, max_results=10)

    @pytest.mark.asyncio
    async def test_search_subject_maps_api_error(self, mock_bangumi_client):
        """APIError should be mapped to ExternalServiceError."""
        mock_bangumi_client.search_subject.side_effect = APIError("Rate limited")
        gateway = BangumiClientGateway(client=mock_bangumi_client)

        with pytest.raises(ExternalServiceError) as exc_info:
            await gateway.search_subject(keyword="test", subject_type=2, max_results=10)

        assert exc_info.value.service == "bangumi"

    @pytest.mark.asyncio
    async def test_get_subject_returns_dict(self, mock_bangumi_client):
        """get_subject should return dict."""
        mock_bangumi_client.get_subject.return_value = {
            "id": 123,
            "name": "Test Anime",
            "name_cn": "测试动画",
        }
        gateway = BangumiClientGateway(client=mock_bangumi_client)

        result = await gateway.get_subject(123)

        assert isinstance(result, dict)
        assert result["id"] == 123
        mock_bangumi_client.get_subject.assert_called_once_with(123)

    @pytest.mark.asyncio
    async def test_get_subject_maps_value_error_to_invalid_input(
        self, mock_bangumi_client
    ):
        """ValueError should be mapped to InvalidInputError."""
        mock_bangumi_client.get_subject.side_effect = ValueError("Invalid ID")
        gateway = BangumiClientGateway(client=mock_bangumi_client)

        with pytest.raises(InvalidInputError):
            await gateway.get_subject(-1)

    @pytest.mark.asyncio
    async def test_get_subject_maps_api_error(self, mock_bangumi_client):
        """APIError should be mapped to ExternalServiceError."""
        mock_bangumi_client.get_subject.side_effect = APIError("Not found")
        gateway = BangumiClientGateway(client=mock_bangumi_client)

        with pytest.raises(ExternalServiceError) as exc_info:
            await gateway.get_subject(999)

        assert exc_info.value.service == "bangumi"

    @pytest.mark.asyncio
    async def test_gateway_context_manager(self, mock_bangumi_client):
        """Gateway should support async context manager protocol."""
        async with BangumiClientGateway(client=mock_bangumi_client) as gateway:
            assert gateway is not None

        mock_bangumi_client.close.assert_called_once()


# --- RoutePlanner Contract Tests ---


class TestRoutePlannerContract:
    """Tests for SimpleRoutePlannerGateway port implementation."""

    def test_gateway_implements_port(self, mock_route_planner):
        """Gateway class should implement RoutePlanner protocol."""
        gateway = SimpleRoutePlannerGateway(planner=mock_route_planner)
        # Protocol compliance: check required methods exist
        assert hasattr(gateway, "generate_plan")

    def test_generate_plan_returns_dict(self, mock_route_planner):
        """generate_plan should return dict."""
        mock_route_planner.generate_plan.return_value = {
            "recommended_order": ["Point A", "Point B"],
            "estimated_duration": "2-3h",
        }
        gateway = SimpleRoutePlannerGateway(planner=mock_route_planner)

        result = gateway.generate_plan(
            origin="Tokyo",
            anime="Test Anime",
            points=[{"name": "Point A"}, {"name": "Point B"}],
        )

        assert isinstance(result, dict)
        assert "recommended_order" in result
        mock_route_planner.generate_plan.assert_called_once_with(
            origin="Tokyo",
            anime="Test Anime",
            points=[{"name": "Point A"}, {"name": "Point B"}],
        )

    def test_generate_plan_with_empty_points(self, mock_route_planner):
        """generate_plan should handle empty points list."""
        mock_route_planner.generate_plan.return_value = {
            "recommended_order": [],
            "estimated_duration": "0h",
        }
        gateway = SimpleRoutePlannerGateway(planner=mock_route_planner)

        result = gateway.generate_plan(origin="Tokyo", anime="Test", points=[])

        assert isinstance(result, dict)
        assert result["recommended_order"] == []

    def test_gateway_creates_planner_on_demand(self):
        """Gateway should create SimpleRoutePlanner lazily when none provided."""
        gateway = SimpleRoutePlannerGateway()

        # Planner is None initially
        assert gateway._planner is None

        # Calling generate_plan creates the planner
        result = gateway.generate_plan(
            origin="Tokyo",
            anime="Test Anime",
            points=[{"name": "A", "lat": 35.0, "lng": 139.0}],
        )

        # Planner is now set
        assert gateway._planner is not None
        assert isinstance(result, dict)


# --- Protocol Compliance Tests ---


class TestProtocolCompliance:
    """Verify gateway classes satisfy Protocol type contracts."""

    def test_anitabi_gateway_is_protocol_compliant(self):
        """AnitabiClientGateway must be usable where AnitabiGateway is expected."""
        # This test verifies structural subtyping
        def use_anitabi_gateway(gw: AnitabiGateway) -> bool:
            return hasattr(gw, "get_bangumi_points") and hasattr(gw, "get_station_info")

        gateway = AnitabiClientGateway()
        assert use_anitabi_gateway(gateway)

    def test_bangumi_gateway_is_protocol_compliant(self):
        """BangumiClientGateway must be usable where BangumiGateway is expected."""

        def use_bangumi_gateway(gw: BangumiGateway) -> bool:
            return hasattr(gw, "search_subject") and hasattr(gw, "get_subject")

        gateway = BangumiClientGateway()
        assert use_bangumi_gateway(gateway)

    def test_route_planner_is_protocol_compliant(self):
        """SimpleRoutePlannerGateway must be usable where RoutePlanner is expected."""

        def use_route_planner(rp: RoutePlanner) -> bool:
            return hasattr(rp, "generate_plan")

        gateway = SimpleRoutePlannerGateway()
        assert use_route_planner(gateway)


# --- Error Mapping Completeness Tests ---


class TestErrorMappingCompleteness:
    """Verify all expected error mappings are implemented."""

    @pytest.mark.asyncio
    async def test_anitabi_maps_non_station_not_found_to_external_error(
        self, mock_anitabi_client
    ):
        """Non-station NotFoundError should map to ExternalServiceError."""
        # Other resource types that are not station should raise ExternalServiceError
        mock_anitabi_client.get_station_info.side_effect = NotFoundError(
            "Unknown resource not found", resource_type="unknown"
        )
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(ExternalServiceError):
            await gateway.get_station_info("test")

    @pytest.mark.asyncio
    async def test_anitabi_maps_non_bangumi_not_found_to_external_error(
        self, mock_anitabi_client, sample_station
    ):
        """Non-bangumi NotFoundError should map to ExternalServiceError."""
        mock_anitabi_client.search_bangumi.side_effect = NotFoundError(
            "Unknown resource not found", resource_type="unknown"
        )
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(ExternalServiceError):
            await gateway.search_bangumi(station=sample_station, radius_km=10.0)
