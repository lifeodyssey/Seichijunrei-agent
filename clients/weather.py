"""
Weather API client using OpenWeatherMap.

Provides methods to:
- Get current weather conditions
- Get weather forecast
- Get weather for specific dates
- Generate weather recommendations
"""

from datetime import datetime, timedelta
from typing import List, Optional

from config.settings import get_settings
from clients.base import BaseHTTPClient
from domain.entities import APIError, Coordinates, Weather
from utils.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class WeatherClient(BaseHTTPClient):
    """
    Client for OpenWeatherMap API.

    Provides weather information for pilgrimage planning.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        use_cache: bool = True,
        rate_limit_calls: int = 60,
        rate_limit_period: float = 60.0
    ):
        """
        Initialize Weather API client.

        Args:
            api_key: OpenWeatherMap API key
            use_cache: Whether to cache weather data
            rate_limit_calls: Number of calls allowed per period
            rate_limit_period: Rate limit period in seconds
        """
        super().__init__(
            base_url=settings.weather_api_url,
            api_key=api_key or settings.weather_api_key,
            timeout=10,
            max_retries=3,
            rate_limit_calls=rate_limit_calls,
            rate_limit_period=rate_limit_period,
            use_cache=use_cache,
            cache_ttl_seconds=600  # Cache for 10 minutes
        )

        if not self.api_key:
            logger.warning("No Weather API key provided - using limited mode")

        logger.info(
            "Weather client initialized",
            base_url=self.base_url,
            cache_enabled=use_cache,
            rate_limit=f"{rate_limit_calls}/{rate_limit_period}s"
        )

    async def get_current_weather(
        self,
        coordinates: Coordinates,
        units: str = "metric"
    ) -> Weather:
        """
        Get current weather for coordinates.

        Args:
            coordinates: Location coordinates
            units: Temperature units (metric, imperial)

        Returns:
            Current Weather information

        Raises:
            APIError: On API failure
        """
        try:
            logger.info(
                "Getting current weather",
                coordinates=coordinates.to_string()
            )

            # Make API request
            response = await self.get(
                "/weather",
                params={
                    "lat": coordinates.latitude,
                    "lon": coordinates.longitude,
                    "appid": self.api_key,
                    "units": units
                }
            )

            # Check for error response
            if response.get("cod") and str(response["cod"]) != "200":
                error_msg = response.get("message", "Unknown error")
                raise APIError(f"Weather API error {response['cod']}: {error_msg}")

            # Parse response
            weather = self._parse_current_weather(response, units)

            logger.info(
                "Current weather retrieved",
                location=weather.location,
                condition=weather.condition,
                temp_range=weather.temperature_range
            )

            return weather

        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get current weather",
                error=str(e),
                exc_info=True
            )
            raise APIError(f"Failed to get weather: {str(e)}") from e

    async def get_forecast(
        self,
        coordinates: Coordinates,
        days: int = 5
    ) -> List[Weather]:
        """
        Get weather forecast for the next few days.

        Args:
            coordinates: Location coordinates
            days: Number of days to forecast (max 5)

        Returns:
            List of Weather forecasts

        Raises:
            APIError: On API failure
        """
        try:
            logger.info(
                "Getting weather forecast",
                coordinates=coordinates.to_string(),
                days=days
            )

            # Calculate number of data points (8 per day for 3-hour intervals)
            count = min(days * 8, 40)  # Max 40 from API

            # Make API request
            response = await self.get(
                "/forecast",
                params={
                    "lat": coordinates.latitude,
                    "lon": coordinates.longitude,
                    "appid": self.api_key,
                    "units": "metric",
                    "cnt": count
                }
            )

            # Check for errors
            if response.get("cod") and str(response["cod"]) != "200":
                error_msg = response.get("message", "Unknown error")
                raise APIError(f"Forecast API error: {error_msg}")

            # Parse daily forecasts
            forecasts = self._parse_forecast(response, days)

            logger.info(
                "Forecast retrieved",
                location=response.get("city", {}).get("name"),
                days=len(forecasts)
            )

            return forecasts

        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get forecast",
                error=str(e),
                exc_info=True
            )
            raise APIError(f"Failed to get forecast: {str(e)}") from e

    async def get_weather_for_date(
        self,
        coordinates: Coordinates,
        date: str
    ) -> Weather:
        """
        Get weather for a specific date.

        Args:
            coordinates: Location coordinates
            date: Target date (YYYY-MM-DD format)

        Returns:
            Weather for the specified date

        Raises:
            APIError: If date not in forecast range
        """
        try:
            logger.info(
                "Getting weather for date",
                coordinates=coordinates.to_string(),
                date=date
            )

            # Parse target date
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
            today = datetime.now().date()

            # Check if date is in forecast range (max 5 days)
            days_ahead = (target_date - today).days
            if days_ahead < 0:
                raise APIError("Cannot get weather for past dates")
            if days_ahead > 5:
                raise APIError("Weather forecast not available beyond 5 days")

            # Get forecast
            forecasts = await self.get_forecast(coordinates, days_ahead + 1)

            # Find matching date
            for weather in forecasts:
                if weather.date == date:
                    return weather

            raise APIError(f"Weather not available for date: {date}")

        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get weather for date",
                date=date,
                error=str(e),
                exc_info=True
            )
            raise APIError(f"Failed to get weather: {str(e)}") from e

    def _parse_current_weather(self, data: dict, units: str = "metric") -> Weather:
        """
        Parse current weather response.

        Args:
            data: API response data
            units: Temperature units used

        Returns:
            Weather entity
        """
        # Convert temperatures if needed
        temp_high = data["main"]["temp_max"]
        temp_low = data["main"]["temp_min"]

        if units == "imperial":
            # Convert Fahrenheit to Celsius
            temp_high = (temp_high - 32) * 5/9
            temp_low = (temp_low - 32) * 5/9

        # Generate recommendation
        recommendation = self._generate_recommendation(
            condition=data["weather"][0]["main"],
            temp_high=temp_high,
            temp_low=temp_low,
            humidity=data["main"].get("humidity", 50)
        )

        return Weather(
            date=datetime.now().strftime("%Y-%m-%d"),
            location=data.get("name", "Unknown"),
            condition=data["weather"][0]["main"],
            temperature_high=round(temp_high),
            temperature_low=round(temp_low),
            precipitation_chance=0,  # Not available in current weather
            wind_speed_kmh=round(data["wind"]["speed"] * 3.6),  # m/s to km/h
            recommendation=recommendation
        )

    def _parse_forecast(self, data: dict, days: int) -> List[Weather]:
        """
        Parse forecast response into daily summaries.

        Args:
            data: API response data
            days: Number of days to parse

        Returns:
            List of daily Weather forecasts
        """
        city_name = data.get("city", {}).get("name", "Unknown")
        daily_data = {}

        # Group forecast data by date
        for item in data.get("list", []):
            date = item["dt_txt"].split()[0]

            if date not in daily_data:
                daily_data[date] = {
                    "temps": [],
                    "conditions": [],
                    "precipitation": [],
                    "wind_speeds": [],
                    "humidity": []
                }

            daily_data[date]["temps"].append(item["main"]["temp"])
            daily_data[date]["conditions"].append(item["weather"][0]["main"])
            daily_data[date]["precipitation"].append(item.get("pop", 0) * 100)
            daily_data[date]["wind_speeds"].append(item["wind"]["speed"])
            daily_data[date]["humidity"].append(item["main"]["humidity"])

        # Create Weather objects for each day
        forecasts = []
        for date in sorted(daily_data.keys())[:days]:
            data = daily_data[date]

            # Calculate daily values
            temp_high = round(max(data["temps"]))
            temp_low = round(min(data["temps"]))
            precipitation = round(max(data["precipitation"]))
            wind_speed = round(sum(data["wind_speeds"]) / len(data["wind_speeds"]) * 3.6)
            humidity = round(sum(data["humidity"]) / len(data["humidity"]))

            # Most common condition
            conditions = data["conditions"]
            condition = max(set(conditions), key=conditions.count)

            # Generate recommendation
            recommendation = self._generate_recommendation(
                condition=condition,
                temp_high=temp_high,
                temp_low=temp_low,
                humidity=humidity
            )

            weather = Weather(
                date=date,
                location=city_name,
                condition=condition,
                temperature_high=temp_high,
                temperature_low=temp_low,
                precipitation_chance=precipitation,
                wind_speed_kmh=wind_speed,
                recommendation=recommendation
            )

            forecasts.append(weather)

        return forecasts

    def _generate_recommendation(
        self,
        condition: str,
        temp_high: float,
        temp_low: float,
        humidity: int
    ) -> str:
        """
        Generate weather-based recommendations.

        Args:
            condition: Weather condition
            temp_high: High temperature
            temp_low: Low temperature
            humidity: Humidity percentage

        Returns:
            Recommendation string
        """
        recommendations = []

        # Temperature recommendations
        if temp_high > 30:
            recommendations.append("Very hot day - stay hydrated and seek shade")
        elif temp_high > 25:
            recommendations.append("Warm weather - bring water and sunscreen")
        elif temp_low < 10:
            recommendations.append("Cool weather - bring a jacket")
        elif temp_low < 5:
            recommendations.append("Cold weather - dress warmly")

        # Condition recommendations
        if "rain" in condition.lower():
            recommendations.append("Bring an umbrella")
        elif "snow" in condition.lower():
            recommendations.append("Wear appropriate footwear for snow")
        elif "clear" in condition.lower() and temp_high > 20:
            recommendations.append("Sunny day - wear sunglasses")

        # Humidity recommendations
        if humidity > 80 and temp_high > 25:
            recommendations.append("High humidity - pace yourself")

        # Default if no specific recommendations
        if not recommendations:
            recommendations.append("Good weather for pilgrimage")

        return "; ".join(recommendations)