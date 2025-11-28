"""ADK BaseAgent for fetching and preparing pilgrimage points from Anitabi.

Reads `bangumi_id` and `user_coordinates` from `ctx.session.state`,
queries Anitabi for points, applies simple distance filtering/sorting,
then writes `points` and `points_meta` back to state.
"""

from typing import Any, Dict, List, Optional

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from clients.anitabi import AnitabiClient
from domain.entities import Coordinates, Point, APIError
from utils.logger import get_logger


class PointsSearchAgent(BaseAgent):
    """Get bangumi pilgrimage points around the user's coordinates."""

    model_config = ConfigDict(extra='allow', arbitrary_types_allowed=True)

    def __init__(self, anitabi_client: Optional[AnitabiClient] = None) -> None:
        super().__init__(name="PointsSearchAgent")
        self.anitabi_client = anitabi_client or AnitabiClient()
        self.logger = get_logger(__name__)

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        state: Dict[str, Any] = ctx.session.state

        bangumi_id = state.get("bangumi_id")
        user_coordinates_data = state.get("user_coordinates")
        max_radius_km = state.get("max_radius_km", 50.0)

        if bangumi_id is None or not isinstance(bangumi_id, int):
            raise ValueError("PointsSearchAgent requires integer bangumi_id in session.state")

        if not isinstance(user_coordinates_data, dict):
            raise ValueError("PointsSearchAgent requires user_coordinates dict in session.state")

        try:
            user_coords = Coordinates(**user_coordinates_data)
        except Exception as exc:  # pragma: no cover - defensive
            raise ValueError(f"Invalid user_coordinates in session.state: {exc}") from exc

        self.logger.info(
            "[PointsSearchAgent] Fetching bangumi points",
            bangumi_id=bangumi_id,
            user_coordinates=user_coords.to_string(),
            max_radius_km=max_radius_km,
        )

        try:
            points = await self.anitabi_client.get_bangumi_points(str(bangumi_id))
        except APIError as exc:
            self.logger.error(
                "[PointsSearchAgent] Failed to get bangumi points",
                bangumi_id=bangumi_id,
                error=str(exc),
                exc_info=True,
            )
            raise

        self.logger.info(
            "[PointsSearchAgent] Points fetched",
            bangumi_id=bangumi_id,
            total_points=len(points),
        )

        nearby_points: List[Point] = []

        for point in points:
            distance_km = user_coords.distance_to(point.coordinates)
            # Keep only points within radius
            if distance_km <= max_radius_km:
                nearby_points.append(point)

        self.logger.info(
            "[PointsSearchAgent] Distance filtering applied",
            total_points=len(points),
            nearby_points=len(nearby_points),
            max_radius_km=max_radius_km,
        )

        # Sort by distance (approximate via distance to user)
        nearby_points.sort(key=lambda p: user_coords.distance_to(p.coordinates))

        points_data = [p.model_dump() for p in nearby_points]
        points_meta = {
            "total": len(points_data),
            "source": "anitabi",
            "max_radius_km": max_radius_km,
        }

        # Write into session state
        state["points"] = points_data
        state["points_meta"] = points_meta

        self.logger.info(
            "[PointsSearchAgent] Points prepared",
            points_count=len(points_data),
            max_radius_km=max_radius_km,
        )

        yield Event(
            author=self.name,
            content={
                "points_count": len(points_data),
                "max_radius_km": max_radius_km,
            },
            actions=EventActions(escalate=True),
        )


points_search_agent = PointsSearchAgent()

