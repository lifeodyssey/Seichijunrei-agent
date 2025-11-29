"""ADK tools for Bangumi and Anitabi API queries.

These tools are used by both LlmAgents (as FunctionTools) and the root agent.
Extracted to avoid circular imports between agent.py and sub-agents.

Note: Each tool function creates its own client instance to avoid aiohttp
session lifecycle issues in ADK's multi-event-loop execution model.
"""

from clients.anitabi import AnitabiClient
from clients.bangumi import BangumiClient
from clients.google_maps import GoogleMapsClient
from utils.logger import get_logger

logger = get_logger(__name__)


async def search_bangumi_subjects(keyword: str) -> dict:
    """
    Search Bangumi subjects (anime) by keyword.

    Args:
        keyword: Search keyword for bangumi name.

    Returns:
        {
            "keyword": keyword,
            "results": [...bangumi subjects from API...],
            "success": bool,
            "error": str | None,
        }
    """
    async with BangumiClient() as client:
        try:
            results = await client.search_subject(
                keyword=keyword,
                subject_type=BangumiClient.TYPE_ANIME,
            )
            return {
                "keyword": keyword,
                "results": results,
                "success": True,
                "error": None,
            }
        except Exception as e:
            logger.error(
                "search_bangumi_subjects failed",
                keyword=keyword,
                error=str(e),
                exc_info=True,
            )
            # Return structured error instead of raising, to avoid
            # crashing ADK tool execution and causing broken pipe.
            return {
                "keyword": keyword,
                "results": [],
                "success": False,
                "error": str(e),
            }


async def get_bangumi_subject(subject_id: int) -> dict:
    """
    Get detailed Bangumi subject information by ID.

    Args:
        subject_id: Bangumi subject ID.

    Returns:
        {
            "subject_id": subject_id,
            "subject": {...} | None,
            "success": bool,
            "error": str | None,
        }
    """
    async with BangumiClient() as client:
        try:
            subject = await client.get_subject(subject_id)
            return {
                "subject_id": subject_id,
                "subject": subject,
                "success": True,
                "error": None,
            }
        except Exception as e:
            logger.error(
                "get_bangumi_subject failed",
                subject_id=subject_id,
                error=str(e),
                exc_info=True,
            )
            return {
                "subject_id": subject_id,
                "subject": None,
                "success": False,
                "error": str(e),
            }


async def get_anitabi_points(bangumi_id: str) -> dict:
    """
    Get Anitabi pilgrimage points for a specific bangumi.

    Args:
        bangumi_id: Bangumi identifier used by Anitabi.

    Returns:
        {
            "bangumi_id": bangumi_id,
            "points": [...flattened point dicts...],
            "success": bool,
            "error": str | None,
        }
    """
    async with AnitabiClient() as client:
        try:
            points = await client.get_bangumi_points(bangumi_id)

            return {
                "bangumi_id": bangumi_id,
                "points": [
                    {
                        "id": p.id,
                        "name": p.name,
                        "cn_name": p.cn_name,
                        "lat": p.coordinates.latitude,
                        "lng": p.coordinates.longitude,
                        "episode": p.episode,
                        "time_seconds": p.time_seconds,
                        "screenshot_url": p.screenshot_url,
                        "address": p.address,
                    }
                    for p in points
                ],
                "success": True,
                "error": None,
            }
        except Exception as e:
            logger.error(
                "get_anitabi_points failed",
                bangumi_id=bangumi_id,
                error=str(e),
                exc_info=True,
            )
            return {
                "bangumi_id": bangumi_id,
                "points": [],
                "success": False,
                "error": str(e),
            }


async def search_anitabi_bangumi_near_station(
    station_name: str,
    radius_km: float = 5.0,
) -> dict:
    """
    Search Anitabi for bangumi near a station.

    Args:
        station_name: Station name in Japanese.
        radius_km: Search radius in kilometers.

    Returns:
        {
            "station": {...} | None,
            "bangumi_list": [...],
            "radius_km": radius_km,
            "success": bool,
            "error": str | None,
        }
    """
    async with AnitabiClient() as client:
        try:
            station = await client.get_station_info(station_name)
            bangumi_list = await client.search_bangumi(
                station=station,
                radius_km=radius_km,
            )

            return {
                "station": {
                    "name": station.name,
                    "lat": station.coordinates.latitude,
                    "lng": station.coordinates.longitude,
                    "city": station.city,
                    "prefecture": station.prefecture,
                },
                "bangumi_list": [
                    {
                        "id": b.id,
                        "title": b.title,
                        "cn_title": b.cn_title,
                        "cover_url": b.cover_url,
                        "points_count": b.points_count,
                        "distance_km": b.distance_km,
                    }
                    for b in bangumi_list
                ],
                "radius_km": radius_km,
                "success": True,
                "error": None,
            }
        except Exception as e:
            logger.error(
                "search_anitabi_bangumi_near_station failed",
                station_name=station_name,
                radius_km=radius_km,
                error=str(e),
                exc_info=True,
            )
            return {
                "station": None,
                "bangumi_list": [],
                "radius_km": radius_km,
                "success": False,
                "error": str(e),
            }


async def geocode_location(location_name: str) -> dict:
    """
    Geocode a location name to coordinates using the Google Maps Geocoding API.

    This is the canonical way to resolve location names (for example,
    "Uji", "Kyoto", "Tokyo") to GPS coordinates. The Anitabi API does not
    provide geocoding.

    Args:
        location_name: Location name in any supported language

    Returns:
        {
            "name": str,  # Original location name
            "coordinates": {
                "latitude": float,
                "longitude": float
            },
            "formatted_address": str,  # Full address from Google Maps
            "success": bool,
            "error": str | None,
        }

    Example:
        >>> result = await geocode_location("Uji")
        >>> result["coordinates"]
        {"latitude": 34.8897, "longitude": 135.7981}
    """
    async with GoogleMapsClient() as client:
        try:
            coordinates = await client.geocode_address(location_name)

            return {
                "name": location_name,
                "coordinates": {
                    "latitude": coordinates.latitude,
                    "longitude": coordinates.longitude,
                },
                "formatted_address": f"{coordinates.latitude}, {coordinates.longitude}",
                "success": True,
                "error": None,
            }
        except Exception as e:
            logger.error(
                "geocode_location failed",
                location_name=location_name,
                error=str(e),
                exc_info=True,
            )
            return {
                "name": location_name,
                "coordinates": None,
                "formatted_address": None,
                "success": False,
                "error": str(e),
            }


__all__ = [
    "search_bangumi_subjects",
    "get_bangumi_subject",
    "get_anitabi_points",
    "search_anitabi_bangumi_near_station",
    "geocode_location",
]
