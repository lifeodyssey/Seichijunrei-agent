"""ADK BaseAgent for fetching ALL seichijunrei points from Anitabi.

In the simplified Capstone architecture this agent:

- Reads the selected bangumi ID from session state
- Fetches all seichijunrei points for that bangumi from Anitabi
- Writes them to state under the `all_points` key (no filtering)
- Calculates distance from user location to each point (if available)

Downstream, PointsSelectionAgent (LlmAgent) is responsible for selecting
the best 8–12 points for route planning. This keeps deterministic I/O
separate from LLM decision-making, following ADK best practices.
"""

import math
from typing import Any

from google.adk.agents import BaseAgent
from google.adk.events import Event, EventActions
from pydantic import ConfigDict

from application.errors import ExternalServiceError
from application.use_cases import FetchBangumiPoints
from clients.anitabi import AnitabiClient
from clients.anitabi_gateway import AnitabiClientGateway
from utils.logger import get_logger

from .._state import (
    ALL_POINTS,
    BANGUMI_RESULT,
    EXTRACTION_RESULT,
    POINTS_META,
    SELECTED_BANGUMI,
    USER_COORDINATES,
)

# Earth radius in kilometers
_EARTH_RADIUS_KM = 6371.0


def _haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate distance between two points using Haversine formula.

    Args:
        lat1: Latitude of first point in degrees.
        lng1: Longitude of first point in degrees.
        lat2: Latitude of second point in degrees.
        lng2: Longitude of second point in degrees.

    Returns:
        Distance in kilometers.
    """
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lng = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return _EARTH_RADIUS_KM * c


class PointsSearchAgent(BaseAgent):
    """Fetch all seichijunrei points for the selected bangumi from Anitabi."""

    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    def __init__(
        self,
        anitabi_client: AnitabiClient | None = None,
        fetch_bangumi_points: FetchBangumiPoints | None = None,
    ) -> None:
        super().__init__(name="PointsSearchAgent")
        self._anitabi_client = anitabi_client
        self._fetch_bangumi_points = fetch_bangumi_points
        self.logger = get_logger(__name__)

    def _get_fetch_bangumi_points(self) -> FetchBangumiPoints:
        if self._fetch_bangumi_points is None:
            gateway = AnitabiClientGateway(client=self._anitabi_client)
            self._fetch_bangumi_points = FetchBangumiPoints(anitabi=gateway)
        return self._fetch_bangumi_points

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        state: dict[str, Any] = ctx.session.state

        # Verify session state for debugging and ensuring state propagation
        extraction = state.get(EXTRACTION_RESULT) or {}
        selected = state.get(SELECTED_BANGUMI) or {}

        self.logger.info(
            "[PointsSearchAgent] Session state check",
            has_extraction_result=bool(extraction),
            has_location=bool(extraction.get("location")),
            location_value=extraction.get("location"),
            has_selected_bangumi=bool(selected),
            has_bangumi_id=bool(selected.get("bangumi_id")),
            bangumi_id_value=selected.get("bangumi_id"),
        )

        # Prefer the new Capstone state shape first: selected_bangumi.bangumi_id
        selected_bangumi = state.get(SELECTED_BANGUMI) or {}
        bangumi_id = selected_bangumi.get("bangumi_id")

        # Backward-compatible fallback: older workflow uses bangumi_result.bangumi_id
        if bangumi_id is None:
            bangumi_result = state.get(BANGUMI_RESULT) or {}
            bangumi_id = bangumi_result.get("bangumi_id")

        # Coerce string IDs to int (JSON serialization converts int to str)
        if isinstance(bangumi_id, str) and bangumi_id.isdigit():
            bangumi_id = int(bangumi_id)
        if not isinstance(bangumi_id, int):
            raise ValueError(
                f"PointsSearchAgent requires valid bangumi_id. "
                f"Got: {bangumi_id} (type: {type(bangumi_id).__name__})"
            )

        self.logger.info(
            "[PointsSearchAgent] Fetching all bangumi points",
            bangumi_id=bangumi_id,
        )

        try:
            points = await self._get_fetch_bangumi_points()(str(bangumi_id))
        except ExternalServiceError as exc:
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

        # Get user coordinates if available for distance calculation
        user_coords = state.get(USER_COORDINATES)
        user_lat: float | None = None
        user_lng: float | None = None

        if user_coords and isinstance(user_coords, dict):
            user_lat = user_coords.get("latitude")
            user_lng = user_coords.get("longitude")
            self.logger.info(
                "[PointsSearchAgent] User coordinates available",
                user_lat=user_lat,
                user_lng=user_lng,
            )

        # Build points data with optional distance calculation
        # IMPORTANT:
        # `PointsSelectionResult.SelectedPoint` expects flattened `lat/lng` fields
        # (not nested `coordinates`). Keep `all_points` consistent with that schema
        # to reduce LLM confusion and avoid schema incompatibilities.
        all_points_data = []
        for p in points:
            point_data = {
                "id": p.id,
                "name": p.name,
                "cn_name": p.cn_name,
                "lat": p.coordinates.latitude,
                "lng": p.coordinates.longitude,
                "episode": p.episode,
                "time_seconds": p.time_seconds,
                "screenshot_url": str(p.screenshot_url),
                "address": p.address,
            }

            # Add distance from user if coordinates are available
            if user_lat is not None and user_lng is not None:
                distance_km = _haversine_distance(
                    user_lat, user_lng, p.coordinates.latitude, p.coordinates.longitude
                )
                point_data["distance_km"] = round(distance_km, 2)

            all_points_data.append(point_data)

        # Build metadata with optional user coordinates info
        points_meta: dict[str, Any] = {
            "total": len(all_points_data),
            "source": "anitabi",
            "bangumi_id": bangumi_id,
            "has_distance": user_lat is not None and user_lng is not None,
        }

        if user_lat is not None and user_lng is not None:
            points_meta["user_coordinates"] = {
                "latitude": user_lat,
                "longitude": user_lng,
            }

        # Write into session state using the new all_points key
        state[ALL_POINTS] = all_points_data
        state[POINTS_META] = points_meta

        self.logger.info(
            "[PointsSearchAgent] All points prepared",
            points_count=len(all_points_data),
        )

        # BaseAgent Event content must be None or specific ADK types, not arbitrary dict
        yield Event(
            invocation_id=ctx.invocation_id,  # Required: correlate events in same invocation
            author=self.name,
            content=None,
            actions=EventActions(escalate=False),
        )


points_search_agent = PointsSearchAgent()
