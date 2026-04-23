"""Route persistence operations."""

from __future__ import annotations

import datetime as dt
import json

from backend.infrastructure.supabase.client_types import AsyncPGPool
from backend.infrastructure.supabase.helpers import _require_row


class RoutesRepository:
    """Route data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def save_route(
        self,
        session_id: str,
        bangumi_id: str,
        point_ids: list[str],
        route_data: dict[str, object],
        *,
        origin_station: str | None = None,
        origin_lat: float | None = None,
        origin_lon: float | None = None,
        total_distance: float | None = None,
        total_duration: int | None = None,
    ) -> str:
        """Save a computed route. Returns the generated route UUID."""

        def _default(o: object) -> object:
            if isinstance(o, (dt.datetime, dt.date)):
                return o.isoformat()
            raise TypeError(f"Not serializable: {type(o).__name__}")

        route_json = json.dumps(route_data, default=_default)
        row = _require_row(
            await self._pool.fetchrow(
                """
                INSERT INTO routes (session_id, bangumi_id, origin_station,
                                    origin_location, point_ids,
                                    total_distance, total_duration, route_data)
                VALUES ($1, $2, $3,
                        CASE WHEN $4 IS NOT NULL
                             THEN ST_MakePoint($4, $5)::geography
                             ELSE NULL END,
                        $6, $7, $8, $9::jsonb)
                RETURNING id
                """,
                session_id,
                bangumi_id,
                origin_station,
                origin_lon,
                origin_lat,
                point_ids,
                total_distance,
                total_duration,
                route_json,
            ),
            operation="save_route",
        )
        return str(row["id"])

    async def get_user_routes(
        self, user_id: str, limit: int = 20
    ) -> list[dict[str, object]]:
        """Fetch route history for a user via their conversations."""
        rows = await self._pool.fetch(
            """SELECT r.id, r.bangumi_id, r.origin_station,
                      array_length(r.point_ids, 1) AS point_count,
                      r.created_at,
                      b.title AS bangumi_title
               FROM routes r
               JOIN conversations c ON r.session_id = c.session_id
               LEFT JOIN bangumi b ON r.bangumi_id = b.id
               WHERE c.user_id = $1
               ORDER BY r.created_at DESC
               LIMIT $2""",
            user_id,
            limit,
        )
        return [dict(r) for r in rows]
