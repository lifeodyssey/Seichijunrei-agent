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

    async def list_popular(self, *, limit: int = 8) -> list[dict[str, object]]:
        """List popular bangumi by rating, only those with points."""
        rows = await self._pool.fetch(
            """SELECT id, title, title_cn, cover_url, city, points_count, rating
               FROM bangumi
               WHERE points_count > 0
               ORDER BY rating DESC NULLS LAST
               LIMIT $1""",
            limit,
        )
        return [dict(r) for r in rows]

    async def get_bangumi_by_area(
        self, lat: float, lng: float, radius_m: int = 50000
    ) -> list[dict[str, object]]:
        """Find bangumi whose known points are near a location."""
        rows = await self._pool.fetch(
            """SELECT DISTINCT b.id AS bangumi_id, b.title AS bangumi_title,
                      b.title_cn, b.cover_url, b.city,
                      COUNT(p.id) AS points_count
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
               GROUP BY b.id, b.title, b.title_cn, b.cover_url, b.city
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

    async def find_all_by_title(self, title: str) -> list[dict[str, object]]:
        """Find all bangumi matching a title pattern.

        Used for ambiguity detection: if len(results) > 1, the query is ambiguous.
        """
        rows = await self._pool.fetch(
            """
            SELECT id, title, title_cn,
                   COALESCE(cover_url, '') AS cover_url,
                   COALESCE(city, '') AS city,
                   COALESCE(points_count, 0) AS points_count
            FROM bangumi
            WHERE title ILIKE $1 OR title_cn ILIKE $1
            ORDER BY points_count DESC NULLS LAST
            LIMIT 10
            """,
            f"%{title}%",
        )
        return [dict(r) for r in rows]

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

    async def find_candidate_details_by_titles(
        self, titles: list[str]
    ) -> list[dict[str, object]]:
        """Lookup candidate details for a list of titles, preserving input order.

        This is used to enrich clarification candidates with cover/city/spot_count
        without requiring the frontend to guess or synthesize fields.
        """
        if not titles:
            return []

        rows = await self._pool.fetch(
            """
            SELECT
              requested.title AS title,
              b.id AS bangumi_id,
              COALESCE(b.cover_url_local, b.cover_url, b.cover_url_upstream) AS cover_url,
              COALESCE(b.city, '') AS city,
              COALESCE(b.points_count, 0) AS points_count
            FROM unnest($1::text[]) WITH ORDINALITY AS requested(title, ord)
            LEFT JOIN LATERAL (
              SELECT id, cover_url, cover_url_local, cover_url_upstream, city, points_count
              FROM bangumi
              WHERE title ILIKE requested.title OR title_cn ILIKE requested.title
              ORDER BY points_count DESC NULLS LAST
              LIMIT 1
            ) b ON TRUE
            ORDER BY requested.ord
            """,
            titles,
        )
        return [dict(r) for r in rows]
