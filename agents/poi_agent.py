"""
POIAgent - Queries business hours and POI details.
Uses GoogleMapsClient to enrich location data with place details and find nearby places.
"""

from typing import Dict, Any, List, Optional
import asyncio

from agents.base import AbstractBaseAgent, AgentInput, AgentOutput
from clients.google_maps import GoogleMapsClient
from domain.entities import Point, Coordinates, APIError
from utils.logger import get_logger


class POIAgent(AbstractBaseAgent):
    """
    Agent responsible for querying POI (Point of Interest) details.

    This agent:
    - Enriches pilgrimage points with Google Places data
    - Queries business hours and ratings
    - Searches for nearby places (cafes, restaurants, etc.)
    - Handles API errors gracefully with partial results
    """

    def __init__(self, google_maps_client: Optional[GoogleMapsClient] = None):
        """
        Initialize the POIAgent.

        Args:
            google_maps_client: Optional GoogleMapsClient instance. If not provided,
                              a new instance will be created.
        """
        super().__init__(
            name="poi_agent",
            description="Queries business hours and POI details"
        )
        self.google_maps_client = google_maps_client or GoogleMapsClient()
        self.logger = get_logger(__name__)

    async def _execute_logic(self, input_data: AgentInput) -> Dict[str, Any]:
        """
        Execute the POI query logic.

        Args:
            input_data: AgentInput containing either:
                For enrichment mode:
                    - points: List of point dictionaries to enrich
                    - enrich_details: True to enrich points
                    - batch_size: Optional batch size for processing
                    - skip_if_has_hours: Skip if opening_hours already present

                For search mode:
                    - coordinates: Coordinates dictionary
                    - search_nearby: True to search nearby places
                    - place_type: Type of place to search for
                    - radius_meters: Search radius (default: 500)

        Returns:
            Dictionary containing:
                For enrichment: enriched_points, points_processed, points_enriched, etc.
                For search: nearby_places, search_type, search_radius_meters
        """
        # Determine mode
        if input_data.data.get("search_nearby"):
            return await self._search_nearby_places(input_data)
        else:
            return await self._enrich_points(input_data)

    async def _enrich_points(self, input_data: AgentInput) -> Dict[str, Any]:
        """Enrich points with POI details."""
        points_data = input_data.data.get("points", [])
        enrich_details = input_data.data.get("enrich_details", False)
        batch_size = input_data.data.get("batch_size", 5)
        skip_if_has_hours = input_data.data.get("skip_if_has_hours", False)

        # Convert to Point objects
        points = [Point(**p) for p in points_data]
        total_points = len(points)

        self.logger.info(
            "Starting POI enrichment",
            total_points=total_points,
            enrich=enrich_details,
            session_id=input_data.session_id
        )

        if not enrich_details:
            # Return points as-is if enrichment not requested
            return {
                "enriched_points": points_data,
                "points_processed": total_points,
                "points_enriched": 0,
                "points_cached": 0,
                "errors": 0
            }

        # Process points
        enriched_points = []
        points_enriched = 0
        points_cached = 0
        errors = 0

        # Process in batches
        for i in range(0, total_points, batch_size):
            batch = points[i:i + batch_size]
            batch_tasks = []

            for point in batch:
                # Check if we should skip (already has data)
                if skip_if_has_hours and point.opening_hours is not None:
                    enriched_points.append(self._add_cached_marker(point))
                    points_cached += 1
                else:
                    # Create enrichment task
                    task = self._enrich_single_point(point)
                    batch_tasks.append(task)

            # Execute batch tasks concurrently
            if batch_tasks:
                batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)

                for result in batch_results:
                    if isinstance(result, Exception):
                        # Handle error, still include original point
                        errors += 1
                        # Find corresponding point and add without enrichment
                        idx = len(enriched_points)
                        if idx < len(points):
                            enriched_points.append(points[idx].model_dump())
                    else:
                        enriched_points.append(result)
                        if "poi_details" in result:
                            points_enriched += 1

        self.logger.info(
            "POI enrichment completed",
            total_points=total_points,
            enriched=points_enriched,
            cached=points_cached,
            errors=errors,
            session_id=input_data.session_id
        )

        return {
            "enriched_points": enriched_points,
            "points_processed": total_points,
            "points_enriched": points_enriched,
            "points_cached": points_cached,
            "errors": errors,
            "batch_size": batch_size
        }

    async def _enrich_single_point(self, point: Point) -> Dict[str, Any]:
        """Enrich a single point with POI details."""
        try:
            # Query Google Places for details
            place_details = await self.google_maps_client.get_place_details(
                coordinates=point.coordinates,
                name=point.name
            )

            # Create enriched point
            enriched = point.model_dump()
            enriched["poi_details"] = {
                "place_id": place_details.get("place_id"),
                "rating": place_details.get("rating"),
                "user_ratings_total": place_details.get("user_ratings_total"),
                "types": place_details.get("types", []),
                "website": place_details.get("website"),
                "open_now": place_details.get("opening_hours", {}).get("open_now"),
                "opening_hours": place_details.get("opening_hours", {}),
                "photos": place_details.get("photos", [])[:3],  # Limit to 3 photos
                "reviews": place_details.get("reviews", [])[:2]  # Limit to 2 reviews
            }

            # Update opening hours if available
            if place_details.get("opening_hours", {}).get("weekday_text"):
                weekday_text = place_details["opening_hours"]["weekday_text"]
                enriched["opening_hours_enriched"] = weekday_text

            return enriched

        except APIError as e:
            self.logger.warning(
                "Failed to enrich point",
                point_id=point.id,
                error=str(e)
            )
            raise

    def _add_cached_marker(self, point: Point) -> Dict[str, Any]:
        """Add a marker indicating cached/existing data."""
        point_dict = point.model_dump()
        point_dict["from_cache"] = True
        return point_dict

    async def _search_nearby_places(self, input_data: AgentInput) -> Dict[str, Any]:
        """Search for nearby places."""
        coordinates_data = input_data.data.get("coordinates", {})
        place_type = input_data.data.get("place_type", "restaurant")
        radius_meters = input_data.data.get("radius_meters", 500)

        # Convert to Coordinates object
        coordinates = Coordinates(**coordinates_data)

        self.logger.info(
            "Searching nearby places",
            latitude=coordinates.latitude,
            longitude=coordinates.longitude,
            place_type=place_type,
            radius=radius_meters,
            session_id=input_data.session_id
        )

        try:
            # Search nearby places
            nearby_places = await self.google_maps_client.search_nearby(
                coordinates=coordinates,
                radius_meters=radius_meters,
                place_type=place_type
            )

            self.logger.info(
                "Nearby search completed",
                results_count=len(nearby_places),
                session_id=input_data.session_id
            )

            return {
                "nearby_places": nearby_places,
                "search_type": place_type,
                "search_radius_meters": radius_meters,
                "location": coordinates.model_dump()
            }

        except APIError as e:
            self.logger.error(
                "API error during nearby search",
                coordinates=coordinates.model_dump(),
                error=str(e),
                session_id=input_data.session_id
            )
            raise

    def _validate_input(self, input_data: AgentInput) -> bool:
        """
        Validate the input data for POIAgent.

        Args:
            input_data: AgentInput to validate

        Returns:
            True if input is valid, False otherwise
        """
        # Check if data dict exists
        if not input_data.data:
            self.logger.error("No data provided in input")
            return False

        # Check mode
        if input_data.data.get("search_nearby"):
            # Validate search mode
            if "coordinates" not in input_data.data:
                self.logger.error("No coordinates provided for search")
                return False

            coordinates_data = input_data.data.get("coordinates")
            if not isinstance(coordinates_data, dict):
                self.logger.error("Coordinates must be a dictionary")
                return False

            # Try to create Coordinates object
            try:
                Coordinates(**coordinates_data)
            except Exception as e:
                self.logger.error(
                    "Invalid coordinates data",
                    error=str(e)
                )
                return False

        else:
            # Validate enrichment mode
            if input_data.data.get("enrich_details", False):
                if "points" not in input_data.data:
                    self.logger.error("No points provided for enrichment")
                    return False

                points = input_data.data.get("points")
                if not isinstance(points, list):
                    self.logger.error("Points must be a list")
                    return False

                # Validate each point
                for i, point_data in enumerate(points):
                    if not isinstance(point_data, dict):
                        self.logger.error(
                            "Each point must be a dictionary",
                            index=i
                        )
                        return False

                    try:
                        Point(**point_data)
                    except Exception as e:
                        self.logger.error(
                            "Invalid point data",
                            index=i,
                            error=str(e)
                        )
                        return False

        return True