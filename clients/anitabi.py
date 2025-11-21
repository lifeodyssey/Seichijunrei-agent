"""
Anitabi API client for anime pilgrimage location data.

Provides methods to:
- Search for anime near train stations
- Retrieve pilgrimage points for specific anime
- Look up station information
"""

from typing import List, Optional

from config.settings import get_settings
from clients.base import BaseHTTPClient
from domain.entities import (
    APIError, Bangumi, Coordinates, InvalidStationError,
    NoBangumiFoundError, Point, Station
)
from utils.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class AnitabiClient(BaseHTTPClient):
    """
    Client for Anitabi API (圣地巡礼 API).

    Provides access to anime pilgrimage location data including:
    - Anime series (bangumi) near stations
    - Specific pilgrimage points for each anime
    - Station coordinate information
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        use_cache: bool = True,
        rate_limit_calls: int = 30,
        rate_limit_period: float = 60.0
    ):
        """
        Initialize Anitabi API client.

        Args:
            api_key: Optional API key (not required for Anitabi)
            base_url: Override base URL from settings
            use_cache: Whether to cache GET responses
            rate_limit_calls: Number of calls allowed per period
            rate_limit_period: Rate limit period in seconds
        """
        super().__init__(
            base_url=base_url or settings.anitabi_api_url,
            api_key=api_key,
            timeout=30,
            max_retries=3,
            rate_limit_calls=rate_limit_calls,
            rate_limit_period=rate_limit_period,
            use_cache=use_cache,
            cache_ttl_seconds=3600  # Cache for 1 hour
        )

        logger.info(
            "Anitabi client initialized",
            base_url=self.base_url,
            cache_enabled=use_cache,
            rate_limit=f"{rate_limit_calls}/{rate_limit_period}s"
        )

    async def search_bangumi(
        self,
        station: Station,
        radius_km: float = 5.0
    ) -> List[Bangumi]:
        """
        Search for anime near a station.

        Args:
            station: Station to search from
            radius_km: Search radius in kilometers

        Returns:
            List of Bangumi entities sorted by distance

        Raises:
            NoBangumiFoundError: If no anime found in the area
            APIError: On API communication failure
        """
        try:
            logger.info(
                "Searching bangumi near station",
                station=station.name,
                radius_km=radius_km
            )

            # Convert km to meters for API
            radius_meters = int(radius_km * 1000)

            # Make API request
            response = await self.get(
                "/near",
                params={
                    "lat": station.coordinates.latitude,
                    "lng": station.coordinates.longitude,
                    "radius": radius_meters
                }
            )

            # Parse response
            if not response.get("data"):
                raise NoBangumiFoundError(
                    f"No anime locations found within {radius_km}km of {station.name}"
                )

            # Convert to domain entities
            bangumi_list = []
            for item in response["data"]:
                try:
                    bangumi = Bangumi(
                        id=item["id"],
                        title=item["title"],
                        cn_title=item["cn_title"],
                        cover_url=item["cover"],
                        points_count=item.get("points_count", 0),
                        distance_km=item.get("distance", 0),
                        primary_color=item.get("color")
                    )
                    bangumi_list.append(bangumi)
                except (KeyError, ValueError) as e:
                    logger.warning(
                        "Skipping invalid bangumi data",
                        error=str(e),
                        data=item
                    )

            if not bangumi_list:
                raise APIError("Invalid response: No valid bangumi data")

            # Sort by distance
            bangumi_list.sort(key=lambda b: b.distance_km or float('inf'))

            logger.info(
                "Bangumi search complete",
                station=station.name,
                found_count=len(bangumi_list)
            )

            return bangumi_list

        except NoBangumiFoundError:
            raise
        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to search bangumi",
                station=station.name,
                error=str(e),
                exc_info=True
            )
            raise APIError(f"Failed to search bangumi: {str(e)}") from e

    async def get_bangumi_points(self, bangumi_id: str) -> List[Point]:
        """
        Get pilgrimage points for a specific anime.

        Args:
            bangumi_id: Unique identifier of the anime

        Returns:
            List of Point entities for the anime

        Raises:
            APIError: On API communication failure or invalid bangumi ID
        """
        try:
            logger.info(
                "Getting points for bangumi",
                bangumi_id=bangumi_id
            )

            # Make API request
            response = await self.get(f"/bangumi/{bangumi_id}/points")

            # Parse response
            if not response.get("data"):
                logger.warning(
                    "No points found for bangumi",
                    bangumi_id=bangumi_id
                )
                return []

            # Convert to domain entities
            points = []
            for item in response["data"]:
                try:
                    point = Point(
                        id=item["id"],
                        name=item["name"],
                        cn_name=item["cn_name"],
                        coordinates=Coordinates(
                            latitude=item["lat"],
                            longitude=item["lng"]
                        ),
                        bangumi_id=item["bangumi_id"],
                        bangumi_title=item["bangumi_title"],
                        episode=item["episode"],
                        time_seconds=item["time_seconds"],
                        screenshot_url=item["screenshot"],
                        address=item.get("address"),
                        opening_hours=item.get("opening_hours"),
                        admission_fee=item.get("admission_fee")
                    )
                    points.append(point)
                except (KeyError, ValueError) as e:
                    logger.warning(
                        "Skipping invalid point data",
                        error=str(e),
                        data=item
                    )

            # Sort by episode and time
            points.sort(key=lambda p: (p.episode, p.time_seconds))

            logger.info(
                "Points retrieved successfully",
                bangumi_id=bangumi_id,
                points_count=len(points)
            )

            return points

        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get bangumi points",
                bangumi_id=bangumi_id,
                error=str(e),
                exc_info=True
            )
            raise APIError(f"Failed to get bangumi points: {str(e)}") from e

    async def get_station_info(self, station_name: str) -> Station:
        """
        Look up station information by name.

        Args:
            station_name: Name of the station (Japanese)

        Returns:
            Station entity with coordinates

        Raises:
            InvalidStationError: If station not found
            APIError: On API communication failure
        """
        try:
            logger.info(
                "Looking up station info",
                station_name=station_name
            )

            # Make API request
            response = await self.get(
                "/station",
                params={"name": station_name}
            )

            # Check if station found
            data = response.get("data")
            if not data:
                raise InvalidStationError(
                    f"Station not found: {station_name}"
                )

            # Convert to domain entity
            station = Station(
                name=data["name"],
                coordinates=Coordinates(
                    latitude=data["lat"],
                    longitude=data["lng"]
                ),
                city=data.get("city"),
                prefecture=data.get("prefecture")
            )

            logger.info(
                "Station info retrieved",
                station_name=station_name,
                coordinates=station.coordinates.to_string()
            )

            return station

        except InvalidStationError:
            raise
        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get station info",
                station_name=station_name,
                error=str(e),
                exc_info=True
            )
            raise APIError(f"Failed to get station info: {str(e)}") from e