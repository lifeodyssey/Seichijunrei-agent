"""
Unit tests for Weather API client.

Tests cover:
- Current weather retrieval
- Weather forecast parsing
- Date-specific weather queries
- Temperature unit conversion
- Error handling for API limits
- Caching behavior
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from clients.weather import WeatherClient
from domain.entities import APIError, Coordinates, Weather


class TestWeatherClient:
    """Test the Weather API client."""

    @pytest.fixture
    async def client(self):
        """Create a Weather client instance."""
        return WeatherClient(
            api_key="test_api_key",
            use_cache=True,
            rate_limit_calls=60,
            rate_limit_period=60.0,
        )

    @pytest.fixture
    def mock_current_weather_response(self):
        """Mock response for current weather API."""
        return {
            "coord": {"lon": 139.69, "lat": 35.69},
            "weather": [
                {"id": 800, "main": "Clear", "description": "clear sky", "icon": "01d"}
            ],
            "main": {
                "temp": 20.5,
                "feels_like": 19.8,
                "temp_min": 18.0,
                "temp_max": 23.0,
                "pressure": 1013,
                "humidity": 60,
            },
            "wind": {"speed": 3.5, "deg": 180},
            "clouds": {"all": 0},
            "dt": 1700000000,
            "sys": {"country": "JP", "sunrise": 1699990000, "sunset": 1700030000},
            "name": "Tokyo",
        }

    @pytest.fixture
    def mock_forecast_response(self):
        """Mock response for weather forecast API."""
        today = datetime.now().date()

        return {
            "city": {
                "name": "Tokyo",
                "coord": {"lat": 35.69, "lon": 139.69},
                "country": "JP",
            },
            "list": [
                {
                    "dt": 1700000000,
                    "main": {
                        "temp": 20.0,
                        "temp_min": 18.0,
                        "temp_max": 22.0,
                        "humidity": 65,
                    },
                    "weather": [{"main": "Clear", "description": "clear sky"}],
                    "wind": {"speed": 3.0},
                    "pop": 0.1,
                    "dt_txt": f"{today} 12:00:00",
                },
                {
                    "dt": 1700086400,
                    "main": {
                        "temp": 18.0,
                        "temp_min": 16.0,
                        "temp_max": 20.0,
                        "humidity": 70,
                    },
                    "weather": [{"main": "Clouds", "description": "few clouds"}],
                    "wind": {"speed": 2.5},
                    "pop": 0.2,
                    "dt_txt": f"{today + timedelta(days=1)} 12:00:00",
                },
                {
                    "dt": 1700172800,
                    "main": {
                        "temp": 17.0,
                        "temp_min": 15.0,
                        "temp_max": 19.0,
                        "humidity": 75,
                    },
                    "weather": [{"main": "Rain", "description": "light rain"}],
                    "wind": {"speed": 4.0},
                    "pop": 0.8,
                    "dt_txt": f"{today + timedelta(days=2)} 12:00:00",
                },
            ],
        }

    @pytest.mark.asyncio
    async def test_get_current_weather(self, client, mock_current_weather_response):
        """Test retrieving current weather."""
        coords = Coordinates(latitude=35.69, longitude=139.69)

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_current_weather_response

            weather = await client.get_current_weather(coords)

            # Verify API call
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert call_args[1]["params"]["lat"] == 35.69
            assert call_args[1]["params"]["lon"] == 139.69
            assert call_args[1]["params"]["units"] == "metric"

            # Verify result
            assert isinstance(weather, Weather)
            assert weather.location == "Tokyo"
            assert weather.condition == "Clear"
            assert weather.temperature_high == 23
            assert weather.temperature_low == 18
            assert weather.wind_speed_kmh == pytest.approx(12.6, rel=0.1)

    @pytest.mark.asyncio
    async def test_get_forecast(self, client, mock_forecast_response):
        """Test retrieving weather forecast."""
        coords = Coordinates(latitude=35.69, longitude=139.69)

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_forecast_response

            forecast = await client.get_forecast(coords, days=3)

            # Verify API call
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert "/forecast" in call_args[0][0]
            assert call_args[1]["params"]["cnt"] == 24  # 3 days * 8 (3-hour intervals)

            # Verify results
            assert len(forecast) == 3
            assert all(isinstance(w, Weather) for w in forecast)
            assert forecast[0].condition == "Clear"
            assert forecast[1].condition == "Clouds"
            assert forecast[2].condition == "Rain"
            assert forecast[2].precipitation_chance == 80

    @pytest.mark.asyncio
    async def test_get_weather_for_date(self, client, mock_forecast_response):
        """Test retrieving weather for a specific date."""
        coords = Coordinates(latitude=35.69, longitude=139.69)

        # Use a date 2 days from now
        future_date = datetime.now().date() + timedelta(days=2)
        target_date = future_date.strftime("%Y-%m-%d")

        # Update mock response to use future dates
        mock_forecast_response["list"][2]["dt_txt"] = f"{target_date} 12:00:00"

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_forecast_response

            weather = await client.get_weather_for_date(coords, target_date)

            # Should return the weather for the requested date
            assert isinstance(weather, Weather)
            assert weather.date == target_date
            assert weather.condition == "Rain"
            assert weather.precipitation_chance == 80

    @pytest.mark.asyncio
    async def test_date_not_in_forecast(self, client, mock_forecast_response):
        """Test requesting weather for a date outside forecast range."""
        coords = Coordinates(latitude=35.69, longitude=139.69)

        # Use a date 10 days from now (beyond 5 day forecast)
        far_future = datetime.now().date() + timedelta(days=10)
        future_date = far_future.strftime("%Y-%m-%d")

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_forecast_response

            with pytest.raises(APIError, match="not available"):
                await client.get_weather_for_date(coords, future_date)

    @pytest.mark.asyncio
    async def test_api_error_handling(self, client):
        """Test handling of API errors."""
        coords = Coordinates(latitude=35.69, longitude=139.69)

        error_response = {"cod": "401", "message": "Invalid API key"}

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = error_response

            with pytest.raises(APIError, match="401"):
                await client.get_current_weather(coords)

    @pytest.mark.asyncio
    async def test_temperature_conversion(self, client, mock_current_weather_response):
        """Test temperature unit conversion."""
        coords = Coordinates(latitude=35.69, longitude=139.69)

        # Test imperial units
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            # Modify response to use Fahrenheit
            imperial_response = mock_current_weather_response.copy()
            imperial_response["main"]["temp"] = 68.9  # 20.5°C in Fahrenheit
            imperial_response["main"]["temp_min"] = 64.4  # 18°C
            imperial_response["main"]["temp_max"] = 73.4  # 23°C

            mock_get.return_value = imperial_response

            weather = await client.get_current_weather(coords, units="imperial")

            call_args = mock_get.call_args
            assert call_args[1]["params"]["units"] == "imperial"

            # Should convert back to Celsius for consistency
            assert weather.temperature_high == 23  # Converted from Fahrenheit
            assert weather.temperature_low == 18

    @pytest.mark.asyncio
    async def test_caching_current_weather(self, client, mock_current_weather_response):
        """Test that current weather is cached."""
        coords = Coordinates(latitude=35.69, longitude=139.69)

        with patch.object(
            client, "_make_request", new_callable=AsyncMock
        ) as mock_request:
            mock_request.return_value = mock_current_weather_response

            # First request
            weather1 = await client.get_current_weather(coords)

            # Second identical request (should be cached)
            weather2 = await client.get_current_weather(coords)

            # Should only make one actual request
            assert mock_request.call_count == 1
            assert weather1.location == weather2.location
            assert weather1.temperature_high == weather2.temperature_high

    @pytest.mark.asyncio
    async def test_weather_recommendation_hot(self, client):
        """Test weather recommendations for hot weather."""
        hot_response = {
            "weather": [{"main": "Clear", "description": "clear sky"}],
            "main": {"temp": 35, "temp_min": 30, "temp_max": 38, "humidity": 80},
            "wind": {"speed": 2},
            "name": "Tokyo",
        }

        coords = Coordinates(latitude=35.69, longitude=139.69)

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = hot_response

            weather = await client.get_current_weather(coords)

            assert (
                "hot" in weather.recommendation.lower()
                or "hydrated" in weather.recommendation.lower()
            )

    @pytest.mark.asyncio
    async def test_weather_recommendation_rain(self, client):
        """Test weather recommendations for rainy weather."""
        rain_response = {
            "weather": [{"main": "Rain", "description": "moderate rain"}],
            "main": {"temp": 18, "temp_min": 16, "temp_max": 20, "humidity": 90},
            "wind": {"speed": 5},
            "name": "Tokyo",
        }

        coords = Coordinates(latitude=35.69, longitude=139.69)

        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = rain_response

            weather = await client.get_current_weather(coords)

            assert (
                "rain" in weather.recommendation.lower()
                or "umbrella" in weather.recommendation.lower()
            )

    @pytest.mark.asyncio
    async def test_invalid_coordinates(self, client):
        """Test handling of invalid coordinates."""
        # Test that Pydantic validation prevents invalid coordinates
        from pydantic import ValidationError

        with pytest.raises(ValidationError) as exc_info:
            invalid_coords = Coordinates(latitude=100, longitude=200)

        # Check that appropriate validation errors are raised
        errors = exc_info.value.errors()
        assert any("latitude" in str(e) for e in errors)
        assert any("longitude" in str(e) for e in errors)
