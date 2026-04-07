"""User memory operations."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from backend.infrastructure.supabase.client_types import AsyncPGPool
from backend.infrastructure.supabase.helpers import _decode_json_list


class UserMemoryRepository:
    """User cross-session memory data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def upsert_user_memory(
        self,
        user_id: str,
        *,
        bangumi_id: str,
        anime_title: str | None,
    ) -> None:
        """Merge one anime into the user's cross-session memory."""
        row = await self._pool.fetchrow(
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

        await self._pool.execute(
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
        row = await self._pool.fetchrow(
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
