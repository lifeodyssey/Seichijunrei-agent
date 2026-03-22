"""Async Supabase client with PostGIS support.

Uses asyncpg for direct PostgreSQL connections (bypasses Supabase REST API
for better performance on geospatial queries). Connection pooling via
asyncpg.Pool.

Usage:
    async with SupabaseClient(dsn="postgresql://...") as db:
        bangumi = await db.get_bangumi("12345")
"""

from __future__ import annotations

import asyncpg
import structlog

logger = structlog.get_logger(__name__)

# Column allowlists — only these names may appear in dynamic SQL identifiers.
_BANGUMI_COLUMNS = frozenset({
    "title", "title_cn", "cover_url", "air_date", "summary",
    "eps_count", "rating", "points_count", "primary_color",
})
_POINT_COLUMNS = frozenset({
    "bangumi_id", "name", "cn_name", "episode", "time_seconds",
    "screenshot_url", "address", "origin", "origin_url", "opening_hours",
    "admission_fee", "location", "search_text",
})


def _validate_columns(columns: frozenset[str], fields: dict) -> None:
    """Raise ValueError if any field key is not in the allowlist."""
    bad = set(fields.keys()) - columns
    if bad:
        raise ValueError(f"Invalid column names: {bad}")


class SupabaseClient:
    """Async PostgreSQL client for Supabase.

    Wraps asyncpg with connection pooling. Designed for direct SQL access
    to leverage PostGIS geography queries that the
    Supabase REST API cannot express efficiently.

    Supports async context manager for safe lifecycle management:
        async with SupabaseClient(dsn) as db:
            ...
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

    async def __aenter__(self) -> SupabaseClient:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

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
        """Insert or update a bangumi record.

        Column names are validated against an allowlist to prevent SQL injection.
        """
        _validate_columns(_BANGUMI_COLUMNS, fields)
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

    async def upsert_point(self, point_id: str, **fields: object) -> None:
        """Insert or update a point record.

        Column names are validated against an allowlist to prevent SQL injection.
        """
        _validate_columns(_POINT_COLUMNS, fields)
        point_fields = dict(fields)
        location_wkt = point_fields.pop("location", None)

        columns = ["id"] + list(point_fields.keys())
        values: list[object] = [point_id] + list(point_fields.values())
        placeholders = [f"${i + 1}" for i in range(len(values))]

        if location_wkt is not None:
            columns.append("location")
            values.append(location_wkt)
            placeholders.append(f"ST_GeogFromText(${len(values)})")

        update_columns = list(point_fields.keys())
        update_set = ", ".join(f"{col} = EXCLUDED.{col}" for col in update_columns)
        if location_wkt is not None:
            if update_set:
                update_set = f"{update_set}, location = EXCLUDED.location"
            else:
                update_set = "location = EXCLUDED.location"

        sql = (
            f"INSERT INTO points ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )
        await self.pool.execute(sql, *values)

    async def upsert_points_batch(self, rows: list[dict]) -> int:
        """Batch upsert points using a prepared statement executed for each row.

        Each dict must contain 'id' + field values matching _POINT_COLUMNS.
        All rows must share the same set of columns (validated against first row).
        Returns the number of rows upserted.
        """
        if not rows:
            return 0

        first = rows[0]
        fields_sample = {k: v for k, v in first.items() if k != "id"}
        _validate_columns(_POINT_COLUMNS, fields_sample)

        location_present = "location" in fields_sample
        point_fields = {k: v for k, v in fields_sample.items() if k != "location"}

        columns = ["id"] + list(point_fields.keys())
        placeholders = [f"${i + 1}" for i in range(len(columns))]
        update_set = ", ".join(f"{col} = EXCLUDED.{col}" for col in point_fields)

        if location_present:
            columns.append("location")
            placeholders.append(f"ST_GeogFromText(${len(columns)})")
            update_set = f"{update_set}, location = EXCLUDED.location" if update_set else "location = EXCLUDED.location"

        sql = (
            f"INSERT INTO points ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )

        col_order = ["id"] + list(point_fields.keys())
        if location_present:
            col_order.append("location")

        args = [tuple(row.get(col) for col in col_order) for row in rows]

        async with self.pool.acquire() as conn:
            await conn.executemany(sql, args)

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
