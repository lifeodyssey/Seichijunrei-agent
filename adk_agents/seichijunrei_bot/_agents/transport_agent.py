"""ADK BaseAgent for optimizing transport modes along a route.

Reads `route` from `ctx.session.state`, uses GoogleMapsClient to choose the
best mode (walking vs transit) for each segment, writes the updated `route`
back to state, and also stores a minimal `final_plan` wrapper.
"""

from typing import Any, Dict, Optional, List, ClassVar

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from clients.google_maps import GoogleMapsClient
from domain.entities import Route, RouteSegment, TransportInfo, Coordinates, APIError
from utils.logger import get_logger


class TransportAgent(BaseAgent):
    """Optimize transport modes for each route segment."""

    model_config = ConfigDict(extra='allow', arbitrary_types_allowed=True)

    # Distance threshold for considering transit (km)
    TRANSIT_THRESHOLD_KM: ClassVar[float] = 1.5

    def __init__(self, maps_client: Optional[GoogleMapsClient] = None) -> None:
        super().__init__(name="TransportAgent")
        self.maps_client = maps_client or GoogleMapsClient()
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        state: Dict[str, Any] = ctx.session.state

        route_data = state.get("route")
        if not isinstance(route_data, dict):
            raise ValueError("TransportAgent requires route dict in session.state")

        try:
            route = Route(**route_data)
        except Exception as exc:  # pragma: no cover - defensive
            raise ValueError(f"Invalid route data in session.state: {exc}") from exc

        self.logger.info(
            "[TransportAgent] Optimizing transport modes",
            segments_count=len(route.segments),
        )

        try:
            optimized_route = await self._optimize_route(route)
        except APIError as exc:
            self.logger.error(
                "[TransportAgent] API error during transport optimization",
                segments_count=len(route.segments),
                error=str(exc),
                exc_info=True,
            )
            raise

        optimized_dict = optimized_route.model_dump()
        state["route"] = optimized_dict

        # Minimal final_plan wrapper for later stages / root agent
        state["final_plan"] = {
            "route": optimized_dict,
            "summary": {
                "segments": len(optimized_route.segments),
                "total_distance_km": optimized_route.total_distance_km,
                "total_duration_minutes": optimized_route.total_duration_minutes,
            },
        }

        self.logger.info(
            "[TransportAgent] Transport optimization complete",
            segments=len(optimized_route.segments),
            total_distance_km=optimized_route.total_distance_km,
            total_duration_min=optimized_route.total_duration_minutes,
        )

        yield Event(
            author=self.name,
            content={
                "final_plan_summary": state["final_plan"]["summary"],
            },
            actions=EventActions(escalate=True),
        )

    async def _optimize_route(self, route: Route) -> Route:
        """Return a new Route with optimized transport per segment."""
        optimized_segments: List[RouteSegment] = []
        cumulative_distance_km = 0.0
        cumulative_duration_minutes = 0

        previous_location: Coordinates = route.origin.coordinates

        for segment in route.segments:
            optimal_transport = await self._optimize_segment_transport(
                origin=previous_location,
                destination=segment.point.coordinates,
            )

            cumulative_distance_km += optimal_transport.distance_km
            cumulative_duration_minutes += optimal_transport.duration_minutes

            optimized_segment = RouteSegment(
                order=segment.order,
                point=segment.point,
                transport=optimal_transport,
                cumulative_distance_km=cumulative_distance_km,
                cumulative_duration_minutes=cumulative_duration_minutes,
            )
            optimized_segments.append(optimized_segment)

            previous_location = segment.point.coordinates

        return Route(
            origin=route.origin,
            segments=optimized_segments,
            total_distance_km=cumulative_distance_km,
            total_duration_minutes=cumulative_duration_minutes,
            google_maps_url=route.google_maps_url,
            created_at=route.created_at,
        )

    async def _optimize_segment_transport(
        self,
        origin: Coordinates,
        destination: Coordinates,
    ) -> TransportInfo:
        """Determine optimal mode for a single segment.

        Strategy:
        - Distance ≤ TRANSIT_THRESHOLD_KM: walking only
        - Distance > TRANSIT_THRESHOLD_KM: compare walking vs transit, choose faster
        """
        distance_km = origin.distance_to(destination)

        self.logger.debug(
            "[TransportAgent] Optimizing segment transport",
            distance_km=distance_km,
            threshold_km=self.TRANSIT_THRESHOLD_KM,
        )

        # Short distance: always walk
        if distance_km <= self.TRANSIT_THRESHOLD_KM:
            self.logger.debug(
                "[TransportAgent] Short distance, using walking",
                distance_km=distance_km,
            )
            return await self.maps_client.get_directions(
                origin=origin,
                destination=destination,
                mode="walking",
            )

        # Long distance: compare walking vs transit
        self.logger.debug(
            "[TransportAgent] Long distance, comparing walking vs transit",
            distance_km=distance_km,
        )

        walking = await self.maps_client.get_directions(
            origin=origin,
            destination=destination,
            mode="walking",
        )

        try:
            transit = await self.maps_client.get_directions(
                origin=origin,
                destination=destination,
                mode="transit",
            )

            if transit.duration_minutes < walking.duration_minutes:
                self.logger.debug(
                    "[TransportAgent] Transit is faster, using transit",
                    walking_duration=walking.duration_minutes,
                    transit_duration=transit.duration_minutes,
                )
                return transit

            self.logger.debug(
                "[TransportAgent] Walking is faster or equal, using walking",
                walking_duration=walking.duration_minutes,
                transit_duration=transit.duration_minutes,
            )
            return walking

        except APIError as exc:
            self.logger.warning(
                "[TransportAgent] Transit query failed, falling back to walking",
                error=str(exc),
            )
            return walking


transport_agent = TransportAgent()

