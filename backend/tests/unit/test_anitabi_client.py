"""
Unit tests for Anitabi API client.

Tests cover:
- Bangumi lite metadata retrieval
- Point retrieval for specific bangumi
- Station information lookup (deprecated)
- Error handling for invalid responses
- Response caching behavior
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.clients.anitabi import (
    AnitabiClient,
    _detect_schema,
    _parse_legacy_point,
    _parse_official_point,
)
from backend.clients.errors import APIError, NotFoundError
from backend.domain.entities import Point, Station


class TestAnitabiClient:
    """Test the Anitabi API client."""

    @pytest.fixture
    async def client(self):
        """Create an Anitabi client instance."""
        return AnitabiClient(
            api_key="test_key",
            use_cache=True,
            rate_limit_calls=10,
            rate_limit_period=1.0,
        )

    @pytest.fixture
    def mock_points_response(self):
        """Mock response for bangumi points."""
        return {
            "data": [
                {
                    "id": "point_1",
                    "name": "豊郷小学校旧校舎",
                    "cn_name": "丰乡小学校旧校舍",
                    "lat": 35.179798,
                    "lng": 136.232495,
                    "bangumi_id": "bangumi_1",
                    "bangumi_title": "けいおん！",
                    "episode": 1,
                    "time_seconds": 125,
                    "screenshot": "https://example.com/shot1.jpg",
                    "address": "滋賀県犬上郡豊郷町",
                    "opening_hours": "9:00-17:00",
                    "admission_fee": "無料",
                },
                {
                    "id": "point_2",
                    "name": "京都駅",
                    "cn_name": "京都站",
                    "lat": 34.985849,
                    "lng": 135.758767,
                    "bangumi_id": "bangumi_1",
                    "bangumi_title": "けいおん！",
                    "episode": 2,
                    "time_seconds": 240,
                    "screenshot": "https://example.com/shot2.jpg",
                    "address": "京都府京都市",
                    "opening_hours": "24時間",
                    "admission_fee": None,
                },
            ],
            "total": 2,
        }

    @pytest.fixture
    def mock_station_response(self):
        """Mock response for station info."""
        return {
            "data": {
                "name": "東京駅",
                "lat": 35.681236,
                "lng": 139.767125,
                "city": "東京都",
                "prefecture": "東京都",
            }
        }

    # -- get_bangumi_lite tests --

    @pytest.mark.asyncio
    async def test_get_bangumi_lite_success(self, client):
        """Test successful retrieval of bangumi lite info."""
        mock_response = {
            "id": "115908",
            "cn": "吹响吧！上低音号",
            "title": "響け！ユーフォニアム",
            "city": "京都府宇治市",
            "cover": "https://example.com/cover.jpg",
            "color": "#4A90D9",
            "geo": [135.8, 34.9],
            "zoom": 14,
            "pointsLength": 577,
            "imagesLength": 1200,
        }

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            result = await client.get_bangumi_lite("115908")

            mock_get.assert_called_once_with("/115908/lite")
            assert result["title"] == "響け！ユーフォニアム"
            assert result["cn"] == "吹响吧！上低音号"
            assert result["city"] == "京都府宇治市"

    @pytest.mark.asyncio
    async def test_get_bangumi_lite_api_error(self, client):
        """Test bangumi lite with API error."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = APIError("API request failed with status 404")

            with pytest.raises(APIError, match="404"):
                await client.get_bangumi_lite("invalid_id")

    # -- get_bangumi_points tests --

    @pytest.mark.asyncio
    async def test_get_bangumi_points_success(self, client, mock_points_response):
        """Test successful retrieval of bangumi points."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_points_response

            points = await client.get_bangumi_points("bangumi_1")

            # Verify API call
            mock_get.assert_called_once_with(
                "/bangumi_1/points/detail", params={"haveImage": "true"}
            )

            # Verify results
            assert len(points) == 2
            assert isinstance(points[0], Point)
            assert points[0].id == "point_1"
            assert points[0].name == "豊郷小学校旧校舎"
            assert points[0].coordinates.latitude == 35.179798
            assert points[0].episode == 1
            assert points[0].time_formatted == "2:05"

    @pytest.mark.asyncio
    async def test_get_bangumi_points_invalid_id(self, client):
        """Test point retrieval with invalid bangumi ID."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = APIError("API request failed with status 404")

            with pytest.raises(APIError, match="404"):
                await client.get_bangumi_points("invalid_id")

    @pytest.mark.asyncio
    async def test_get_bangumi_points_with_origin_info(self, client):
        """Test that origin information is parsed from official API response."""
        mock_response = [
            {
                "id": "point_1",
                "name": "Test Location",
                "cn": "测试地点",
                "geo": [35.6812, 139.7671],
                "ep": 1,
                "s": 120,
                "image": "https://example.com/shot.jpg",
                "origin": "Google Maps",
                "originURL": "https://maps.google.com/test",
            }
        ]

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_response

            points = await client.get_bangumi_points("test_bangumi")

            assert len(points) == 1
            assert points[0].origin == "Google Maps"
            assert points[0].origin_url == "https://maps.google.com/test"

    # -- get_station_info tests --

    @pytest.mark.asyncio
    async def test_get_station_info_success(self, client, mock_station_response):
        """Test successful station information lookup."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_station_response

            station = await client.get_station_info("東京駅")

            # Verify API call
            mock_get.assert_called_once_with("/station", params={"name": "東京駅"})

            # Verify results
            assert isinstance(station, Station)
            assert station.name == "東京駅"
            assert station.coordinates.latitude == 35.681236
            assert station.city == "東京都"

    @pytest.mark.asyncio
    async def test_get_station_info_not_found(self, client):
        """Test station lookup with unknown station name."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"data": None, "error": "Station not found"}

            with pytest.raises(NotFoundError, match="Station not found"):
                await client.get_station_info("Unknown Station")

    @pytest.mark.asyncio
    async def test_get_station_info_deprecation_warning(
        self, client, mock_station_response
    ):
        """Test that get_station_info emits deprecation warning."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_station_response

            import warnings

            with warnings.catch_warnings(record=True) as w:
                warnings.simplefilter("always")
                await client.get_station_info("Tokyo")

                assert len(w) == 1
                assert issubclass(w[0].category, DeprecationWarning)
                assert "non-official /station endpoint" in str(w[0].message)

    # -- Caching tests --

    @pytest.mark.asyncio
    async def test_caching_behavior(self, mock_points_response):
        """Test that responses are properly cached."""
        async with AnitabiClient(
            api_key="test_key",
            use_cache=True,
            rate_limit_calls=10,
            rate_limit_period=1.0,
        ) as client:
            with patch.object(
                client, "_make_request", new_callable=AsyncMock
            ) as mock_request:
                mock_request.return_value = mock_points_response

                # First call - should hit _make_request
                results1 = await client.get_bangumi_points("bangumi_1")

                # Second call - should be cached (same params)
                results2 = await client.get_bangumi_points("bangumi_1")

                # API should only be called once due to caching
                assert mock_request.call_count == 1
                assert results1 == results2

    # -- Context manager tests --

    @pytest.mark.asyncio
    async def test_context_manager(self, client):
        """Test client works as async context manager."""
        async with client as c:
            assert c is client

        # Session should be closed after exiting
        with patch.object(client, "close", new_callable=AsyncMock) as mock_close:
            async with client:
                pass
            mock_close.assert_called_once()


class TestDetectSchema:
    """Tests for _detect_schema — normalizes response shape to a raw list."""

    def test_returns_list_when_response_is_bare_list(self):
        data: object = [{"id": "1"}, {"id": "2"}]
        assert _detect_schema(data) == [{"id": "1"}, {"id": "2"}]

    def test_returns_data_list_when_response_has_data_key(self):
        data: object = {"data": [{"id": "1"}], "total": 1}
        assert _detect_schema(data) == [{"id": "1"}]

    def test_returns_points_list_when_response_has_points_key(self):
        data: object = {"points": [{"id": "1"}]}
        assert _detect_schema(data) == [{"id": "1"}]

    def test_returns_none_when_response_is_empty(self):
        assert _detect_schema(None) is None

    def test_returns_none_when_response_is_empty_list(self):
        assert _detect_schema([]) is None

    def test_raises_when_dict_has_no_known_list_key(self):
        with pytest.raises(APIError, match="Unexpected Anitabi response structure"):
            _detect_schema({"unknown": "value"})

    def test_raises_when_response_type_is_invalid(self):
        with pytest.raises(APIError, match="Invalid Anitabi response type"):
            _detect_schema("not_a_list_or_dict")


class TestParseLegacyPoint:
    """Tests for _parse_legacy_point — parses items with lat/lng fields."""

    def test_parses_all_fields(self):
        item: dict[str, object] = {
            "id": "p1",
            "name": "豊郷小学校旧校舎",
            "cn_name": "丰乡小学校旧校舍",
            "lat": 35.179798,
            "lng": 136.232495,
            "bangumi_id": "b1",
            "bangumi_title": "けいおん！",
            "episode": 1,
            "time_seconds": 125,
            "screenshot": "https://example.com/shot1.jpg",
            "address": "滋賀県",
            "opening_hours": "9:00-17:00",
            "admission_fee": "無料",
        }
        point = _parse_legacy_point(item, "b1")
        assert point.id == "p1"
        assert point.name == "豊郷小学校旧校舎"
        assert point.cn_name == "丰乡小学校旧校舍"
        assert point.coordinates.latitude == 35.179798
        assert point.coordinates.longitude == 136.232495
        assert point.bangumi_id == "b1"
        assert point.episode == 1
        assert point.time_seconds == 125
        assert point.screenshot_url == "https://example.com/shot1.jpg"

    def test_falls_back_to_bangumi_id_arg_when_item_missing_bangumi_id(self):
        item: dict[str, object] = {
            "id": "p1",
            "name": "Loc",
            "lat": 35.0,
            "lng": 136.0,
            "screenshot": "https://example.com/s.jpg",
        }
        point = _parse_legacy_point(item, "fallback_id")
        assert point.bangumi_id == "fallback_id"
        assert point.bangumi_title == "fallback_id"

    def test_falls_back_to_name_when_cn_name_missing(self):
        item: dict[str, object] = {
            "id": "p1",
            "name": "Place",
            "lat": 35.0,
            "lng": 136.0,
            "screenshot": "https://example.com/s.jpg",
        }
        point = _parse_legacy_point(item, "b1")
        assert point.cn_name == "Place"


class TestParseOfficialPoint:
    """Tests for _parse_official_point — parses items with geo array."""

    def test_parses_all_fields(self):
        item: dict[str, object] = {
            "id": "p1",
            "name": "Test Location",
            "cn": "测试地点",
            "geo": [35.6812, 139.7671],
            "ep": 1,
            "s": 120,
            "image": "https://example.com/shot.jpg",
            "origin": "Google Maps",
            "originURL": "https://maps.google.com/test",
        }
        point = _parse_official_point(item, "b1")
        assert point.id == "p1"
        assert point.cn_name == "测试地点"
        assert point.coordinates.latitude == 35.6812
        assert point.coordinates.longitude == 139.7671
        assert point.episode == 1
        assert point.time_seconds == 120
        assert point.screenshot_url == "https://example.com/shot.jpg"
        assert point.origin == "Google Maps"
        assert point.origin_url == "https://maps.google.com/test"

    def test_prefixes_relative_image_url(self):
        item: dict[str, object] = {
            "id": "p1",
            "name": "Loc",
            "geo": [35.0, 136.0],
            "image": "/images/shot.jpg",
        }
        point = _parse_official_point(item, "b1")
        assert point.screenshot_url == "https://image.anitabi.cn/images/shot.jpg"

    def test_raises_on_missing_geo(self):
        item: dict[str, object] = {"id": "p1", "name": "Loc"}
        with pytest.raises(ValueError, match="Missing or invalid 'geo' field"):
            _parse_official_point(item, "b1")

    def test_raises_on_geo_too_short(self):
        item: dict[str, object] = {"id": "p1", "name": "Loc", "geo": [35.0]}
        with pytest.raises(ValueError, match="Missing or invalid 'geo' field"):
            _parse_official_point(item, "b1")
