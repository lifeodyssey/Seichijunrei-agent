"""SQLAgent — generates and executes parameterized SQL from RetrievalRequest.

Translates normalized retrieval requests into safe, parameterized SQL queries
against the Supabase PostgreSQL database (bangumi + points tables with PostGIS).

Usage:
    from agents.sql_agent import SQLAgent

    agent = SQLAgent(db_client)
    result = await agent.execute(retrieval_request)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import structlog
from pydantic import BaseModel, Field

from agents.base import create_agent, get_default_model
from agents.models import RetrievalRequest
from infrastructure.supabase.client import SupabaseClient

logger = structlog.get_logger(__name__)

# Default row limits
_DEFAULT_LIMIT = 20
_DEFAULT_LOCATION_LIMIT = 20
_DEFAULT_ROUTE_RADIUS_M = 50_000  # 50 km — typical day-trip transit radius in Japan

# Reusable PostGIS column expressions for extracting lat/lon from geography columns
_GEO_COLUMNS = (
    "ST_Y(p.location::geometry) AS latitude, ST_X(p.location::geometry) AS longitude"
)


@dataclass
class SQLResult:
    """Result of a SQL query execution."""

    query: str
    params: list[Any]
    rows: list[dict] = field(default_factory=list)
    row_count: int = 0
    error: str | None = None

    @property
    def success(self) -> bool:
        return self.error is None


# ── Known location → coordinates (for geo queries without geocoding) ──

KNOWN_LOCATIONS: dict[str, tuple[float, float]] = {
    # (latitude, longitude)
    "宇治": (34.8843, 135.7997),
    "京都": (35.0116, 135.7681),
    "京都站": (34.9858, 135.7588),
    "京都駅": (34.9858, 135.7588),
    "東京駅": (35.6812, 139.7671),
    "东京站": (35.6812, 139.7671),
    "東京": (35.6762, 139.6503),
    "东京": (35.6762, 139.6503),
    "新宿": (35.6896, 139.7006),
    "秋叶原": (35.7023, 139.7745),
    "秋葉原": (35.7023, 139.7745),
    "飛騨高山": (36.1461, 137.2522),
    "高山": (36.1461, 137.2522),
    "鎌倉": (35.3192, 139.5467),
    "镰仓": (35.3192, 139.5467),
    "大阪": (34.6937, 135.5023),
    "渋谷": (35.6580, 139.7016),
    "涩谷": (35.6580, 139.7016),
    "池袋": (35.7295, 139.7109),
    "横浜": (35.4437, 139.6380),
    "横滨": (35.4437, 139.6380),
    "奈良": (34.6851, 135.8048),
    "広島": (34.3853, 132.4553),
    "広島駅": (34.3976, 132.4753),
    "名古屋": (35.1815, 136.9066),
    "宇治駅": (34.8891, 135.8008),
    "六地蔵": (34.9340, 135.7930),
}

_KNOWN_KEYS_STR = ", ".join(KNOWN_LOCATIONS.keys())

_RESOLVE_LOCATION_PROMPT = """\
You are a location name resolver for a Japanese travel app.

Given a user-provided location name, find the best match from this list of known locations:
{known_locations}

Rules:
- Match across languages: 宇治站 = 宇治駅 = 宇治, 东京站 = 東京駅, etc.
- Strip suffixes like 站/駅/车站/車站 when matching
- If the location is clearly a variant or synonym of a known location, return that known key
- If no reasonable match exists, return null
- Return ONLY the exact key string from the list, or null
"""


class ResolvedLocation(BaseModel):
    matched_key: str | None = Field(
        description="Exact key from KNOWN_LOCATIONS, or null if no match"
    )


async def resolve_location(name: str) -> tuple[float, float] | None:
    """Resolve a location name to coordinates.

    First tries exact match in KNOWN_LOCATIONS, then falls back to LLM
    for fuzzy matching (e.g. 宇治站 → 宇治, 东京站 → 東京駅).
    """
    # Exact match
    coords = KNOWN_LOCATIONS.get(name)
    if coords is not None:
        return coords

    # LLM fuzzy match
    try:
        agent = create_agent(
            get_default_model(),
            system_prompt=_RESOLVE_LOCATION_PROMPT.format(
                known_locations=_KNOWN_KEYS_STR,
            ),
            output_type=ResolvedLocation,
        )
        result = await agent.run(name)
        matched = result.output.matched_key
        if matched and matched in KNOWN_LOCATIONS:
            logger.info("location_resolved_by_llm", input=name, matched=matched)
            return KNOWN_LOCATIONS[matched]
    except Exception as exc:
        logger.warning("location_resolve_llm_failed", input=name, error=str(exc))

    return None


class SQLAgent:
    """Generates and executes parameterized SQL queries from retrieval requests."""

    def __init__(self, db: SupabaseClient) -> None:
        self._db = db

    async def execute(self, request: RetrievalRequest) -> SQLResult:
        """Execute a query based on the retrieval request.

        Args:
            request: Normalized retrieval request from planner/executor.

        Returns:
            SQLResult with query, params, rows, and metadata.
        """
        if request.tool == "search_bangumi" and (request.origin or request.radius):
            handler = self._plan_route
        else:
            handler = {
                "search_bangumi": self._search_by_bangumi,
                "search_nearby": self._search_by_location,
            }.get(request.tool)

        if handler is None:
            return SQLResult(
                query="",
                params=[],
                error=f"No SQL handler for tool: {request.tool}",
            )

        try:
            return await handler(request)
        except Exception as exc:
            logger.error("sql_agent_error", tool=request.tool, error=str(exc))
            return SQLResult(query="", params=[], error=str(exc))

    # ── Query builders ───────────────────────────────────────────────

    async def _search_by_bangumi(self, request: RetrievalRequest) -> SQLResult:
        """Search points by bangumi ID, optionally filtered by episode."""
        bangumi_id = request.bangumi_id
        episode = request.episode

        if not bangumi_id:
            return SQLResult(query="", params=[], error="Missing bangumi ID")

        if episode is not None:
            sql = (
                f"SELECT p.id, p.name, p.name_cn, p.episode, p.time_seconds, "
                f"p.image AS screenshot_url, p.origin, {_GEO_COLUMNS}, "
                f"b.title, b.title_cn "
                f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
                f"WHERE p.bangumi_id = $1 AND p.episode = $2 "
                f"ORDER BY p.time_seconds "
                f"LIMIT {_DEFAULT_LIMIT}"
            )
            query_params: list[Any] = [bangumi_id, episode]
        else:
            sql = (
                f"SELECT p.id, p.name, p.name_cn, p.episode, p.time_seconds, "
                f"p.image AS screenshot_url, p.origin, {_GEO_COLUMNS}, "
                f"b.title, b.title_cn "
                f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
                f"WHERE p.bangumi_id = $1 "
                f"ORDER BY p.episode, p.time_seconds "
                f"LIMIT {_DEFAULT_LIMIT}"
            )
            query_params = [bangumi_id]

        return await self._run(sql, query_params)

    async def _search_by_location(self, request: RetrievalRequest) -> SQLResult:
        """Search points near a location using PostGIS ST_DWithin."""
        location_name = request.location or ""
        radius_m = request.radius or 5000

        coords = await resolve_location(location_name)
        if coords is None:
            return SQLResult(
                query="",
                params=[],
                error=f"Unknown location: {location_name}. Could not resolve coordinates.",
            )

        lat, lon = coords
        sql = (
            f"SELECT p.id, p.name, p.name_cn, p.episode, p.time_seconds, "
            f"p.image AS screenshot_url, p.bangumi_id, {_GEO_COLUMNS}, "
            f"ST_Distance(p.location, ST_MakePoint($1, $2)::geography) AS distance_m, "
            f"b.title, b.title_cn "
            f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
            f"WHERE ST_DWithin(p.location, ST_MakePoint($1, $2)::geography, $3) "
            f"ORDER BY distance_m "
            f"LIMIT {_DEFAULT_LOCATION_LIMIT}"
        )
        query_params: list[Any] = [lon, lat, radius_m]
        return await self._run(sql, query_params)

    async def _plan_route(self, request: RetrievalRequest) -> SQLResult:
        """Fetch points for route planning (sorted by distance from origin)."""
        bangumi_id = request.bangumi_id
        origin_name = request.origin or ""

        if not bangumi_id:
            return SQLResult(query="", params=[], error="Missing bangumi ID for route")

        origin_coords = await resolve_location(origin_name) if origin_name else None

        if origin_coords:
            lat, lon = origin_coords
            radius_m = request.radius or _DEFAULT_ROUTE_RADIUS_M
            sql = (
                f"SELECT p.id, p.name, p.name_cn, p.episode, p.time_seconds, "
                f"p.image AS screenshot_url, {_GEO_COLUMNS}, "
                f"ST_Distance(p.location, ST_MakePoint($1, $2)::geography) AS distance_m, "
                f"b.title, b.title_cn "
                f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
                f"WHERE p.bangumi_id = $3 "
                f"AND ST_DWithin(p.location, ST_MakePoint($1, $2)::geography, $4) "
                f"ORDER BY distance_m "
                f"LIMIT {_DEFAULT_LIMIT}"
            )
            query_params: list[Any] = [lon, lat, bangumi_id, radius_m]
        else:
            sql = (
                f"SELECT p.id, p.name, p.name_cn, p.episode, p.time_seconds, "
                f"p.image AS screenshot_url, {_GEO_COLUMNS}, "
                f"b.title, b.title_cn "
                f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
                f"WHERE p.bangumi_id = $1 "
                f"ORDER BY p.episode, p.time_seconds "
                f"LIMIT {_DEFAULT_LIMIT}"
            )
            query_params = [bangumi_id]

        return await self._run(sql, query_params)

    # ── Execution ────────────────────────────────────────────────────

    async def _run(self, sql: str, params: list[Any]) -> SQLResult:
        """Execute SQL and return structured result."""
        records = await self._db.pool.fetch(sql, *params)
        rows = [dict(r) for r in records]
        logger.info("sql_executed", row_count=len(rows), sql=sql[:80])
        return SQLResult(
            query=sql,
            params=params,
            rows=rows,
            row_count=len(rows),
        )
