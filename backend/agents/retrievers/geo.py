"""Geo retrieval strategy: PostGIS proximity search with sparse-result suggestions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import structlog

from backend.agents.sql_agent import resolve_location
from backend.infrastructure.supabase.client import SupabaseClient

logger = structlog.get_logger(__name__)

_DEFAULT_GEO_LIMIT = 200


def records_to_dicts(
    records: Sequence[Mapping[str, object]],
) -> list[dict[str, object]]:
    """Convert asyncpg records or plain dicts into dicts."""
    return [dict(record) for record in records]


async def fetch_geo_rows(
    db: object,
    anchor: str,
    *,
    radius_m: int,
) -> tuple[list[dict[str, object]], str | None]:
    if not anchor:
        return [], "Missing location/origin for geo retrieval"

    coords = await resolve_location(anchor)
    if coords is None:
        return [], f"Unknown location: {anchor}. Could not resolve coordinates."

    if isinstance(coords, list):
        return [], f"Ambiguous location: {anchor}. Multiple candidates found."

    if not isinstance(db, SupabaseClient):
        return [], "Database client does not support geo retrieval"

    lat, lon = coords
    records = await db.points.search_points_by_location(
        lat, lon, radius_m, limit=_DEFAULT_GEO_LIMIT
    )
    return records_to_dicts(records), None


async def get_area_suggestions(
    db: object,
    anchor: str,
) -> list[dict[str, object]]:
    """Look up known bangumi near an anchor location for clarification."""
    get_bangumi_by_area = getattr(db, "get_bangumi_by_area", None)
    if get_bangumi_by_area is None:
        return []
    coords = await resolve_location(anchor)
    if coords is None or isinstance(coords, list):
        return []
    lat, lon = coords
    try:
        results: list[dict[str, object]] = await get_bangumi_by_area(lat, lon)
        return results
    except Exception as exc:
        logger.warning("area_suggestions_failed", error=str(exc))
        return []
