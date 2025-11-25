"""
RouteAgent - Optimizes pilgrimage routes using Google Maps API.

Uses Google Maps Directions API to optimize the order of visiting
multiple anime pilgrimage locations, minimizing total travel distance/time.
"""

from typing import Dict, Any, Optional, List

from agents.base import AbstractBaseAgent, AgentInput, AgentOutput
from clients.google_maps import GoogleMapsClient
from domain.entities import Station, Point, Route, APIError, TooManyPointsError
from utils.logger import get_logger


class RouteAgent(AbstractBaseAgent):
    """
    Agent responsible for optimizing pilgrimage routes.

    This agent:
    - Accepts an origin station and a list of pilgrimage points
    - Validates input (1-25 points)
    - Calls Google Maps Directions API with waypoint optimization
    - Returns an optimized Route with navigation details
    """

    # Maximum waypoints supported by Google Maps Directions API
    MAX_WAYPOINTS = 25

    def __init__(self, maps_client: Optional[GoogleMapsClient] = None):
        """
        Initialize the RouteAgent.

        Args:
            maps_client: Optional GoogleMapsClient instance. If not provided,
                        a new instance will be created.
        """
        super().__init__(
            name="route_agent",
            description="Optimizes pilgrimage routes using Google Maps"
        )
        self.maps_client = maps_client or GoogleMapsClient()
        self.logger = get_logger(__name__)

    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Execute the route optimization logic.

        Args:
            input_data: AgentInput containing:
                - origin: Station dictionary with name, coordinates, etc.
                - points: List of Point dictionaries to visit

        Returns:
            Dictionary containing:
                - route: The optimized Route object serialized
                - optimized: Boolean indicating if optimization was applied
                - waypoints_count: Number of waypoints in the route
        """
        # Extract and validate input
        origin_data = input_data.data.get("origin", {})
        points_data = input_data.data.get("points", [])

        # Convert dictionaries to domain entities
        origin = Station(**origin_data)
        points = [Point(**p) for p in points_data]

        self.logger.info(
            "Optimizing route",
            origin=origin.name,
            waypoints_count=len(points),
            session_id=input_data.session_id
        )

        try:
            # Call Google Maps API to get optimized route
            route = await self.maps_client.get_multi_waypoint_route(
                origin=origin,
                waypoints=points
            )

            # Serialize the route for output
            route_dict = route.model_dump()

            self.logger.info(
                "Route optimized successfully",
                origin=origin.name,
                waypoints_count=len(points),
                total_distance_km=route.total_distance_km,
                total_duration_min=route.total_duration_minutes,
                session_id=input_data.session_id
            )

            return {
                "route": route_dict,
                "optimized": True,
                "waypoints_count": len(points)
            }

        except APIError as e:
            self.logger.error(
                "API error during route optimization",
                origin=origin.name,
                waypoints_count=len(points),
                session_id=input_data.session_id,
                error=str(e)
            )
            raise

        except Exception as e:
            self.logger.error(
                "Unexpected error during route optimization",
                origin=origin.name,
                waypoints_count=len(points),
                session_id=input_data.session_id,
                error=str(e),
                exc_info=True
            )
            raise

    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate the input data for RouteAgent.

        Args:
            input_data: AgentInput to validate

        Returns:
            True if input is valid, False otherwise
        """
        # Check if data dict exists
        if not input_data.data:
            self.logger.error("No data provided in input")
            return False

        # Check if origin is provided
        if "origin" not in input_data.data:
            self.logger.error("No origin provided in input")
            return False

        origin_data = input_data.data.get("origin")

        # Validate origin is a dictionary
        if not isinstance(origin_data, dict):
            self.logger.error(
                "Origin must be a dictionary",
                provided_type=type(origin_data).__name__
            )
            return False

        # Validate origin has required fields
        required_origin_fields = ["name", "coordinates"]
        for field in required_origin_fields:
            if field not in origin_data:
                self.logger.error(
                    "Origin missing required field",
                    missing_field=field
                )
                return False

        # Validate origin coordinates structure
        origin_coords = origin_data.get("coordinates")
        if not isinstance(origin_coords, dict):
            self.logger.error("Origin coordinates must be a dictionary")
            return False

        if "latitude" not in origin_coords or "longitude" not in origin_coords:
            self.logger.error("Origin coordinates must have latitude and longitude")
            return False

        # Check if points is provided
        if "points" not in input_data.data:
            self.logger.error("No points provided in input")
            return False

        points_data = input_data.data.get("points")

        # Validate points is a list
        if not isinstance(points_data, list):
            self.logger.error(
                "Points must be a list",
                provided_type=type(points_data).__name__
            )
            return False

        # Check for empty points list
        if len(points_data) == 0:
            self.logger.error("At least one point is required")
            return False

        # Check for too many points
        if len(points_data) > self.MAX_WAYPOINTS:
            self.logger.error(
                f"Too many points. Maximum is {self.MAX_WAYPOINTS}",
                points_count=len(points_data)
            )
            return False

        # Validate each point has required fields
        required_point_fields = ["id", "name", "coordinates", "bangumi_id"]
        for i, point in enumerate(points_data):
            if not isinstance(point, dict):
                self.logger.error(
                    "Point must be a dictionary",
                    point_index=i
                )
                return False

            for field in required_point_fields:
                if field not in point:
                    self.logger.error(
                        "Point missing required field",
                        point_index=i,
                        missing_field=field
                    )
                    return False

        # Try to create Station and Point objects to validate data
        try:
            Station(**origin_data)
            for point_data in points_data:
                Point(**point_data)
        except Exception as e:
            self.logger.error(
                "Invalid origin or point data",
                error=str(e)
            )
            return False

        return True

    def _get_validation_error_message(self, input_data: AgentInput) -> str:
        """
        Generate a user-friendly validation error message.

        Args:
            input_data: AgentInput that failed validation

        Returns:
            Human-readable error message
        """
        if not input_data.data:
            return "No data provided in input"

        if "origin" not in input_data.data:
            return "No origin station provided in input"

        origin_data = input_data.data.get("origin")
        if not isinstance(origin_data, dict):
            return "Origin must be a dictionary with station data"

        if "points" not in input_data.data:
            return "No points provided in input"

        points_data = input_data.data.get("points")
        if not isinstance(points_data, list):
            return "Points must be a list of pilgrimage locations"

        if len(points_data) == 0:
            return "At least one point is required"

        if len(points_data) > self.MAX_WAYPOINTS:
            return f"Too many points. Maximum is {self.MAX_WAYPOINTS} (Google Maps limit)"

        return "Invalid input data format"
