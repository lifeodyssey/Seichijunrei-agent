"""
SearchAgent - Searches for anime locations near stations.
Uses AnitabiClient to find bangumi (anime series) near specified railway stations.
"""

from typing import Dict, Any, Optional

from agents.base import AbstractBaseAgent, AgentInput, AgentOutput
from clients.anitabi import AnitabiClient
from domain.entities import Station, NoBangumiFoundError, APIError
from utils.logger import get_logger


class SearchAgent(AbstractBaseAgent):
    """
    Agent responsible for searching anime locations near stations.

    This agent:
    - Accepts a station and search radius as input
    - Queries the Anitabi API for nearby anime locations
    - Returns a list of bangumi sorted by distance
    - Handles API errors gracefully
    """

    def __init__(self, anitabi_client: Optional[AnitabiClient] = None):
        """
        Initialize the SearchAgent.

        Args:
            anitabi_client: Optional AnitabiClient instance. If not provided,
                          a new instance will be created.
        """
        super().__init__(
            name="search_agent",
            description="Searches for anime locations near stations"
        )
        self.anitabi_client = anitabi_client or AnitabiClient()
        self.logger = get_logger(__name__)

    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Execute the search logic.

        Args:
            input_data: AgentInput containing:
                - station: Station dictionary with name, coordinates, etc.
                - radius_km: Optional search radius in kilometers (default 5.0)

        Returns:
            Dictionary containing:
                - bangumi_list: List of found bangumi
                - count: Number of results
                - search_radius_km: The radius used for search
        """
        # Extract and validate input
        station_data = input_data.data.get("station", {})
        radius_km = input_data.data.get("radius_km", 5.0)

        # Convert station dict back to Station object
        station = Station(**station_data)

        self.logger.info(
            "Searching for bangumi",
            station=station.name,
            radius_km=radius_km,
            session_id=input_data.session_id
        )

        try:
            # Query the Anitabi API
            bangumi_list = await self.anitabi_client.search_bangumi(
                station=station,
                radius_km=radius_km
            )

            # Convert bangumi objects to dictionaries
            bangumi_dicts = [bangumi.model_dump() for bangumi in bangumi_list]

            self.logger.info(
                "Search completed",
                station=station.name,
                results_count=len(bangumi_list),
                session_id=input_data.session_id
            )

            return {
                "bangumi_list": bangumi_dicts,
                "count": len(bangumi_list),
                "search_radius_km": radius_km,
                "station_name": station.name
            }

        except NoBangumiFoundError as e:
            # No results is not an error, just return empty list
            self.logger.info(
                "No bangumi found",
                station=station.name,
                radius_km=radius_km,
                session_id=input_data.session_id,
                message=str(e)
            )
            return {
                "bangumi_list": [],
                "count": 0,
                "search_radius_km": radius_km,
                "station_name": station.name
            }

        except APIError as e:
            # API errors should be propagated
            self.logger.error(
                "API error during search",
                station=station.name,
                radius_km=radius_km,
                session_id=input_data.session_id,
                error=str(e)
            )
            raise

        except Exception as e:
            # Unexpected errors
            self.logger.error(
                "Unexpected error during search",
                station=station.name,
                radius_km=radius_km,
                session_id=input_data.session_id,
                error=str(e),
                exc_info=True
            )
            raise

    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate the input data for SearchAgent.

        Args:
            input_data: AgentInput to validate

        Returns:
            True if input is valid, False otherwise
        """
        # Check if data dict exists
        if not input_data.data:
            self.logger.error("No data provided in input")
            return False

        # Check if station is provided
        if "station" not in input_data.data:
            self.logger.error("No station provided in input")
            return False

        station_data = input_data.data.get("station")

        # Validate station is a dictionary
        if not isinstance(station_data, dict):
            self.logger.error(
                "Station must be a dictionary",
                provided_type=type(station_data).__name__
            )
            return False

        # Validate station has required fields
        required_fields = ["name", "coordinates"]
        for field in required_fields:
            if field not in station_data:
                self.logger.error(
                    "Station missing required field",
                    missing_field=field
                )
                return False

        # Validate coordinates structure
        coordinates = station_data.get("coordinates")
        if not isinstance(coordinates, dict):
            self.logger.error("Station coordinates must be a dictionary")
            return False

        if "latitude" not in coordinates or "longitude" not in coordinates:
            self.logger.error("Coordinates must have latitude and longitude")
            return False

        # Validate radius_km if provided
        if "radius_km" in input_data.data:
            radius = input_data.data["radius_km"]
            if not isinstance(radius, (int, float)) or radius <= 0:
                self.logger.error(
                    "Invalid radius_km",
                    radius=radius
                )
                return False

        # Try to create Station object to validate data
        try:
            Station(**station_data)
        except Exception as e:
            self.logger.error(
                "Invalid station data",
                error=str(e)
            )
            return False

        return True