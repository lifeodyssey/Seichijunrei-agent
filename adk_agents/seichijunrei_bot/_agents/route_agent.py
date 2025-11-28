"""ADK BaseAgent for route optimization using Google Maps.

Reads `station` (if present), `user_coordinates`, and `points` /
`points_filtered` from `ctx.session.state`, calls GoogleMapsClient to get an
optimized multi-waypoint walking route, and writes `route` and `route_meta`
back to state.
"""

from typing import Any, Dict, List, Optional, ClassVar

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from clients.google_maps import GoogleMapsClient
from domain.entities import Station, Point, Route, APIError, TooManyPointsError
from utils.logger import get_logger


class RouteOptimizationAgent(BaseAgent):
    """Optimize pilgrimage route order given origin and points."""

    model_config = ConfigDict(extra='allow', arbitrary_types_allowed=True)

    # Maximum waypoints supported by Google Maps Directions API
    MAX_WAYPOINTS: ClassVar[int] = 25

    def __init__(self, maps_client: Optional[GoogleMapsClient] = None) -> None:
        super().__init__(name="RouteOptimizationAgent")
        self.maps_client = maps_client or GoogleMapsClient()
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        state: Dict[str, Any] = ctx.session.state

        station_data = state.get("station")
        user_coordinates_data = state.get("user_coordinates")
        points_data = state.get("points_filtered") or state.get("points") or []

        if not points_data:
            raise ValueError("RouteOptimizationAgent requires non-empty points or points_filtered in session.state")

        if len(points_data) > self.MAX_WAYPOINTS:
            raise TooManyPointsError(
                f"Too many points for route optimization: {len(points_data)} (max {self.MAX_WAYPOINTS})"
            )

        # Build origin station
        if isinstance(station_data, dict):
            origin = Station(**station_data)
        else:
            # Fallback: build pseudo-station from user coordinates
            if not isinstance(user_coordinates_data, dict):
                raise ValueError("RouteOptimizationAgent requires station or user_coordinates in session.state")

            origin = Station(
                name="User Location",
                coordinates=state["user_coordinates"],  # type: ignore[arg-type]
                city="Unknown",
                prefecture="Unknown",
            )

        # Convert points to domain entities
        try:
            points: List[Point] = [Point(**p) for p in points_data]
        except Exception as exc:  # pragma: no cover - defensive
            raise ValueError(f"Invalid point data in session.state: {exc}") from exc

        self.logger.info(
            "[RouteOptimizationAgent] Optimizing route",
            origin=origin.name,
            waypoints_count=len(points),
        )

        try:
            route: Route = await self.maps_client.get_multi_waypoint_route(
                origin=origin,
                waypoints=points,
            )
        except APIError as exc:
            self.logger.error(
                "[RouteOptimizationAgent] API error during route optimization",
                origin=origin.name,
                waypoints_count=len(points),
                error=str(exc),
                exc_info=True,
            )
            raise

        route_dict = route.model_dump()

        state["route"] = route_dict
        state["route_meta"] = {
            "optimized": True,
            "waypoints_count": len(points),
            "total_distance_km": route.total_distance_km,
            "total_duration_minutes": route.total_duration_minutes,
        }

        self.logger.info(
            "[RouteOptimizationAgent] Route optimized",
            origin=origin.name,
            waypoints_count=len(points),
            total_distance_km=route.total_distance_km,
            total_duration_min=route.total_duration_minutes,
        )

        yield Event(
            author=self.name,
            content={
                "route_summary": {
                    "waypoints_count": len(points),
                    "total_distance_km": route.total_distance_km,
                    "total_duration_minutes": route.total_duration_minutes,
                }
            },
            actions=EventActions(escalate=False),
        )


route_optimization_agent = RouteOptimizationAgent()

