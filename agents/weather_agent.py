"""
WeatherAgent - Queries weather conditions for locations.
Uses WeatherClient to get current weather and forecasts for coordinates.
"""

from typing import Dict, Any, Optional

from agents.base import AbstractBaseAgent, AgentInput, AgentOutput
from clients.weather import WeatherClient
from domain.entities import Coordinates, APIError
from utils.logger import get_logger


class WeatherAgent(AbstractBaseAgent):
    """
    Agent responsible for querying weather information.

    This agent:
    - Accepts coordinates and query type as input
    - Queries weather API for current conditions or forecasts
    - Returns structured weather data
    - Handles API errors gracefully
    """

    def __init__(self, weather_client: Optional[WeatherClient] = None):
        """
        Initialize the WeatherAgent.

        Args:
            weather_client: Optional WeatherClient instance. If not provided,
                          a new instance will be created.
        """
        super().__init__(
            name="weather_agent",
            description="Queries weather conditions for locations"
        )
        self.weather_client = weather_client or WeatherClient()
        self.logger = get_logger(__name__)

    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Execute the weather query logic.

        Args:
            input_data: AgentInput containing:
                - coordinates: Coordinates dictionary with latitude and longitude
                - query_type: Optional "current" or "forecast" (default: "current")
                - days: Optional number of forecast days (default: 5, max: 10)
                - location_name: Optional location name for context

        Returns:
            Dictionary containing:
                - weather_data: Weather information from API
                - query_type: The type of query performed
                - location: Coordinates used
                - location_name: Name if provided
                - days_requested: For forecasts, number of days
        """
        # Extract input data
        coordinates_data = input_data.data.get("coordinates", {})
        query_type = input_data.data.get("query_type", "current")
        days = input_data.data.get("days", 5)
        location_name = input_data.data.get("location_name", None)

        # Convert coordinates dict back to Coordinates object
        coordinates = Coordinates(**coordinates_data)

        self.logger.info(
            "Querying weather",
            query_type=query_type,
            latitude=coordinates.latitude,
            longitude=coordinates.longitude,
            location_name=location_name,
            session_id=input_data.session_id
        )

        try:
            if query_type == "current":
                # Get current weather
                weather_data = await self.weather_client.get_current_weather(
                    coordinates=coordinates
                )

                result = {
                    "weather_data": weather_data,
                    "query_type": "current",
                    "location": coordinates.model_dump()
                }

            elif query_type == "forecast":
                # Get forecast
                weather_data = await self.weather_client.get_forecast(
                    coordinates=coordinates,
                    days=days
                )

                result = {
                    "weather_data": weather_data,
                    "query_type": "forecast",
                    "location": coordinates.model_dump(),
                    "days_requested": days
                }

            else:
                # This should be caught by validation, but handle it anyway
                raise ValueError(f"Invalid query_type: {query_type}")

            # Add location name if provided
            if location_name:
                result["location_name"] = location_name

            self.logger.info(
                "Weather query completed",
                query_type=query_type,
                location_name=location_name,
                session_id=input_data.session_id
            )

            return result

        except APIError as e:
            # API errors should be propagated
            self.logger.error(
                "API error during weather query",
                query_type=query_type,
                coordinates=coordinates.model_dump(),
                session_id=input_data.session_id,
                error=str(e)
            )
            raise

        except Exception as e:
            # Unexpected errors
            self.logger.error(
                "Unexpected error during weather query",
                query_type=query_type,
                coordinates=coordinates.model_dump(),
                session_id=input_data.session_id,
                error=str(e),
                exc_info=True
            )
            raise

    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate the input data for WeatherAgent.

        Args:
            input_data: AgentInput to validate

        Returns:
            True if input is valid, False otherwise
        """
        # Check if data dict exists
        if not input_data.data:
            self.logger.error("No data provided in input")
            return False

        # Check if coordinates are provided
        if "coordinates" not in input_data.data:
            self.logger.error("No coordinates provided in input")
            return False

        coordinates_data = input_data.data.get("coordinates")

        # Validate coordinates is a dictionary
        if not isinstance(coordinates_data, dict):
            self.logger.error(
                "Coordinates must be a dictionary",
                provided_type=type(coordinates_data).__name__
            )
            return False

        # Validate coordinates have required fields
        if "latitude" not in coordinates_data or "longitude" not in coordinates_data:
            self.logger.error("Coordinates must have latitude and longitude")
            return False

        # Validate query_type if provided
        if "query_type" in input_data.data:
            query_type = input_data.data["query_type"]
            if query_type not in ["current", "forecast"]:
                self.logger.error(
                    "Invalid query_type",
                    query_type=query_type
                )
                return False

        # Validate days if provided for forecast
        if "days" in input_data.data:
            days = input_data.data["days"]
            if not isinstance(days, int) or days < 1 or days > 10:
                self.logger.error(
                    "Invalid days parameter (must be 1-10)",
                    days=days
                )
                return False

        # Try to create Coordinates object to validate data
        try:
            Coordinates(**coordinates_data)
        except Exception as e:
            self.logger.error(
                "Invalid coordinates data",
                error=str(e)
            )
            return False

        return True