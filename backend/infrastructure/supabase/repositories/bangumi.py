"""Bangumi table operations."""

from __future__ import annotations

from backend.infrastructure.supabase.client_types import AsyncPGPool, Row
from backend.infrastructure.supabase.helpers import (
    _BANGUMI_COLUMNS,
    _validate_columns,
)


class BangumiRepository:
    """Bangumi table data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def get_bangumi(self, bangumi_id: str) -> Row | None:
        """Fetch a single bangumi by ID."""
        return await self._pool.fetchrow(
            "SELECT * FROM bangumi WHERE id = $1", bangumi_id
        )

    async def list_bangumi(self, *, limit: int = 50) -> list[Row]:
        """List bangumi ordered by rating."""
        return await self._pool.fetch(
            "SELECT * FROM bangumi ORDER BY rating DESC NULLS LAST LIMIT $1",
            limit,
        )

    async def upsert_bangumi(self, bangumi_id: str, **fields: object) -> None:
        """Insert or update a bangumi record."""
        _validate_columns(_BANGUMI_COLUMNS, fields)
        columns = ["id"] + list(fields.keys())
        placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
        update_set = ", ".join(f"{col} = EXCLUDED.{col}" for col in fields.keys())
        sql = (
            f"INSERT INTO bangumi ({', '.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )
        await self._pool.execute(sql, bangumi_id, *fields.values())

    async def get_bangumi_by_area(
        self, lat: float, lng: float, radius_m: int = 50000
    ) -> list[dict[str, object]]:
        """Find bangumi whose known points are near a location."""
        rows = await self._pool.fetch(
            """SELECT DISTINCT b.id AS bangumi_id, b.title AS bangumi_title, b.city
               FROM points p
               JOIN bangumi b ON p.bangumi_id = b.id
               WHERE ST_DWithin(
                   COALESCE(
                       p.location,
                       ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
                   ),
                   ST_MakePoint($1, $2)::geography,
                   $3
               )
               LIMIT 10""",
            lng,
            lat,
            radius_m,
        )
        return [dict(r) for r in rows]

    async def find_bangumi_by_title(self, title: str) -> str | None:
        """Find a bangumi ID by matching title or title_cn."""
        row = await self._pool.fetchrow(
            """
            SELECT id FROM bangumi
            WHERE title ILIKE $1 OR title_cn ILIKE $1
            LIMIT 1
            """,
            f"%{title}%",
        )
        return str(row["id"]) if row else None

    async def upsert_bangumi_title(self, title: str, bangumi_id: str) -> None:
        """Insert a bangumi title if the bangumi row does not already exist."""
        await self._pool.execute(
            """
            INSERT INTO bangumi (id, title)
            VALUES ($1, $2)
            ON CONFLICT (id) DO NOTHING
            """,
            bangumi_id,
            title,
        )
