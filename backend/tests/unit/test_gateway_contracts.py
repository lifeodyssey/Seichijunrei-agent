"""Unit tests for gateway contract compliance.

These tests verify that infrastructure adapters correctly implement
application port interfaces and map errors appropriately.
"""

from unittest.mock import AsyncMock

import pytest

from backend.application.errors import ExternalServiceError, InvalidInputError
from backend.application.ports import AnitabiGateway, BangumiGateway
from backend.clients.errors import APIError, NotFoundError
from backend.domain.entities import Coordinates, Point, Station
from backend.domain.errors import InvalidStationError
from backend.infrastructure.gateways.anitabi import AnitabiClientGateway
from backend.infrastructure.gateways.bangumi import BangumiClientGateway

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
def sample_bangumi_lite():
    """Create a sample bangumi lite response."""
    return {
        "id": "bg-001",
        "title": "Test Anime",
        "cn": "测试动画",
        "city": "東京都",
        "cover": "https://example.com/cover.jpg",
        "geo": [139.7671, 35.6812],
        "zoom": 14,
        "pointsLength": 5,
    }


# --- AnitabiGateway Contract Tests ---


class TestAnitabiGatewayContract:
    """Tests for AnitabiClientGateway port implementation."""

    def test_gateway_implements_port(self, mock_anitabi_client):
        """Gateway class should implement AnitabiGateway protocol."""
        gateway = AnitabiClientGateway(client=mock_anitabi_client)
        # Protocol compliance: check required methods exist
        assert hasattr(gateway, "get_bangumi_points")
        assert hasattr(gateway, "get_bangumi_lite")
        assert hasattr(gateway, "get_station_info")

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
    async def test_get_bangumi_lite_returns_dict(
        self, mock_anitabi_client, sample_bangumi_lite
    ):
        """get_bangumi_lite should return dict with metadata."""
        mock_anitabi_client.get_bangumi_lite.return_value = sample_bangumi_lite
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        result = await gateway.get_bangumi_lite("bg-001")

        assert isinstance(result, dict)
        assert result["title"] == "Test Anime"
        assert result["city"] == "東京都"
        mock_anitabi_client.get_bangumi_lite.assert_called_once_with("bg-001")

    @pytest.mark.asyncio
    async def test_get_bangumi_lite_maps_api_error(self, mock_anitabi_client):
        """API errors should be mapped to ExternalServiceError."""
        mock_anitabi_client.get_bangumi_lite.side_effect = APIError("Not found")
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(ExternalServiceError) as exc_info:
            await gateway.get_bangumi_lite("bg-001")

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


class TestBangumiClientGatewaySearchByTitle:
    @pytest.mark.asyncio
    async def test_returns_bangumi_id_on_hit(self):
        mock_client = AsyncMock()
        mock_client.search_subject = AsyncMock(
            return_value=[{"id": 6718, "name": "進撃の巨人"}]
        )
        gateway = BangumiClientGateway(client=mock_client)

        result = await gateway.search_by_title("進撃の巨人")

        assert result == "6718"

    @pytest.mark.asyncio
    async def test_returns_none_on_empty_results(self):
        mock_client = AsyncMock()
        mock_client.search_subject = AsyncMock(return_value=[])
        gateway = BangumiClientGateway(client=mock_client)

        result = await gateway.search_by_title("completely unknown anime xyz")

        assert result is None


class TestProtocolCompliance:
    """Verify gateway classes satisfy Protocol type contracts."""

    def test_anitabi_gateway_is_protocol_compliant(self):
        """AnitabiClientGateway must be usable where AnitabiGateway is expected."""

        # This test verifies structural subtyping
        def use_anitabi_gateway(gw: AnitabiGateway) -> bool:
            return (
                hasattr(gw, "get_bangumi_points")
                and hasattr(gw, "get_bangumi_lite")
                and hasattr(gw, "get_station_info")
            )

        gateway = AnitabiClientGateway()
        assert use_anitabi_gateway(gateway)

    def test_bangumi_gateway_is_protocol_compliant(self):
        """BangumiClientGateway must be usable where BangumiGateway is expected."""

        def use_bangumi_gateway(gw: BangumiGateway) -> bool:
            return hasattr(gw, "search_subject") and hasattr(gw, "get_subject")

        gateway = BangumiClientGateway()
        assert use_bangumi_gateway(gateway)


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
    async def test_anitabi_maps_lite_api_error_to_external_error(
        self, mock_anitabi_client
    ):
        """get_bangumi_lite API errors should map to ExternalServiceError."""
        mock_anitabi_client.get_bangumi_lite.side_effect = APIError("Server error")
        gateway = AnitabiClientGateway(client=mock_anitabi_client)

        with pytest.raises(ExternalServiceError):
            await gateway.get_bangumi_lite("bg-001")
