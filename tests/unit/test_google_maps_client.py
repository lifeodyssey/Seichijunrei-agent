"""
Unit tests for Google Maps API client.

Tests cover:
- Directions queries for different transport modes
- Multi-waypoint route optimization
- Geocoding and reverse geocoding
- Place details retrieval
- Error handling for API quota limits
- Caching behavior for geocoding
"""

from unittest.mock import AsyncMock, patch

import pytest

from clients.google_maps import GoogleMapsClient
from domain.entities import (
    APIError, Coordinates, Point, Route, RouteSegment,
    Station, TransportInfo
)


class TestGoogleMapsClient:
    """Test the Google Maps API client."""

    @pytest.fixture
    async def client(self):
        """Create a Google Maps client instance."""
        return GoogleMapsClient(
            api_key="test_api_key",
            use_cache=True,
            rate_limit_calls=50,
            rate_limit_period=1.0
        )

    @pytest.fixture
    def mock_directions_response(self):
        """Mock response for directions API."""
        return {
            "routes": [
                {
                    "legs": [
                        {
                            "distance": {"value": 5280, "text": "5.3 km"},
                            "duration": {"value": 1200, "text": "20 mins"},
                            "steps": [
                                {
                                    "html_instructions": "Walk to Kyoto Station",
                                    "distance": {"value": 500},
                                    "duration": {"value": 300}
                                }
                            ]
                        }
                    ],
                    "overview_polyline": {"points": "encoded_polyline_here"}
                }
            ],
            "status": "OK"
        }

    @pytest.fixture
    def mock_multi_waypoint_response(self):
        """Mock response for multi-waypoint directions."""
        return {
            "routes": [
                {
                    "legs": [
                        {
                            "distance": {"value": 2000, "text": "2.0 km"},
                            "duration": {"value": 600, "text": "10 mins"},
                            "start_location": {"lat": 35.0, "lng": 135.0},
                            "end_location": {"lat": 35.01, "lng": 135.01}
                        },
                        {
                            "distance": {"value": 3000, "text": "3.0 km"},
                            "duration": {"value": 900, "text": "15 mins"},
                            "start_location": {"lat": 35.01, "lng": 135.01},
                            "end_location": {"lat": 35.02, "lng": 135.02}
                        }
                    ],
                    "waypoint_order": [0, 1],
                    "overview_polyline": {"points": "encoded_polyline"}
                }
            ],
            "status": "OK"
        }

    @pytest.fixture
    def mock_geocode_response(self):
        """Mock response for geocoding API."""
        return {
            "results": [
                {
                    "formatted_address": "Kyoto Station, Kyoto, Japan",
                    "geometry": {
                        "location": {
                            "lat": 34.985849,
                            "lng": 135.758767
                        }
                    },
                    "place_id": "ChIJCfBrxAbGAWARkj1JynIJw5k"
                }
            ],
            "status": "OK"
        }

    @pytest.fixture
    def mock_place_details_response(self):
        """Mock response for place details API."""
        return {
            "result": {
                "name": "Toyosato Elementary School",
                "formatted_address": "滋賀県犬上郡豊郷町",
                "opening_hours": {
                    "open_now": True,
                    "weekday_text": [
                        "Monday: 9:00 AM – 5:00 PM",
                        "Tuesday: 9:00 AM – 5:00 PM",
                        "Wednesday: 9:00 AM – 5:00 PM",
                        "Thursday: 9:00 AM – 5:00 PM",
                        "Friday: 9:00 AM – 5:00 PM",
                        "Saturday: 9:00 AM – 5:00 PM",
                        "Sunday: 9:00 AM – 5:00 PM"
                    ]
                },
                "website": "http://example.com",
                "formatted_phone_number": "+81-123-456-7890"
            },
            "status": "OK"
        }

    @pytest.mark.asyncio
    async def test_get_directions_walking(self, client, mock_directions_response):
        """Test getting walking directions between two points."""
        origin = Coordinates(latitude=35.0, longitude=135.0)
        destination = Coordinates(latitude=35.01, longitude=135.01)

        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_directions_response

            transport = await client.get_directions(
                origin=origin,
                destination=destination,
                mode="walking"
            )

            # Verify API call
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert call_args[1]['params']['origin'] == "35.0,135.0"
            assert call_args[1]['params']['destination'] == "35.01,135.01"
            assert call_args[1]['params']['mode'] == "walking"

            # Verify result
            assert isinstance(transport, TransportInfo)
            assert transport.mode == "walking"
            assert transport.distance_meters == 5280
            assert transport.duration_minutes == 20

    @pytest.mark.asyncio
    async def test_get_directions_transit(self, client, mock_directions_response):
        """Test getting transit directions."""
        origin = Coordinates(latitude=35.0, longitude=135.0)
        destination = Coordinates(latitude=35.01, longitude=135.01)

        # Modify response for transit
        transit_response = mock_directions_response.copy()
        transit_response["routes"][0]["legs"][0]["steps"] = [
            {
                "travel_mode": "TRANSIT",
                "transit_details": {
                    "line": {
                        "name": "JR Tokaido Line",
                        "short_name": "JR"
                    },
                    "departure_stop": {"name": "Kyoto Station"},
                    "arrival_stop": {"name": "Osaka Station"}
                }
            }
        ]

        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = transit_response

            transport = await client.get_directions(
                origin=origin,
                destination=destination,
                mode="transit"
            )

            assert transport.mode == "transit"
            assert transport.transit_details is not None

    @pytest.mark.asyncio
    async def test_get_multi_waypoint_route(self, client, mock_multi_waypoint_response):
        """Test getting optimized route through multiple waypoints."""
        station = Station(
            name="Kyoto Station",
            coordinates=Coordinates(latitude=35.0, longitude=135.0)
        )

        points = [
            Point(
                id="p1",
                name="Point 1",
                cn_name="地点1",
                coordinates=Coordinates(latitude=35.01, longitude=135.01),
                bangumi_id="b1",
                bangumi_title="Anime 1",
                episode=1,
                time_seconds=100,
                screenshot_url="https://example.com/shot1.jpg"
            ),
            Point(
                id="p2",
                name="Point 2",
                cn_name="地点2",
                coordinates=Coordinates(latitude=35.02, longitude=135.02),
                bangumi_id="b1",
                bangumi_title="Anime 1",
                episode=2,
                time_seconds=200,
                screenshot_url="https://example.com/shot2.jpg"
            )
        ]

        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_multi_waypoint_response

            route = await client.get_multi_waypoint_route(station, points)

            # Verify API call included waypoints
            call_args = mock_get.call_args
            assert "waypoints" in call_args[1]['params']
            assert "optimize:true" in call_args[1]['params']['waypoints']

            # Verify route structure
            assert isinstance(route, Route)
            assert route.origin == station
            assert len(route.segments) == 2
            assert route.total_distance_km == 5.0
            assert route.total_duration_minutes == 25

    @pytest.mark.asyncio
    async def test_geocode_address(self, client, mock_geocode_response):
        """Test geocoding an address to coordinates."""
        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_geocode_response

            coords = await client.geocode_address("Kyoto Station, Japan")

            # Verify API call
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert call_args[1]['params']['address'] == "Kyoto Station, Japan"

            # Verify result
            assert isinstance(coords, Coordinates)
            assert coords.latitude == 34.985849
            assert coords.longitude == 135.758767

    @pytest.mark.asyncio
    async def test_geocode_not_found(self, client):
        """Test geocoding with no results."""
        empty_response = {"results": [], "status": "ZERO_RESULTS"}

        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = empty_response

            with pytest.raises(APIError, match="No results found"):
                await client.geocode_address("Nonexistent Place XYZ123")

    @pytest.mark.asyncio
    async def test_get_place_details(self, client, mock_place_details_response):
        """Test retrieving place details."""
        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_place_details_response

            details = await client.get_place_details("ChIJCfBrxAbGAWARkj1JynIJw5k")

            # Verify API call
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert call_args[1]['params']['place_id'] == "ChIJCfBrxAbGAWARkj1JynIJw5k"

            # Verify result
            assert details["name"] == "Toyosato Elementary School"
            assert details["opening_hours"]["open_now"] is True
            assert len(details["opening_hours"]["weekday_text"]) == 7

    @pytest.mark.asyncio
    async def test_api_quota_exceeded_error(self, client):
        """Test handling of API quota exceeded errors."""
        quota_response = {
            "error_message": "You have exceeded your daily request quota",
            "status": "OVER_QUERY_LIMIT"
        }

        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = quota_response

            origin = Coordinates(latitude=35.0, longitude=135.0)
            destination = Coordinates(latitude=35.01, longitude=135.01)

            with pytest.raises(APIError, match="quota"):
                await client.get_directions(origin, destination, "walking")

    @pytest.mark.asyncio
    async def test_invalid_api_key_error(self, client):
        """Test handling of invalid API key errors."""
        auth_response = {
            "error_message": "The provided API key is invalid",
            "status": "REQUEST_DENIED"
        }

        with patch.object(client, 'get', new_callable=AsyncMock) as mock_get:
            mock_get.return_value = auth_response

            with pytest.raises(APIError, match="API key"):
                await client.geocode_address("Test Address")

    @pytest.mark.asyncio
    async def test_caching_geocode_requests(self, client, mock_geocode_response):
        """Test that geocode requests are cached."""
        with patch.object(client, '_make_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_geocode_response

            # First request
            coords1 = await client.geocode_address("Kyoto Station")

            # Second identical request (should be cached)
            coords2 = await client.geocode_address("Kyoto Station")

            # Should only make one actual request
            assert mock_request.call_count == 1
            assert coords1 == coords2

    @pytest.mark.asyncio
    async def test_no_caching_for_directions(self, client, mock_directions_response):
        """Test that directions are not cached (as they can change)."""
        origin = Coordinates(latitude=35.0, longitude=135.0)
        destination = Coordinates(latitude=35.01, longitude=135.01)

        with patch.object(client, '_make_request', new_callable=AsyncMock) as mock_request:
            mock_request.return_value = mock_directions_response

            # Make two identical requests
            await client.get_directions(origin, destination, "walking", skip_cache=True)
            await client.get_directions(origin, destination, "walking", skip_cache=True)

            # Should make two requests (no caching for directions)
            assert mock_request.call_count == 2

    @pytest.mark.asyncio
    async def test_empty_waypoints_handling(self, client):
        """Test handling of empty waypoints list."""
        station = Station(
            name="Test Station",
            coordinates=Coordinates(latitude=35.0, longitude=135.0)
        )

        with pytest.raises(ValueError, match="At least one waypoint required"):
            await client.get_multi_waypoint_route(station, [])

    @pytest.mark.asyncio
    async def test_too_many_waypoints(self, client):
        """Test handling of too many waypoints (Google Maps limit is 25)."""
        station = Station(
            name="Test Station",
            coordinates=Coordinates(latitude=35.0, longitude=135.0)
        )

        # Create 30 points (exceeds Google's limit of 25 waypoints)
        points = [
            Point(
                id=f"p{i}",
                name=f"Point {i}",
                cn_name=f"地点{i}",
                coordinates=Coordinates(latitude=35.0 + i*0.001, longitude=135.0 + i*0.001),
                bangumi_id="b1",
                bangumi_title="Anime",
                episode=i,
                time_seconds=i*100,
                screenshot_url=f"https://example.com/shot{i}.jpg"
            )
            for i in range(30)
        ]

        with pytest.raises(ValueError, match="Maximum 25 waypoints"):
            await client.get_multi_waypoint_route(station, points)