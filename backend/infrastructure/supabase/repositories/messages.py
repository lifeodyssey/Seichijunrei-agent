"""Conversation messages operations."""

from __future__ import annotations

import json

from backend.infrastructure.supabase.client_types import AsyncPGPool


class MessagesRepository:
    """Conversation messages data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

    async def insert_message(
        self,
        session_id: str,
        role: str,
        content: str,
        response_data: dict[str, object] | None = None,
    ) -> None:
        """Persist a chat message to conversation_messages."""
        await self._pool.execute(
            """INSERT INTO conversation_messages (session_id, role, content, response_data)
               VALUES ($1, $2, $3, $4::jsonb)""",
            session_id,
            role,
            content,
            json.dumps(response_data) if response_data else None,
        )

    async def get_messages(
        self, session_id: str, limit: int = 100
    ) -> list[dict[str, object]]:
        """Fetch chat messages for a conversation."""
        rows = await self._pool.fetch(
            """SELECT role, content, response_data, created_at
               FROM conversation_messages
               WHERE session_id = $1
               ORDER BY created_at ASC
               LIMIT $2""",
            session_id,
            limit,
        )
        return [dict(r) for r in rows]
