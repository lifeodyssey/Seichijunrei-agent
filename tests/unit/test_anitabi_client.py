"""
Unit tests for Anitabi API client.

Tests cover:
- Bangumi search near stations
- Point retrieval for specific bangumi
- Station information lookup
- Error handling for invalid responses
- Response caching behavior
- Rate limiting
"""

from unittest.mock import AsyncMock, patch

import pytest
from aiohttp import ClientError

from clients.anitabi import AnitabiClient
from clients.errors import APIError
from domain.entities import Bangumi, Coordinates, Point, Station
from domain.errors import InvalidStationError, NoBangumiFoundError


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
    def mock_bangumi_response(self):
        """Mock response for bangumi search."""
        return {
            "data": [
                {
                    "id": "bangumi_1",
                    "title": "けいおん！",
                    "cn_title": "轻音少女",
                    "cover": "https://example.com/cover1.jpg",
                    "points_count": 5,
                    "distance": 2.5,
                    "color": "#FF6B6B",
                },
                {
                    "id": "bangumi_2",
                    "title": "らき☆すた",
                    "cn_title": "幸运星",
                    "cover": "https://example.com/cover2.jpg",
                    "points_count": 3,
                    "distance": 4.8,
                    "color": "#4ECDC4",
                },
            ],
            "total": 2,
        }

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

    @pytest.mark.asyncio
    async def test_search_bangumi_success(self, client, mock_bangumi_response):
        """Test successful bangumi search near a station."""
        station = Station(
            name="東京駅",
            coordinates=Coordinates(latitude=35.681236, longitude=139.767125),
            city="東京都",
            prefecture="東京都",
        )

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_bangumi_response

            results = await client.search_bangumi(station, radius_km=5.0)

            # Verify API call
            mock_get.assert_called_once_with(
                "/near",
                params={
                    "lat": 35.681236,
                    "lng": 139.767125,
                    "radius": 5000,  # Convert km to meters
                },
            )

            # Verify results
            assert len(results) == 2
            assert isinstance(results[0], Bangumi)
            assert results[0].id == "bangumi_1"
            assert results[0].title == "けいおん！"
            assert results[0].points_count == 5
            assert results[0].distance_km == 2.5

    @pytest.mark.asyncio
    async def test_search_bangumi_empty_results(self, client):
        """Test bangumi search with no results."""
        station = Station(
            name="Rural Station",
            coordinates=Coordinates(latitude=35.0, longitude=135.0),
        )

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"data": [], "total": 0}

            with pytest.raises(NoBangumiFoundError, match="No anime locations found"):
                await client.search_bangumi(station, radius_km=1.0)

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

            with pytest.raises(InvalidStationError, match="Station not found"):
                await client.get_station_info("Unknown Station")

    @pytest.mark.asyncio
    async def test_caching_behavior(self, client, mock_bangumi_response):
        """Test that responses are properly cached."""
        station = Station(
            name="Test Station", coordinates=Coordinates(latitude=35.0, longitude=135.0)
        )

        with patch.object(
            client, "_make_request", new_callable=AsyncMock
        ) as mock_request:
            mock_request.return_value = mock_bangumi_response

            # First call
            results1 = await client.search_bangumi(station, radius_km=5.0)

            # Second call (should be cached)
            results2 = await client.search_bangumi(station, radius_km=5.0)

            # API should only be called once due to caching
            assert mock_request.call_count == 1
            assert results1 == results2

    @pytest.mark.asyncio
    async def test_different_radius_not_cached(self, client, mock_bangumi_response):
        """Test that different parameters bypass cache."""
        station = Station(
            name="Test Station", coordinates=Coordinates(latitude=35.0, longitude=135.0)
        )

        with patch.object(
            client, "_make_request", new_callable=AsyncMock
        ) as mock_request:
            mock_request.return_value = mock_bangumi_response

            # Call with radius 5km
            await client.search_bangumi(station, radius_km=5.0)

            # Call with radius 10km (different params)
            await client.search_bangumi(station, radius_km=10.0)

            # Should make two API calls (different parameters)
            assert mock_request.call_count == 2

    @pytest.mark.asyncio
    async def test_malformed_response_handling(self, client):
        """Test handling of malformed API responses."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            # Missing required fields
            mock_get.return_value = {
                "data": [{"id": "test", "title": "Missing fields"}]
            }

            station = Station(
                name="Test", coordinates=Coordinates(latitude=35.0, longitude=135.0)
            )

            with pytest.raises(APIError, match="Invalid response"):
                await client.search_bangumi(station, radius_km=5.0)

    @pytest.mark.asyncio
    async def test_network_error_handling(self, client):
        """Test handling of network errors."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = ClientError("Network error")

            station = Station(
                name="Test", coordinates=Coordinates(latitude=35.0, longitude=135.0)
            )

            with pytest.raises(APIError):
                await client.search_bangumi(station, radius_km=5.0)

    @pytest.mark.asyncio
    async def test_rate_limiting(self, client, mock_bangumi_response):
        """Test that rate limiting is applied."""
        station = Station(
            name="Test", coordinates=Coordinates(latitude=35.0, longitude=135.0)
        )

        with patch.object(
            client, "_make_request", new_callable=AsyncMock
        ) as mock_request:
            mock_request.return_value = mock_bangumi_response

            # Make multiple rapid requests with different params to avoid cache
            import asyncio

            start_time = asyncio.get_event_loop().time()

            tasks = [
                client.search_bangumi(station, radius_km=float(i))
                for i in range(1, 12)  # 11 requests (exceeds rate limit of 10)
            ]

            await asyncio.gather(*tasks)

            elapsed = asyncio.get_event_loop().time() - start_time

            # The 11th request should be delayed (token bucket refills at 10 tokens/second)
            # Expecting at least 0.1 seconds delay for the 11th request
            assert elapsed >= 0.09  # Small buffer for timing precision

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
