"""Points table operations."""

from __future__ import annotations

from backend.infrastructure.supabase.client_types import AsyncPGPool, Row
from backend.infrastructure.supabase.helpers import (
    _POINT_COLUMNS,
    _point_placeholder,
    _prepare_point_fields,
    _validate_columns,
)


class PointsRepository:
    """Points table data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def get_points_by_bangumi(self, bangumi_id: str) -> list[Row]:
        """Fetch all points for a bangumi."""
        return await self._pool.fetch(
            "SELECT * FROM points WHERE bangumi_id = $1 ORDER BY episode, time_seconds",
            bangumi_id,
        )

    async def get_points_by_ids(self, point_ids: list[str]) -> list[dict[str, object]]:
        """Fetch specific points by ID, preserving the input order."""
        if not point_ids:
            return []

        rows = await self._pool.fetch(
            """
            SELECT p.*
            FROM points p
            JOIN unnest($1::text[]) WITH ORDINALITY AS requested(id, ord)
              ON p.id = requested.id
            ORDER BY requested.ord
            """,
            point_ids,
        )
        return [dict(row) for row in rows]

    async def search_points_by_location(
        self,
        lat: float,
        lon: float,
        radius_m: float = 5000,
        *,
        limit: int = 50,
    ) -> list[Row]:
        """Find points within radius of a location using PostGIS."""
        return await self._pool.fetch(
            """
            SELECT
                p.id,
                p.bangumi_id,
                p.name,
                p.name_cn,
                p.episode,
                p.time_seconds,
                p.image AS screenshot_url,
                p.origin,
                COALESCE(p.latitude, ST_Y(p.location::geometry)) AS latitude,
                COALESCE(p.longitude, ST_X(p.location::geometry)) AS longitude,
                ST_Distance(
                    COALESCE(
                        p.location,
                        ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
                    ),
                    ST_MakePoint($1, $2)::geography
                ) AS distance_m,
                b.title,
                b.title_cn
            FROM points p
            LEFT JOIN bangumi b ON p.bangumi_id = b.id
            WHERE ST_DWithin(
                COALESCE(
                    p.location,
                    ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
                ),
                ST_MakePoint($1, $2)::geography,
                $3
            )
            ORDER BY distance_m
            LIMIT $4
            """,
            lon,
            lat,
            radius_m,
            limit,
        )

    async def upsert_point(self, point_id: str, **fields: object) -> None:
        """Insert or update a point record."""
        _validate_columns(_POINT_COLUMNS, fields)
        point_fields = _prepare_point_fields(fields)

        columns = ["id"] + list(point_fields.keys())
        values: list[object] = [point_id] + list(point_fields.values())
        placeholders = [
            _point_placeholder(column, i + 1) for i, column in enumerate(columns)
        ]

        update_columns = list(point_fields.keys())
        update_set = ", ".join(f"{col} = EXCLUDED.{col}" for col in update_columns)

        sql = (
            f"INSERT INTO points ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )
        await self._pool.execute(sql, *values)

    async def upsert_points_batch(self, rows: list[dict[str, object]]) -> int:
        """Batch upsert points. Returns the number of rows upserted."""
        if not rows:
            return 0

        prepared_rows = [_prepare_point_fields(row) for row in rows]
        first = prepared_rows[0]
        fields_sample = {k: v for k, v in first.items() if k != "id"}
        _validate_columns(_POINT_COLUMNS, fields_sample)

        columns = ["id"] + list(fields_sample.keys())
        placeholders = [
            _point_placeholder(column, i + 1) for i, column in enumerate(columns)
        ]
        update_set = ", ".join(f"{col} = EXCLUDED.{col}" for col in fields_sample)

        sql = (
            f"INSERT INTO points ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )

        args = [tuple(row.get(col) for col in columns) for row in prepared_rows]

        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.executemany(sql, args)

        return len(rows)
