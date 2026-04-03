"""Async Supabase client with PostGIS support.

Uses asyncpg for direct PostgreSQL connections (bypasses Supabase REST API
for better performance on geospatial queries). Connection pooling via
asyncpg.Pool.

Usage:
    async with SupabaseClient(dsn="postgresql://...") as db:
        bangumi = await db.get_bangumi("12345")
"""

from __future__ import annotations

import importlib
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from numbers import Real
from types import TracebackType
from typing import Protocol, TypeAlias, cast

import structlog

logger = structlog.get_logger(__name__)

Row: TypeAlias = Mapping[str, object]


class AsyncPGTransactionContext(Protocol):
    async def __aenter__(self) -> object: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> object: ...


class AsyncPGConnection(Protocol):
    def transaction(self) -> AsyncPGTransactionContext: ...

    async def executemany(
        self, command: str, args: Sequence[Sequence[object]]
    ) -> object: ...


class AsyncPGAcquireContext(Protocol):
    async def __aenter__(self) -> AsyncPGConnection: ...

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> object: ...


class AsyncPGPool(Protocol):
    async def fetchrow(self, query: str, *args: object) -> Row | None: ...

    async def fetch(self, query: str, *args: object) -> list[Row]: ...

    async def execute(self, query: str, *args: object) -> str | None: ...

    def acquire(self) -> AsyncPGAcquireContext: ...

    async def close(self) -> None: ...


class AsyncPGModule(Protocol):
    async def create_pool(
        self,
        dsn: str,
        *,
        min_size: int,
        max_size: int,
    ) -> AsyncPGPool: ...


asyncpg = cast(AsyncPGModule, importlib.import_module("asyncpg"))

# Column allowlists — only these names may appear in dynamic SQL identifiers.
_BANGUMI_COLUMNS = frozenset(
    {
        "title",
        "title_cn",
        "cover_url",
        "air_date",
        "summary",
        "eps_count",
        "rating",
        "points_count",
        "primary_color",
    }
)
_POINT_COLUMNS = frozenset(
    {
        "bangumi_id",
        "name",
        "name_cn",
        "latitude",
        "longitude",
        "episode",
        "time_seconds",
        "image",
        "scene_desc",
        "embedding",
        "origin",
        "origin_url",
        "location",
    }
)


def _validate_columns(columns: frozenset[str], fields: Mapping[str, object]) -> None:
    """Raise ValueError if any field key is not in the allowlist."""
    bad = set(fields.keys()) - columns
    if bad:
        raise ValueError(f"Invalid column names: {bad}")


def _vector_literal(value: object) -> str:
    """Normalize a vector value into pgvector's text literal format."""
    if isinstance(value, str):
        return value

    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        items: list[str] = []
        for item in value:
            if not isinstance(item, Real):
                raise TypeError("Embedding values must be numeric")
            items.append(f"{float(item):g}")
        return f"[{','.join(items)}]"

    raise TypeError("Embedding must be a vector literal string or numeric sequence")


def _prepare_point_fields(fields: dict[str, object]) -> dict[str, object]:
    """Normalize point payloads before building dynamic SQL."""
    prepared = dict(fields)
    if "embedding" in prepared and prepared["embedding"] is not None:
        prepared["embedding"] = _vector_literal(prepared["embedding"])
    return prepared


def _decode_json_list(raw: object) -> list[dict[str, object]]:
    """Decode a JSON/JSONB payload into a list of dicts."""
    if raw is None:
        return []
    if isinstance(raw, str):
        decoded = json.loads(raw)
    elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
        decoded = raw
    else:
        return []

    if not isinstance(decoded, Sequence):
        return []

    return [dict(item) for item in decoded if isinstance(item, Mapping)]


def _point_placeholder(column: str, position: int) -> str:
    """Return the SQL placeholder for a point column."""
    if column == "location":
        return f"ST_GeogFromText(${position})"
    if column == "embedding":
        return f"${position}::vector"
    return f"${position}"


def _require_row(row: Row | None, *, operation: str) -> Row:
    if row is None:
        raise RuntimeError(f"Database did not return a row for {operation}")
    return row


class SupabaseClient:
    """Async PostgreSQL client for Supabase.

    Wraps asyncpg with connection pooling. Designed for direct SQL access
    to leverage PostGIS geography queries that the
    Supabase REST API cannot express efficiently.

    Supports async context manager for safe lifecycle management:
        async with SupabaseClient(dsn) as db:
            ...
    """

    def __init__(
        self, dsn: str, *, min_pool_size: int = 2, max_pool_size: int = 10
    ) -> None:
        self._dsn = dsn
        self._min_pool_size = min_pool_size
        self._max_pool_size = max_pool_size
        self._pool: AsyncPGPool | None = None

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
    def pool(self) -> AsyncPGPool:
        """Get the connection pool (raises if not connected)."""
        if self._pool is None:
            raise RuntimeError("SupabaseClient not connected. Call connect() first.")
        return self._pool

    # --- Bangumi ---

    async def get_bangumi(self, bangumi_id: str) -> Row | None:
        """Fetch a single bangumi by ID."""
        return await self.pool.fetchrow(
            "SELECT * FROM bangumi WHERE id = $1", bangumi_id
        )

    async def list_bangumi(self, *, limit: int = 50) -> list[Row]:
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
        update_set = ", ".join(f"{col} = EXCLUDED.{col}" for col in fields.keys())
        sql = (
            f"INSERT INTO bangumi ({', '.join(columns)}) VALUES ({placeholders}) "
            f"ON CONFLICT (id) DO UPDATE SET {update_set}"
        )
        await self.pool.execute(sql, bangumi_id, *fields.values())

    async def find_bangumi_by_title(self, title: str) -> str | None:
        """Find a bangumi ID by matching title or title_cn."""
        row = await self.pool.fetchrow(
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
        await self.pool.execute(
            """
            INSERT INTO bangumi (id, title)
            VALUES ($1, $2)
            ON CONFLICT (id) DO NOTHING
            """,
            bangumi_id,
            title,
        )

    # --- Points ---

    async def get_points_by_bangumi(self, bangumi_id: str) -> list[Row]:
        """Fetch all points for a bangumi."""
        return await self.pool.fetch(
            "SELECT * FROM points WHERE bangumi_id = $1 ORDER BY episode, time_seconds",
            bangumi_id,
        )

    async def get_points_by_ids(self, point_ids: list[str]) -> list[dict[str, object]]:
        """Fetch specific points by ID, preserving the input order."""
        if not point_ids:
            return []

        rows = await self.pool.fetch(
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
        return await self.pool.fetch(
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
        """Insert or update a point record.

        Column names are validated against an allowlist to prevent SQL injection.
        """
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
        await self.pool.execute(sql, *values)

    async def upsert_points_batch(self, rows: list[dict[str, object]]) -> int:
        """Batch upsert points using a prepared statement executed for each row.

        Each dict must contain 'id' + field values matching _POINT_COLUMNS.
        All rows must share the same set of columns (validated against first row).
        Returns the number of rows upserted.
        """
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

        async with self.pool.acquire() as conn:
            async with conn.transaction():
                await conn.executemany(sql, args)

        return len(rows)

    # --- Sessions ---

    async def get_session(self, session_id: str) -> Row | None:
        """Fetch a session by ID."""
        return await self.pool.fetchrow(
            "SELECT * FROM sessions WHERE id = $1", session_id
        )

    async def upsert_session(
        self,
        session_id: str,
        state: dict[str, object],
        metadata: dict[str, object] | None = None,
    ) -> None:
        """Create or update a session."""
        await self.pool.execute(
            """
            INSERT INTO sessions (id, state, metadata) VALUES ($1, $2::jsonb, $3::jsonb)
            ON CONFLICT (id) DO UPDATE SET state = $2::jsonb, metadata = COALESCE($3::jsonb, sessions.metadata)
            """,
            session_id,
            json.dumps(state),
            json.dumps(metadata or {}),
        )

    async def upsert_conversation(
        self,
        session_id: str,
        user_id: str,
        first_query: str,
    ) -> None:
        """Create a conversation row or touch its updated timestamp."""
        await self.pool.execute(
            """
            INSERT INTO conversations (session_id, user_id, first_query)
            VALUES ($1, $2, $3)
            ON CONFLICT (session_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                updated_at = now()
            """,
            session_id,
            user_id,
            first_query,
        )

    async def update_conversation_title(
        self,
        session_id: str,
        title: str,
        *,
        user_id: str | None = None,
    ) -> None:
        """Set the generated or user-supplied title for a conversation."""
        if user_id is None:
            await self.pool.execute(
                """
                UPDATE conversations
                SET title = $1, updated_at = now()
                WHERE session_id = $2
                """,
                title,
                session_id,
            )
            return

        await self.pool.execute(
            """
            UPDATE conversations
            SET title = $1, updated_at = now()
            WHERE session_id = $2 AND user_id = $3
            """,
            title,
            session_id,
            user_id,
        )

    async def get_conversations(
        self,
        user_id: str,
        *,
        limit: int = 30,
    ) -> list[dict[str, object]]:
        """Return a user's conversations, most recent first."""
        rows = await self.pool.fetch(
            """
            SELECT session_id, title, first_query, created_at, updated_at
            FROM conversations
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT $2
            """,
            user_id,
            limit,
        )
        return [dict(row) for row in rows]

    async def upsert_user_memory(
        self,
        user_id: str,
        *,
        bangumi_id: str,
        anime_title: str | None,
    ) -> None:
        """Merge one anime into the user's cross-session memory."""
        row = await self.pool.fetchrow(
            "SELECT visited_anime FROM user_memory WHERE user_id = $1",
            user_id,
        )
        visited = _decode_json_list(row["visited_anime"]) if row is not None else []

        now = datetime.now(UTC).isoformat()
        existing = next(
            (entry for entry in visited if entry.get("bangumi_id") == bangumi_id),
            None,
        )
        if existing is not None:
            existing["last_at"] = now
            if anime_title:
                existing["title"] = anime_title
        else:
            visited.append(
                {
                    "bangumi_id": bangumi_id,
                    "title": anime_title or "",
                    "last_at": now,
                }
            )

        await self.pool.execute(
            """
            INSERT INTO user_memory (user_id, visited_anime, updated_at)
            VALUES ($1, $2::jsonb, now())
            ON CONFLICT (user_id) DO UPDATE SET
                visited_anime = $2::jsonb,
                updated_at = now()
            """,
            user_id,
            json.dumps(visited),
        )

    async def get_user_memory(
        self, user_id: str
    ) -> dict[str, list[dict[str, object]]] | None:
        """Return parsed cross-session user memory."""
        row = await self.pool.fetchrow(
            """
            SELECT visited_anime, visited_points
            FROM user_memory
            WHERE user_id = $1
            """,
            user_id,
        )
        if row is None:
            return None

        return {
            "visited_anime": _decode_json_list(row["visited_anime"]),
            "visited_points": _decode_json_list(row["visited_points"]),
        }

    # --- Routes ---

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
        import datetime as dt
        import json

        def _default(o: object) -> object:
            if isinstance(o, (dt.datetime, dt.date)):
                return o.isoformat()
            raise TypeError(f"Not serializable: {type(o).__name__}")

        origin_location = (
            f"POINT({origin_lon} {origin_lat})" if origin_lat and origin_lon else None
        )
        row = _require_row(
            await self.pool.fetchrow(
                """
                INSERT INTO routes (session_id, bangumi_id, origin_station, origin_location,
                                    point_ids, total_distance, total_duration, route_data)
                VALUES ($1, $2, $3, ST_GeogFromText($4), $5, $6, $7, $8::jsonb)
                RETURNING id
                """,
                session_id,
                bangumi_id,
                origin_station,
                origin_location,
                point_ids,
                total_distance,
                total_duration,
                json.dumps(route_data, default=_default),
            ),
            operation="save_route",
        )
        return str(row["id"])

    # --- Feedback ---

    async def save_feedback(
        self,
        session_id: str | None,
        query_text: str,
        intent: str | None,
        rating: str,
        comment: str | None = None,
    ) -> str:
        """Save user feedback for a response. Returns the feedback UUID."""
        row = _require_row(
            await self.pool.fetchrow(
                """
                INSERT INTO feedback (session_id, query_text, intent, rating, comment)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                """,
                session_id,
                query_text,
                intent,
                rating,
                comment,
            ),
            operation="save_feedback",
        )
        return str(row["id"])

    async def insert_request_log(
        self,
        *,
        session_id: str | None,
        query_text: str,
        locale: str,
        plan_steps: list[str] | None,
        intent: str | None,
        status: str,
        latency_ms: int | None,
    ) -> str:
        """Write one request log row for eval/monitoring (best-effort at call site)."""
        import json

        row = _require_row(
            await self.pool.fetchrow(
                """
                INSERT INTO request_log (
                    session_id,
                    query_text,
                    locale,
                    plan_steps,
                    intent,
                    status,
                    latency_ms
                )
                VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
                RETURNING id
                """,
                session_id,
                query_text,
                locale,
                json.dumps(plan_steps) if plan_steps is not None else None,
                intent,
                status,
                latency_ms,
            ),
            operation="insert_request_log",
        )
        return str(row["id"])

    async def fetch_bad_feedback(self, *, limit: int = 100) -> list[dict[str, object]]:
        """Return rows from feedback table where rating = 'bad'."""
        rows = await self.pool.fetch(
            """
            SELECT id, query_text, intent, comment, created_at
            FROM feedback
            WHERE rating = 'bad'
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )
        return [dict(r) for r in rows]

    async def fetch_request_log_unscored(
        self, *, limit: int = 200
    ) -> list[dict[str, object]]:
        """Return request_log rows that have not yet been scored."""
        rows = await self.pool.fetch(
            """
            SELECT id, query_text, locale, plan_steps, intent
            FROM request_log
            WHERE plan_quality_score IS NULL
              AND status = 'ok'
            ORDER BY created_at DESC
            LIMIT $1
            """,
            limit,
        )
        return [dict(r) for r in rows]

    async def update_request_log_score(self, *, log_id: str, score: float) -> None:
        """Write the LLM-assigned quality score back to a request_log row."""
        await self.pool.execute(
            "UPDATE request_log SET plan_quality_score = $1 WHERE id = $2",
            score,
            log_id,
        )
