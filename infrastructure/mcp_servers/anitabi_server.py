"""Anitabi MCP server (Python).

This server wraps our existing Anitabi client + application use cases into MCP
tools with stable JSON outputs.

Run:
  MCP_TRANSPORT=stdio python -m infrastructure.mcp_servers.anitabi_server
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

from application.use_cases import FetchBangumiPoints, SearchAnitabiBangumiNearStation
from infrastructure.gateways.anitabi import AnitabiClientGateway
from utils.logger import get_logger

logger = get_logger(__name__)

_mcp = FastMCP(
    name="seichijunrei-anitabi",
    instructions=(
        "Tools for querying Anitabi seichijunrei data.\n"
        "All tools return JSON with {success, error} fields."
    ),
)


@_mcp.tool()
async def get_anitabi_points(bangumi_id: str) -> dict:
    """Get all Anitabi points for a bangumi id."""

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
                    "screenshot_url": str(p.screenshot_url),
                    "address": p.address,
                }
                for p in points
            ],
            "success": True,
            "error": None,
        }
    except Exception as exc:
        logger.error(
            "get_anitabi_points failed",
            bangumi_id=bangumi_id,
            error=str(exc),
            exc_info=True,
        )
        return {
            "bangumi_id": bangumi_id,
            "points": [],
            "success": False,
            "error": str(exc),
        }


@_mcp.tool()
async def search_anitabi_bangumi_near_station(
    station_name: str,
    radius_km: float = 5.0,
) -> dict:
    """Search Anitabi bangumi near a station."""

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
                    "cover_url": str(b.cover_url),
                    "points_count": b.points_count,
                    "distance_km": b.distance_km,
                }
                for b in bangumi_list
            ],
            "radius_km": radius_km,
            "success": True,
            "error": None,
        }
    except Exception as exc:
        logger.error(
            "search_anitabi_bangumi_near_station failed",
            station_name=station_name,
            radius_km=radius_km,
            error=str(exc),
            exc_info=True,
        )
        return {
            "station": None,
            "bangumi_list": [],
            "radius_km": radius_km,
            "success": False,
            "error": str(exc),
        }


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    _mcp.run(transport=transport)  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
