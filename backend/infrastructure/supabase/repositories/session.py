"""Session and conversation operations."""

from __future__ import annotations

import json
from collections.abc import Mapping

from backend.infrastructure.supabase.client_types import AsyncPGPool, Row


class SessionRepository:
    """Session and conversation data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def get_session(self, session_id: str) -> Row | None:
        """Fetch a session by ID."""
        return await self._pool.fetchrow(
            "SELECT * FROM sessions WHERE id = $1", session_id
        )

    async def upsert_session(
        self,
        session_id: str,
        state: dict[str, object],
        metadata: dict[str, object] | None = None,
    ) -> None:
        """Create or update a session."""
        await self._pool.execute(
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
        await self._pool.execute(
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
            await self._pool.execute(
                """
                UPDATE conversations
                SET title = $1, updated_at = now()
                WHERE session_id = $2
                """,
                title,
                session_id,
            )
            return

        await self._pool.execute(
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
        rows = await self._pool.fetch(
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

    async def get_conversation(self, session_id: str) -> dict[str, object] | None:
        """Fetch a single conversation by session_id."""
        row = await self._pool.fetchrow(
            "SELECT session_id, user_id, title, first_query, created_at, updated_at FROM conversations WHERE session_id = $1",
            session_id,
        )
        return dict(row) if row else None

    async def upsert_session_state(
        self, session_id: str, state: dict[str, object]
    ) -> None:
        """Persist session state as JSONB."""
        await self._pool.execute(
            """INSERT INTO sessions (id, state, updated_at)
               VALUES ($1, $2::jsonb, now())
               ON CONFLICT (id)
               DO UPDATE SET state = $2::jsonb, updated_at = now()""",
            session_id,
            json.dumps(state, default=str),
        )

    async def get_session_state(self, session_id: str) -> dict[str, object] | None:
        """Load session state."""
        row = await self._pool.fetchrow(
            "SELECT state FROM sessions WHERE id = $1",
            session_id,
        )
        if not (row and row["state"]):
            return None
        raw = row["state"]
        if isinstance(raw, str):
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        if isinstance(raw, Mapping):
            return dict(raw)
        return None

    async def check_session_owner(self, session_id: str, user_id: str) -> bool:
        """Return True if the conversation belongs to the given user."""
        row = await self._pool.fetchrow(
            "SELECT 1 FROM conversations WHERE session_id = $1 AND user_id = $2",
            session_id,
            user_id,
        )
        return row is not None

    async def delete_session_state(self, session_id: str) -> None:
        """Delete session state by session ID."""
        await self._pool.execute("DELETE FROM sessions WHERE id = $1", session_id)
