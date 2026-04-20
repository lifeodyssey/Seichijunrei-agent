"""
Anitabi API client for anime pilgrimage location data.

Provides methods to:
- Retrieve lightweight bangumi metadata (/{id}/lite)
- Retrieve pilgrimage points for specific anime (/{id}/points/detail)
- Look up station information (deprecated)
"""

from backend.clients.base import (
    BaseHTTPClient,
    _float,
    _int_or,
    _str,
    _str_or_none,
    expect_json_object,
    expect_json_object_list,
)
from backend.clients.errors import APIError, NotFoundError
from backend.config import get_settings
from backend.domain.entities import (
    Coordinates,
    Point,
    Station,
)
from backend.utils.logger import get_logger

logger = get_logger(__name__)


def _detect_schema(data: object) -> list[object] | None:
    """Normalize Anitabi response shape to a raw list, or None if empty."""
    if not data:
        return None
    if isinstance(data, list):
        return data if data else None
    if not isinstance(data, dict):
        raise APIError(f"Invalid Anitabi response type: {type(data).__name__}")
    data_val = data.get("data")
    if isinstance(data_val, list):
        return data_val
    points_val = data.get("points")
    if isinstance(points_val, list):
        return points_val
    raise APIError("Unexpected Anitabi response structure")


def _parse_legacy_point(item: dict[str, object], bangumi_id: str) -> Point:
    """Parse a point item that uses the legacy lat/lng schema."""
    return Point(
        id=_str(item["id"]),
        name=_str(item["name"]),
        cn_name=_str(item.get("cn_name") or item["name"]),
        coordinates=Coordinates(
            latitude=_float(item["lat"]),
            longitude=_float(item["lng"]),
        ),
        bangumi_id=_str(item.get("bangumi_id") or bangumi_id),
        bangumi_title=_str(item.get("bangumi_title") or bangumi_id),
        episode=_int_or(item.get("episode", 0)),
        time_seconds=_int_or(item.get("time_seconds", 0)),
        screenshot_url=_str(item["screenshot"]),
        address=_str_or_none(item.get("address")),
        opening_hours=_str_or_none(item.get("opening_hours")),
        admission_fee=_str_or_none(item.get("admission_fee")),
        origin=_str_or_none(item.get("origin")),
        origin_url=_str_or_none(item.get("origin_url") or item.get("originURL")),
    )


def _parse_official_point(item: dict[str, object], bangumi_id: str) -> Point:
    """Parse a point item that uses the official geo-array schema."""
    geo_raw = item.get("geo")
    if not isinstance(geo_raw, list) or len(geo_raw) < 2:
        raise ValueError("Missing or invalid 'geo' field")
    lat, lng = _float(geo_raw[0]), _float(geo_raw[1])
    screenshot_url = _str_or_none(item.get("image"))
    if screenshot_url and screenshot_url.startswith("/"):
        screenshot_url = f"https://image.anitabi.cn{screenshot_url}"
    cn_name = _str(item.get("cn") or item.get("name") or "")
    return Point(
        id=_str(item["id"]),
        name=_str(item.get("name") or cn_name),
        cn_name=cn_name,
        coordinates=Coordinates(latitude=lat, longitude=lng),
        bangumi_id=str(bangumi_id),
        bangumi_title=str(bangumi_id),
        episode=_int_or(item.get("ep", 0)),
        time_seconds=_int_or(item.get("s", 0)),
        screenshot_url=screenshot_url,
        address=None,
        opening_hours=None,
        admission_fee=None,
        origin=_str_or_none(item.get("origin")),
        origin_url=_str_or_none(item.get("originURL")),
    )


def _build_points(items: list[dict[str, object]], bangumi_id: str) -> list[Point]:
    """Parse each item dict, skipping any that raise during parsing."""
    points: list[Point] = []
    for item in items:
        try:
            if "lat" in item and "lng" in item:
                points.append(_parse_legacy_point(item, bangumi_id))
            else:
                points.append(_parse_official_point(item, bangumi_id))
        except (KeyError, ValueError, TypeError) as e:
            logger.warning("Skipping invalid point data", error=str(e), data=item)
    return points


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
        if base_url is None:
            base_url = get_settings().anitabi_api_url

        super().__init__(
            base_url=base_url,
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

    async def get_bangumi_lite(self, bangumi_id: str) -> dict[str, object]:
        """Fetch lightweight bangumi info: title, cn, city, cover, geo, zoom.

        Uses the documented /{id}/lite endpoint. Returns the raw JSON object
        with fields: id, cn, title, city, cover, color, geo, zoom,
        pointsLength, imagesLength.
        """
        try:
            logger.info("Getting bangumi lite info", bangumi_id=bangumi_id)
            raw = await self.get(f"/{bangumi_id}/lite")
            return expect_json_object(raw, context="get_bangumi_lite")
        except APIError:
            raise
        except Exception as e:
            logger.error(
                "Failed to get bangumi lite info",
                bangumi_id=bangumi_id,
                error=str(e),
                exc_info=True,
            )
            raise APIError(f"Failed to get bangumi lite info: {str(e)}") from e

    async def get_bangumi_points(self, bangumi_id: str) -> list[Point]:
        """Get pilgrimage points for a specific anime.

        Raises:
            APIError: On API communication failure or invalid bangumi ID
        """
        try:
            logger.info("Getting points for bangumi", bangumi_id=bangumi_id)
            response = await self.get(
                f"/{bangumi_id}/points/detail", params={"haveImage": "true"}
            )
            raw_points = _detect_schema(response)
            if not raw_points:
                logger.warning("No points found for bangumi", bangumi_id=bangumi_id)
                return []
            point_dicts = expect_json_object_list(
                raw_points, context="get_bangumi_points"
            )
            points = _build_points(point_dicts, bangumi_id)
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

        DEPRECATED: This method uses the non-official /station endpoint which
        may not be available in the official Anitabi API. Consider using
        Google Maps Geocoding API instead for production use.

        Args:
            station_name: Name of the station (Japanese)

        Returns:
            Station entity with coordinates

        Raises:
            NotFoundError: If station not found
            APIError: On API communication failure
        """
        import warnings

        warnings.warn(
            "get_station_info uses non-official /station endpoint. "
            "Consider using Google Maps Geocoding API instead.",
            DeprecationWarning,
            stacklevel=2,
        )

        try:
            logger.info("Looking up station info", station_name=station_name)

            # Make API request
            response = await self.get("/station", params={"name": station_name})

            # Check if response is valid
            if not response or not isinstance(response, dict):
                raise APIError(f"Invalid API response for station: {station_name}")

            # Check if station found
            raw_data = response.get("data")
            if not raw_data or not isinstance(raw_data, dict):
                raise NotFoundError(
                    f"Station not found: {station_name}", resource_type="station"
                )

            # Convert to domain entity
            station = Station(
                name=_str(raw_data["name"]),
                coordinates=Coordinates(
                    latitude=_float(raw_data["lat"]),
                    longitude=_float(raw_data["lng"]),
                ),
                city=_str_or_none(raw_data.get("city")),
                prefecture=_str_or_none(raw_data.get("prefecture")),
            )

            logger.info(
                "Station info retrieved",
                station_name=station_name,
                coordinates=station.coordinates.to_string(),
            )

            return station

        except NotFoundError:
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
