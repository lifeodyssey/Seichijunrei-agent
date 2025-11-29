"""
Google Maps API client for directions, geocoding, and places.

Provides methods to:
- Get directions between locations (walking, transit, driving)
- Optimize multi-waypoint routes
- Geocode addresses to coordinates
- Get place details including opening hours
"""

from typing import Any

from clients.base import BaseHTTPClient
from config.settings import get_settings
from domain.entities import (
    APIError,
    Coordinates,
    Point,
    Route,
    RouteSegment,
    Station,
    TransportInfo,
)
from utils.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class GoogleMapsClient(BaseHTTPClient):
    """
    Client for Google Maps APIs.

    Provides access to:
    - Directions API for routing
    - Geocoding API for address resolution
    - Places API for business information
    """

    def __init__(
        self,
        api_key: str | None = None,
        use_cache: bool = True,
        rate_limit_calls: int = 50,
        rate_limit_period: float = 1.0,
    ):
        """
        Initialize Google Maps API client.

        Args:
            api_key: Google Maps API key
            use_cache: Whether to cache geocoding results
            rate_limit_calls: Number of calls allowed per period
            rate_limit_period: Rate limit period in seconds
        """
        # Use Google Maps base URL
        base_url = "https://maps.googleapis.com/maps/api"

        super().__init__(
            base_url=base_url,
            api_key=api_key or settings.google_maps_api_key,
            timeout=30,
            max_retries=3,
            rate_limit_calls=rate_limit_calls,
            rate_limit_period=rate_limit_period,
            use_cache=use_cache,
            cache_ttl_seconds=86400,  # Cache for 24 hours
        )

        if not self.api_key:
            logger.warning("No Google Maps API key provided")

        logger.info(
            "Google Maps client initialized",
            cache_enabled=use_cache,
            rate_limit=f"{rate_limit_calls}/{rate_limit_period}s",
        )

    async def get_directions(
        self,
        origin: Coordinates,
        destination: Coordinates,
        mode: str = "walking",
        skip_cache: bool = False,
    ) -> TransportInfo:
        """
        Get directions between two points.

        Args:
            origin: Starting coordinates
            destination: Ending coordinates
            mode: Travel mode (walking, transit, driving, bicycling)
            skip_cache: Skip cache for this request

        Returns:
            TransportInfo with route details

        Raises:
            APIError: On API failure or invalid response
        """
        try:
            logger.info(
                "Getting directions",
                origin=origin.to_string(),
                destination=destination.to_string(),
                mode=mode,
            )

            # Make API request
            response = await self.get(
                "/directions/json",
                params={
                    "origin": origin.to_string(),
                    "destination": destination.to_string(),
                    "mode": mode,
                    "key": self.api_key,
                    "language": "en",
                    "units": "metric",
                },
                skip_cache=skip_cache,  # Directions can change, optionally skip cache
            )

            # Check API status
            status = response.get("status")
            if status != "OK":
                error_msg = response.get("error_message", "Unknown error")
                if "quota" in error_msg.lower() or status == "OVER_QUERY_LIMIT":
                    raise APIError(f"Google Maps API quota exceeded: {error_msg}")
                elif "key" in error_msg.lower() or status == "REQUEST_DENIED":
                    raise APIError(f"Invalid Google Maps API key: {error_msg}")
                else:
                    raise APIError(f"Directions API error: {status} - {error_msg}")

            # Parse response
            routes = response.get("routes", [])
            if not routes:
                raise APIError("No routes found")

            route = routes[0]
            leg = route["legs"][0]

            # Extract transit details if applicable
            transit_details = None
            if mode == "transit":
                steps = leg.get("steps", [])
                transit_steps = [s for s in steps if s.get("travel_mode") == "TRANSIT"]
                if transit_steps:
                    transit_details = {
                        "lines": [s.get("transit_details", {}) for s in transit_steps]
                    }

            # Build transport info
            transport = TransportInfo(
                mode=mode,
                distance_meters=leg["distance"]["value"],
                duration_minutes=leg["duration"]["value"] // 60,
                instructions="; ".join(
                    [
                        step.get("html_instructions", "")
                        for step in leg.get("steps", [])[:3]  # First 3 steps
                    ]
                ),
                transit_details=transit_details,
            )

            logger.info(
                "Directions retrieved",
                mode=mode,
                distance_km=transport.distance_km,
                duration_min=transport.duration_minutes,
            )

            return transport

        except APIError:
            raise
        except Exception as e:
            logger.error("Failed to get directions", error=str(e), exc_info=True)
            raise APIError(f"Failed to get directions: {str(e)}") from e

    async def get_multi_waypoint_route(
        self, origin: Station, waypoints: list[Point]
    ) -> Route:
        """
        Get optimized route through multiple waypoints.

        Args:
            origin: Starting station
            waypoints: List of pilgrimage points to visit

        Returns:
            Optimized Route with segments

        Raises:
            ValueError: If waypoints list is invalid
            APIError: On API failure
        """
        try:
            if not waypoints:
                raise ValueError("At least one waypoint required")

            if len(waypoints) > 25:
                raise ValueError("Maximum 25 waypoints supported by Google Maps")

            logger.info(
                "Getting multi-waypoint route",
                origin=origin.name,
                waypoints_count=len(waypoints),
            )

            # Build waypoints parameter
            waypoint_coords = [p.coordinates.to_string() for p in waypoints]
            waypoints_param = "optimize:true|" + "|".join(waypoint_coords)

            # Get the last waypoint as destination
            destination = waypoints[-1].coordinates

            # Make API request
            response = await self.get(
                "/directions/json",
                params={
                    "origin": origin.coordinates.to_string(),
                    "destination": destination.to_string(),
                    "waypoints": waypoints_param,
                    "mode": "walking",
                    "key": self.api_key,
                    "language": "en",
                    "units": "metric",
                },
                skip_cache=True,  # Routes should always be fresh
            )

            # Check API status
            status = response.get("status")
            if status != "OK":
                error_msg = response.get("error_message", "Unknown error")
                raise APIError(f"Multi-waypoint API error: {status} - {error_msg}")

            # Parse response
            routes = response.get("routes", [])
            if not routes:
                raise APIError("No routes found")

            route_data = routes[0]
            waypoint_order = route_data.get(
                "waypoint_order", list(range(len(waypoints)))
            )

            # Reorder waypoints based on optimization
            optimized_points = [waypoints[i] for i in waypoint_order]

            # Build route segments
            segments = []
            cumulative_distance = 0
            cumulative_duration = 0

            for i, (leg, point) in enumerate(zip(route_data["legs"], optimized_points)):
                distance_meters = leg["distance"]["value"]
                duration_minutes = leg["duration"]["value"] // 60

                cumulative_distance += distance_meters / 1000  # Convert to km
                cumulative_duration += duration_minutes

                # Create transport info for this segment
                transport = TransportInfo(
                    mode="walking",
                    distance_meters=distance_meters,
                    duration_minutes=duration_minutes,
                    instructions=f"Walk to {point.name}",
                )

                segment = RouteSegment(
                    order=i + 1,
                    point=point,
                    transport=transport,
                    cumulative_distance_km=cumulative_distance,
                    cumulative_duration_minutes=cumulative_duration,
                )
                segments.append(segment)

            # Build route
            route = Route(
                origin=origin,
                segments=segments,
                total_distance_km=cumulative_distance,
                total_duration_minutes=cumulative_duration,
                google_maps_url=self._build_maps_url(origin, optimized_points),
            )

            logger.info(
                "Multi-waypoint route created",
                segments=len(segments),
                total_distance_km=route.total_distance_km,
                total_duration_min=route.total_duration_minutes,
            )

            return route

        except (ValueError, APIError):
            raise
        except Exception as e:
            logger.error(
                "Failed to get multi-waypoint route", error=str(e), exc_info=True
            )
            raise APIError(f"Failed to get route: {str(e)}") from e

    async def geocode_address(self, address: str) -> Coordinates:
        """
        Convert address to coordinates.

        Args:
            address: Address string to geocode

        Returns:
            Coordinates of the address

        Raises:
            APIError: If geocoding fails or no results
        """
        try:
            logger.info("Geocoding address", address=address)

            # Make API request
            response = await self.get(
                "/geocode/json",
                params={"address": address, "key": self.api_key, "language": "en"},
            )

            # Check status
            status = response.get("status")
            if status == "ZERO_RESULTS":
                raise APIError(f"No results found for address: {address}")
            elif status != "OK":
                error_msg = response.get("error_message", "Unknown error")
                if "key" in error_msg.lower():
                    raise APIError(f"Invalid Google Maps API key: {error_msg}")
                raise APIError(f"Geocoding error: {status} - {error_msg}")

            # Parse results
            results = response.get("results", [])
            if not results:
                raise APIError("No results found")

            location = results[0]["geometry"]["location"]
            coords = Coordinates(latitude=location["lat"], longitude=location["lng"])

            logger.info(
                "Address geocoded", address=address, coordinates=coords.to_string()
            )

            return coords

        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to geocode address",
                address=address,
                error=str(e),
                exc_info=True,
            )
            raise APIError(f"Failed to geocode: {str(e)}") from e

    async def get_place_details(self, place_id: str) -> dict[str, Any]:
        """
        Get detailed information about a place.

        Args:
            place_id: Google Place ID

        Returns:
            Dictionary with place details

        Raises:
            APIError: On API failure
        """
        try:
            logger.info("Getting place details", place_id=place_id)

            # Make API request
            response = await self.get(
                "/place/details/json",
                params={
                    "place_id": place_id,
                    "key": self.api_key,
                    "fields": "name,formatted_address,opening_hours,website,formatted_phone_number",
                    "language": "en",
                },
            )

            # Check status
            status = response.get("status")
            if status != "OK":
                error_msg = response.get("error_message", "Unknown error")
                raise APIError(f"Place Details API error: {status} - {error_msg}")

            result = response.get("result", {})

            logger.info(
                "Place details retrieved", place_id=place_id, name=result.get("name")
            )

            return result

        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get place details",
                place_id=place_id,
                error=str(e),
                exc_info=True,
            )
            raise APIError(f"Failed to get place details: {str(e)}") from e

    def _build_maps_url(self, origin: Station, waypoints: list[Point]) -> str:
        """
        Build Google Maps URL for the route.

        Args:
            origin: Starting station
            waypoints: List of points in order

        Returns:
            Google Maps URL string
        """
        base = "https://www.google.com/maps/dir"

        # Start with origin
        parts = [origin.coordinates.to_string()]

        # Add all waypoints
        for point in waypoints:
            parts.append(point.coordinates.to_string())

        # Join with slashes
        url = f"{base}/{'/'.join(parts)}"

        return url
