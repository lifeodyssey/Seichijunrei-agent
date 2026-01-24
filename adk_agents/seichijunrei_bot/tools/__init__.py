"""ADK tools for Bangumi and Anitabi API queries.

These tools are used by both LlmAgents (as FunctionTools) and the root agent.
Extracted to avoid circular imports between agent.py and sub-agents.

Note: Each tool function creates its own gateway instance to avoid aiohttp
session lifecycle issues in ADK's multi-event-loop execution model.
"""

from application.use_cases import (
    FetchBangumiPoints,
    GetBangumiSubject,
    SearchAnitabiBangumiNearStation,
    SearchBangumiSubjects,
)
from domain.entities import BangumiSubjectType
from infrastructure.gateways import AnitabiClientGateway, BangumiClientGateway
from utils.logger import get_logger

from .result import ErrorCodes, ToolResult, error_result, success_result
from .translation import translate_tool

logger = get_logger(__name__)

__all__ = [
    # Result types
    "ToolResult",
    "ErrorCodes",
    "success_result",
    "error_result",
    # Tools
    "search_bangumi_subjects",
    "get_bangumi_subject",
    "get_anitabi_points",
    "search_bangumi_near_station",
    "translate_tool",
]


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
    try:
        use_case = SearchBangumiSubjects(bangumi=BangumiClientGateway())
        results = await use_case(
            keyword=keyword,
            subject_type=BangumiSubjectType.ANIME,
            max_results=10,
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
    try:
        use_case = GetBangumiSubject(bangumi=BangumiClientGateway())
        subject = await use_case(subject_id)
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
    Get Anitabi seichijunrei points for a specific bangumi.

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
    try:
        use_case = FetchBangumiPoints(anitabi=AnitabiClientGateway())
        points = await use_case(bangumi_id)

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
    try:
        use_case = SearchAnitabiBangumiNearStation(anitabi=AnitabiClientGateway())
        station, bangumi_list = await use_case(
            station_name=station_name,
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


__all__ = [
    "search_bangumi_subjects",
    "get_bangumi_subject",
    "get_anitabi_points",
    "search_anitabi_bangumi_near_station",
    "translate_tool",
]
