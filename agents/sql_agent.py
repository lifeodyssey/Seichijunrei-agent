"""SQLAgent — generates and executes parameterized SQL from IntentOutput.

Translates classified intents into safe, parameterized SQL queries against
the Supabase PostgreSQL database (bangumi + points tables with PostGIS).

Usage:
    from agents.sql_agent import SQLAgent

    agent = SQLAgent(db_client)
    result = await agent.execute(intent_output)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import structlog

from agents.intent_agent import ExtractedParams, IntentOutput
from infrastructure.supabase.client import SupabaseClient

logger = structlog.get_logger(__name__)

# Default row limits
_DEFAULT_LIMIT = 100
_DEFAULT_LOCATION_LIMIT = 50

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


class SQLAgent:
    """Generates and executes parameterized SQL queries from intent output."""

    def __init__(self, db: SupabaseClient) -> None:
        self._db = db

    async def execute(self, intent: IntentOutput) -> SQLResult:
        """Execute a query based on the classified intent.

        Args:
            intent: Output from IntentAgent with intent + extracted_params.

        Returns:
            SQLResult with query, params, rows, and metadata.
        """
        handler = {
            "search_by_bangumi": self._search_by_bangumi,
            "search_by_location": self._search_by_location,
            "plan_route": self._plan_route,
        }.get(intent.intent)

        if handler is None:
            return SQLResult(
                query="",
                params=[],
                error=f"No SQL handler for intent: {intent.intent}",
            )

        try:
            return await handler(intent.extracted_params)
        except Exception as exc:
            logger.error("sql_agent_error", intent=intent.intent, error=str(exc))
            return SQLResult(query="", params=[], error=str(exc))

    # ── Query builders ───────────────────────────────────────────────

    async def _search_by_bangumi(self, params: ExtractedParams) -> SQLResult:
        """Search points by bangumi ID, optionally filtered by episode."""
        bangumi_id = params.bangumi
        episode = params.episode

        if not bangumi_id:
            return SQLResult(query="", params=[], error="Missing bangumi ID")

        if episode is not None:
            sql = (
                f"SELECT p.id, p.name, p.cn_name, p.episode, p.time_seconds, "
                f"p.screenshot_url, p.address, p.origin, {_GEO_COLUMNS}, "
                f"b.title, b.title_cn "
                f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
                f"WHERE p.bangumi_id = $1 AND p.episode = $2 "
                f"ORDER BY p.time_seconds "
                f"LIMIT {_DEFAULT_LIMIT}"
            )
            query_params: list[Any] = [bangumi_id, episode]
        else:
            sql = (
                f"SELECT p.id, p.name, p.cn_name, p.episode, p.time_seconds, "
                f"p.screenshot_url, p.address, p.origin, {_GEO_COLUMNS}, "
                f"b.title, b.title_cn "
                f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
                f"WHERE p.bangumi_id = $1 "
                f"ORDER BY p.episode, p.time_seconds "
                f"LIMIT {_DEFAULT_LIMIT}"
            )
            query_params = [bangumi_id]

        return await self._run(sql, query_params)

    async def _search_by_location(self, params: ExtractedParams) -> SQLResult:
        """Search points near a location using PostGIS ST_DWithin."""
        location_name = params.location or ""
        radius_m = params.radius or 5000

        coords = KNOWN_LOCATIONS.get(location_name)
        if coords is None:
            return SQLResult(
                query="",
                params=[],
                error=f"Unknown location: {location_name}. Geocoding not yet implemented.",
            )

        lat, lon = coords
        sql = (
            f"SELECT p.id, p.name, p.cn_name, p.episode, p.time_seconds, "
            f"p.screenshot_url, p.address, p.bangumi_id, {_GEO_COLUMNS}, "
            f"ST_Distance(p.location, ST_MakePoint($1, $2)::geography) AS distance_m, "
            f"b.title, b.title_cn "
            f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
            f"WHERE ST_DWithin(p.location, ST_MakePoint($1, $2)::geography, $3) "
            f"ORDER BY distance_m "
            f"LIMIT {_DEFAULT_LOCATION_LIMIT}"
        )
        query_params: list[Any] = [lon, lat, radius_m]
        return await self._run(sql, query_params)

    async def _plan_route(self, params: ExtractedParams) -> SQLResult:
        """Fetch points for route planning (sorted by distance from origin)."""
        bangumi_id = params.bangumi
        origin_name = params.origin or ""

        if not bangumi_id:
            return SQLResult(query="", params=[], error="Missing bangumi ID for route")

        origin_coords = KNOWN_LOCATIONS.get(origin_name)

        if origin_coords:
            lat, lon = origin_coords
            sql = (
                f"SELECT p.id, p.name, p.cn_name, p.episode, p.time_seconds, "
                f"p.screenshot_url, p.address, {_GEO_COLUMNS}, "
                f"ST_Distance(p.location, ST_MakePoint($1, $2)::geography) AS distance_m, "
                f"b.title, b.title_cn "
                f"FROM points p JOIN bangumi b ON p.bangumi_id = b.id "
                f"WHERE p.bangumi_id = $3 "
                f"ORDER BY distance_m "
                f"LIMIT {_DEFAULT_LIMIT}"
            )
            query_params: list[Any] = [lon, lat, bangumi_id]
        else:
            sql = (
                f"SELECT p.id, p.name, p.cn_name, p.episode, p.time_seconds, "
                f"p.screenshot_url, p.address, {_GEO_COLUMNS}, "
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
