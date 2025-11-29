"""
Anitabi API client for anime pilgrimage location data.

Provides methods to:
- Search for anime near train stations
- Retrieve pilgrimage points for specific anime
- Look up station information
"""

from clients.base import BaseHTTPClient
from config.settings import get_settings
from domain.entities import (
    APIError,
    Bangumi,
    Coordinates,
    InvalidStationError,
    NoBangumiFoundError,
    Point,
    Station,
)
from utils.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class AnitabiClient(BaseHTTPClient):
    """
    Client for the Anitabi anime pilgrimage API.

    Provides access to anime pilgrimage location data including:
    - Anime series (bangumi) near stations
    - Specific pilgrimage points for each anime
    - Station coordinate information
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        use_cache: bool = True,
        rate_limit_calls: int = 30,
        rate_limit_period: float = 60.0,
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
            cache_ttl_seconds=3600,  # Cache for 1 hour
        )

        logger.info(
            "Anitabi client initialized",
            base_url=self.base_url,
            cache_enabled=use_cache,
            rate_limit=f"{rate_limit_calls}/{rate_limit_period}s",
        )

    async def search_bangumi(
        self, station: Station, radius_km: float = 5.0
    ) -> list[Bangumi]:
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
                radius_km=radius_km,
            )

            # Convert km to meters for API
            radius_meters = int(radius_km * 1000)

            # Make API request
            response = await self.get(
                "/near",
                params={
                    "lat": station.coordinates.latitude,
                    "lng": station.coordinates.longitude,
                    "radius": radius_meters,
                },
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
                        primary_color=item.get("color"),
                    )
                    bangumi_list.append(bangumi)
                except (KeyError, ValueError) as e:
                    logger.warning(
                        "Skipping invalid bangumi data", error=str(e), data=item
                    )

            if not bangumi_list:
                raise APIError("Invalid response: No valid bangumi data")

            # Sort by distance
            bangumi_list.sort(key=lambda b: b.distance_km or float("inf"))

            logger.info(
                "Bangumi search complete",
                station=station.name,
                found_count=len(bangumi_list),
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
                exc_info=True,
            )
            raise APIError(f"Failed to search bangumi: {str(e)}") from e

    async def get_bangumi_points(self, bangumi_id: str) -> list[Point]:
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
            logger.info("Getting points for bangumi", bangumi_id=bangumi_id)

            # NOTE:
            # The official Anitabi API exposes detailed points at:
            #   GET /bangumi/{subjectID}/points/detail?haveImage=true
            # When using the default base_url `https://api.anitabi.cn/bangumi`,
            # we therefore call `/{id}/points/detail` here.
            #
            # In older/internal versions we expected a wrapped response:
            #   {"data": [...], "total": N}
            # while the official API may return either:
            #   - a bare list: [ {...}, {...} ]
            #   - or an object with a `points` array.
            #
            # This method normalizes all of these shapes into a List[Point].

            # Make API request (prefer detailed points with images only)
            response = await self.get(
                f"/{bangumi_id}/points/detail", params={"haveImage": "true"}
            )

            if not response:
                logger.warning(
                    "Empty response when fetching bangumi points", bangumi_id=bangumi_id
                )
                return []

            # Normalize different possible response shapes
            raw_points = None

            if isinstance(response, dict):
                # Our original/proxy shape: {"data": [...]}
                if isinstance(response.get("data"), list):
                    raw_points = response["data"]
                # Official Anitabi shape: {"points": [...]}
                elif isinstance(response.get("points"), list):
                    raw_points = response["points"]
                else:
                    raise APIError(
                        f"Unexpected Anitabi response structure for bangumi {bangumi_id}"
                    )
            elif isinstance(response, list):
                # Official Anitabi /points/detail returns a bare list
                raw_points = response
            else:
                raise APIError(
                    f"Invalid Anitabi response type for bangumi {bangumi_id}: "
                    f"{type(response).__name__}"
                )

            if not raw_points:
                logger.warning("No points found for bangumi", bangumi_id=bangumi_id)
                return []

            points: list[Point] = []

            for item in raw_points:
                try:
                    # Branch 1: legacy/proxy schema used in internal tests.
                    # Expected fields:
                    #   id, name, cn_name, lat, lng,
                    #   bangumi_id, bangumi_title, episode, time_seconds, screenshot
                    if "lat" in item and "lng" in item:
                        point = Point(
                            id=item["id"],
                            name=item["name"],
                            cn_name=item.get("cn_name") or item["name"],
                            coordinates=Coordinates(
                                latitude=item["lat"], longitude=item["lng"]
                            ),
                            bangumi_id=str(item.get("bangumi_id") or bangumi_id),
                            bangumi_title=item.get("bangumi_title") or str(bangumi_id),
                            episode=int(item.get("episode", 0) or 0),
                            time_seconds=int(item.get("time_seconds", 0) or 0),
                            screenshot_url=item["screenshot"],
                            address=item.get("address"),
                            opening_hours=item.get("opening_hours"),
                            admission_fee=item.get("admission_fee"),
                        )
                        points.append(point)
                        continue

                    # Branch 2: official Anitabi /points/detail schema.
                    # Example fields:
                    #   id, name, cn, image, ep, s, geo: [lat, lng], origin, originURL
                    geo = item.get("geo") or [None, None]
                    lat, lng = float(geo[0]), float(geo[1])

                    episode_raw = item.get("ep", 0)
                    try:
                        episode_int = int(episode_raw)
                    except (ValueError, TypeError):
                        episode_int = 0

                    screenshot_url = item.get("image")
                    if screenshot_url and screenshot_url.startswith("/"):
                        # Official API sometimes returns relative image paths.
                        screenshot_url = f"https://image.anitabi.cn{screenshot_url}"

                    cn_name = item.get("cn") or item.get("name") or ""

                    point = Point(
                        id=item["id"],
                        name=item.get("name") or cn_name,
                        cn_name=cn_name,
                        coordinates=Coordinates(latitude=lat, longitude=lng),
                        bangumi_id=str(bangumi_id),
                        # Use bangumi_id as a fallback title; the orchestrator
                        # also tracks human-readable bangumi_name separately.
                        bangumi_title=str(bangumi_id),
                        episode=episode_int,
                        time_seconds=int(item.get("s", 0) or 0),
                        screenshot_url=screenshot_url,
                        address=None,
                        opening_hours=None,
                        admission_fee=None,
                    )
                    points.append(point)

                except (KeyError, ValueError, TypeError) as e:
                    logger.warning(
                        "Skipping invalid point data", error=str(e), data=item
                    )

            # Sort by episode and time for consistent ordering
            points.sort(key=lambda p: (p.episode, p.time_seconds))

            logger.info(
                "Points retrieved successfully",
                bangumi_id=bangumi_id,
                points_count=len(points),
            )

            return points

        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get bangumi points",
                bangumi_id=bangumi_id,
                error=str(e),
                exc_info=True,
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
            logger.info("Looking up station info", station_name=station_name)

            # Make API request
            response = await self.get("/station", params={"name": station_name})

            # Check if response is valid
            if not response or not isinstance(response, dict):
                raise APIError(f"Invalid API response for station: {station_name}")

            # Check if station found
            data = response.get("data")
            if not data:
                raise InvalidStationError(f"Station not found: {station_name}")

            # Convert to domain entity
            station = Station(
                name=data["name"],
                coordinates=Coordinates(latitude=data["lat"], longitude=data["lng"]),
                city=data.get("city"),
                prefecture=data.get("prefecture"),
            )

            logger.info(
                "Station info retrieved",
                station_name=station_name,
                coordinates=station.coordinates.to_string(),
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
                exc_info=True,
            )
            raise APIError(f"Failed to get station info: {str(e)}") from e
