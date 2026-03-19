"""Async Supabase client with pgvector and PostGIS support.

Uses asyncpg for direct PostgreSQL connections (bypasses Supabase REST API
for better performance on vector/geo queries). Connection pooling via
asyncpg.Pool.

Usage:
    client = SupabaseClient(dsn="postgresql://...")
    await client.connect()
    bangumi = await client.get_bangumi("12345")
    await client.close()
"""

from __future__ import annotations

import asyncpg
import structlog

logger = structlog.get_logger(__name__)


class SupabaseClient:
    """Async PostgreSQL client for Supabase.

    Wraps asyncpg with connection pooling. Designed for direct SQL access
    to leverage pgvector HNSW and PostGIS geography queries that the
    Supabase REST API cannot express efficiently.
    """

    def __init__(self, dsn: str, *, min_pool_size: int = 2, max_pool_size: int = 10) -> None:
        self._dsn = dsn
        self._min_pool_size = min_pool_size
        self._max_pool_size = max_pool_size
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        """Create the connection pool."""
        if self._pool is not None:
            return
        self._pool = await asyncpg.create_pool(
            self._dsn,
            min_size=self._min_pool_size,
            max_size=self._max_pool_size,
        )
        logger.info("supabase_connected", pool_size=self._max_pool_size)

    async def close(self) -> None:
        """Close the connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            logger.info("supabase_disconnected")

    @property
    def pool(self) -> asyncpg.Pool:
        """Get the connection pool (raises if not connected)."""
        if self._pool is None:
            raise RuntimeError("SupabaseClient not connected. Call connect() first.")
        return self._pool

    # --- Bangumi ---

    async def get_bangumi(self, bangumi_id: str) -> asyncpg.Record | None:
        """Fetch a single bangumi by ID."""
        return await self.pool.fetchrow(
            "SELECT * FROM bangumi WHERE id = $1", bangumi_id
        )

    async def list_bangumi(self, *, limit: int = 50) -> list[asyncpg.Record]:
        """List bangumi ordered by rating."""
        return await self.pool.fetch(
            "SELECT * FROM bangumi ORDER BY rating DESC NULLS LAST LIMIT $1",
            limit,
        )

    async def upsert_bangumi(self, bangumi_id: str, **fields: object) -> None:
        """Insert or update a bangumi record."""
        columns = ["id"] + list(fields.keys())
        placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
        update_set = ", ".join(
            f"{col} = EXCLUDED.{col}" for col in fields.keys()
        )
        sql = (
            f"INSERT INTO bangumi ({', '.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )
        await self.pool.execute(sql, bangumi_id, *fields.values())

    # --- Points ---

    async def get_points_by_bangumi(self, bangumi_id: str) -> list[asyncpg.Record]:
        """Fetch all points for a bangumi."""
        return await self.pool.fetch(
            "SELECT * FROM points WHERE bangumi_id = $1 ORDER BY episode, time_seconds",
            bangumi_id,
        )

    async def search_points_by_location(
        self,
        lat: float,
        lon: float,
        radius_m: float = 5000,
        *,
        limit: int = 50,
    ) -> list[asyncpg.Record]:
        """Find points within radius of a location using PostGIS."""
        return await self.pool.fetch(
            """
            SELECT *, ST_Distance(location, ST_MakePoint($1, $2)::geography) AS distance_m
            FROM points
            WHERE ST_DWithin(location, ST_MakePoint($1, $2)::geography, $3)
            ORDER BY distance_m
            LIMIT $4
            """,
            lon, lat, radius_m, limit,
        )

    async def search_points_by_embedding(
        self,
        embedding: list[float],
        *,
        limit: int = 10,
        bangumi_id: str | None = None,
    ) -> list[asyncpg.Record]:
        """Semantic search using pgvector cosine similarity."""
        if bangumi_id:
            return await self.pool.fetch(
                """
                SELECT *, 1 - (embedding <=> $1::vector) AS similarity
                FROM points
                WHERE bangumi_id = $2
                ORDER BY embedding <=> $1::vector
                LIMIT $3
                """,
                str(embedding), bangumi_id, limit,
            )
        return await self.pool.fetch(
            """
            SELECT *, 1 - (embedding <=> $1::vector) AS similarity
            FROM points
            ORDER BY embedding <=> $1::vector
            LIMIT $2
            """,
            str(embedding), limit,
        )

    async def upsert_point(self, point_id: str, **fields: object) -> None:
        """Insert or update a point record."""
        columns = ["id"] + list(fields.keys())
        placeholders = ", ".join(f"${i + 1}" for i in range(len(columns)))
        update_set = ", ".join(f"{col} = EXCLUDED.{col}" for col in fields.keys())
        sql = (
            f"INSERT INTO points ({', '.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )
        await self.pool.execute(sql, point_id, *fields.values())

    async def upsert_points_batch(self, rows: list[dict]) -> int:
        """Batch upsert points. Each dict must contain 'id' + field values.

        Returns the number of rows upserted.
        """
        if not rows:
            return 0
        for row in rows:
            pid = row.pop("id")
            await self.upsert_point(pid, **row)
            row["id"] = pid  # restore
        return len(rows)

    # --- Sessions ---

    async def get_session(self, session_id: str) -> asyncpg.Record | None:
        """Fetch a session by ID."""
        return await self.pool.fetchrow(
            "SELECT * FROM sessions WHERE id = $1", session_id
        )

    async def upsert_session(self, session_id: str, state: dict, metadata: dict | None = None) -> None:
        """Create or update a session."""
        import json

        await self.pool.execute(
            """
            INSERT INTO sessions (id, state, metadata) VALUES ($1, $2::jsonb, $3::jsonb)
            ON CONFLICT (id) DO UPDATE SET state = $2::jsonb, metadata = COALESCE($3::jsonb, sessions.metadata)
            """,
            session_id, json.dumps(state), json.dumps(metadata or {}),
        )

    # --- Routes ---

    async def save_route(
        self,
        session_id: str,
        bangumi_id: str,
        point_ids: list[str],
        route_data: dict,
        *,
        origin_station: str | None = None,
        origin_lat: float | None = None,
        origin_lon: float | None = None,
        total_distance: float | None = None,
        total_duration: int | None = None,
    ) -> str:
        """Save a computed route. Returns the generated route UUID."""
        import json

        origin_location = (
            f"POINT({origin_lon} {origin_lat})" if origin_lat and origin_lon else None
        )
        row = await self.pool.fetchrow(
            """
            INSERT INTO routes (session_id, bangumi_id, origin_station, origin_location,
                                point_ids, total_distance, total_duration, route_data)
            VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, $8::jsonb)
            RETURNING id
            """,
            session_id, bangumi_id, origin_station, origin_location,
            point_ids, total_distance, total_duration, json.dumps(route_data),
        )
        return str(row["id"])
