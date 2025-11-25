"""
TransportAgent - Optimizes transport modes for route segments.

Intelligently selects the best transportation mode (walking/transit) for each
segment of a pilgrimage route based on distance and time efficiency.
"""

from typing import Dict, Any, Optional

from agents.base import AbstractBaseAgent, AgentInput, AgentOutput
from clients.google_maps import GoogleMapsClient
from domain.entities import (
    Station, Point, Route, RouteSegment, TransportInfo, Coordinates, APIError
)
from utils.logger import get_logger


class TransportAgent(AbstractBaseAgent):
    """
    Agent responsible for optimizing transport modes for route segments.

    This agent:
    - Accepts a Route object with initial transport modes (typically all walking)
    - Analyzes each segment to determine optimal transport mode
    - For short distances (≤1.5km): keeps walking
    - For long distances (>1.5km): compares walking vs transit, selects faster option
    - Returns optimized Route with updated transport information
    """

    # Distance threshold for considering transit (km)
    TRANSIT_THRESHOLD_KM = 1.5

    def __init__(self, maps_client: Optional[GoogleMapsClient] = None):
        """
        Initialize the TransportAgent.

        Args:
            maps_client: Optional GoogleMapsClient instance. If not provided,
                        a new instance will be created.
        """
        super().__init__(
            name="transport_agent",
            description="Optimizes transport modes for route segments"
        )
        self.maps_client = maps_client or GoogleMapsClient()
        self.logger = get_logger(__name__)

    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Execute the transport optimization logic.

        Args:
            input_data: AgentInput containing:
                - route: Route dictionary with origin and segments

        Returns:
            Dictionary containing:
                - route: Optimized Route object serialized
                - optimized: Boolean indicating optimization was performed
                - segments_optimized: Number of segments optimized
        """
        # Extract and validate input
        route_data = input_data.data.get("route", {})

        # Convert dictionary to Route entity
        route = Route(**route_data)

        self.logger.info(
            "Optimizing transport modes",
            segments_count=len(route.segments),
            session_id=input_data.session_id
        )

        try:
            # Optimize each segment
            optimized_segments = []
            cumulative_distance_km = 0.0
            cumulative_duration_minutes = 0

            # Track previous location for calculating transport
            previous_location = route.origin.coordinates

            for segment in route.segments:
                # Get optimal transport for this segment
                optimal_transport = await self._optimize_segment_transport(
                    origin=previous_location,
                    destination=segment.point.coordinates
                )

                # Update cumulative values
                cumulative_distance_km += optimal_transport.distance_km
                cumulative_duration_minutes += optimal_transport.duration_minutes

                # Create updated segment
                optimized_segment = RouteSegment(
                    order=segment.order,
                    point=segment.point,
                    transport=optimal_transport,
                    cumulative_distance_km=cumulative_distance_km,
                    cumulative_duration_minutes=cumulative_duration_minutes
                )

                optimized_segments.append(optimized_segment)

                # Update previous location for next segment
                previous_location = segment.point.coordinates

            # Create optimized route
            optimized_route = Route(
                origin=route.origin,
                segments=optimized_segments,
                total_distance_km=cumulative_distance_km,
                total_duration_minutes=cumulative_duration_minutes,
                google_maps_url=route.google_maps_url,
                created_at=route.created_at
            )

            # Serialize route for output
            route_dict = optimized_route.model_dump()

            self.logger.info(
                "Transport modes optimized",
                segments_count=len(optimized_segments),
                total_distance_km=cumulative_distance_km,
                total_duration_min=cumulative_duration_minutes,
                session_id=input_data.session_id
            )

            return {
                "route": route_dict,
                "optimized": True,
                "segments_optimized": len(optimized_segments)
            }

        except APIError as e:
            self.logger.error(
                "API error during transport optimization",
                segments_count=len(route.segments),
                session_id=input_data.session_id,
                error=str(e)
            )
            raise

        except Exception as e:
            self.logger.error(
                "Unexpected error during transport optimization",
                segments_count=len(route.segments),
                session_id=input_data.session_id,
                error=str(e),
                exc_info=True
            )
            raise

    async def _optimize_segment_transport(
        self,
        origin: Coordinates,
        destination: Coordinates
    ) -> TransportInfo:
        """
        Determine optimal transport mode for a single route segment.

        Args:
            origin: Starting coordinates
            destination: Ending coordinates

        Returns:
            TransportInfo with optimal mode and details

        Strategy:
            - Distance ≤ 1.5km: Use walking
            - Distance > 1.5km: Compare walking vs transit, choose faster
        """
        # Calculate straight-line distance
        distance_km = origin.distance_to(destination)

        self.logger.debug(
            "Optimizing segment transport",
            distance_km=distance_km,
            threshold_km=self.TRANSIT_THRESHOLD_KM
        )

        # Short distance: always walk
        if distance_km <= self.TRANSIT_THRESHOLD_KM:
            self.logger.debug(
                "Short distance, using walking",
                distance_km=distance_km
            )
            return await self.maps_client.get_directions(
                origin=origin,
                destination=destination,
                mode="walking"
            )

        # Long distance: compare walking vs transit
        self.logger.debug(
            "Long distance, comparing walking vs transit",
            distance_km=distance_km
        )

        # Get both options
        walking = await self.maps_client.get_directions(
            origin=origin,
            destination=destination,
            mode="walking"
        )

        try:
            transit = await self.maps_client.get_directions(
                origin=origin,
                destination=destination,
                mode="transit"
            )

            # Choose faster option
            if transit.duration_minutes < walking.duration_minutes:
                self.logger.debug(
                    "Transit is faster, using transit",
                    walking_duration=walking.duration_minutes,
                    transit_duration=transit.duration_minutes
                )
                return transit
            else:
                self.logger.debug(
                    "Walking is faster or equal, using walking",
                    walking_duration=walking.duration_minutes,
                    transit_duration=transit.duration_minutes
                )
                return walking

        except APIError as e:
            # If transit query fails (e.g., no transit available), fall back to walking
            self.logger.warning(
                "Transit query failed, falling back to walking",
                error=str(e)
            )
            return walking

    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate the input data for TransportAgent.

        Args:
            input_data: AgentInput to validate

        Returns:
            True if input is valid, False otherwise
        """
        # Check if data dict exists
        if not input_data.data:
            self.logger.error("No data provided in input")
            return False

        # Check if route is provided
        if "route" not in input_data.data:
            self.logger.error("No route provided in input")
            return False

        route_data = input_data.data.get("route")

        # Validate route is a dictionary
        if not isinstance(route_data, dict):
            self.logger.error(
                "Route must be a dictionary",
                provided_type=type(route_data).__name__
            )
            return False

        # Validate route has required fields
        required_fields = ["origin", "segments"]
        for field in required_fields:
            if field not in route_data:
                self.logger.error(
                    "Route missing required field",
                    missing_field=field
                )
                return False

        # Validate segments is a list
        segments = route_data.get("segments")
        if not isinstance(segments, list):
            self.logger.error(
                "Segments must be a list",
                provided_type=type(segments).__name__
            )
            return False

        # Check for empty segments list
        if len(segments) == 0:
            self.logger.error("Route must have at least one segment")
            return False

        # Try to create Route object to validate data
        try:
            Route(**route_data)
        except Exception as e:
            self.logger.error(
                "Invalid route data",
                error=str(e)
            )
            return False

        return True
