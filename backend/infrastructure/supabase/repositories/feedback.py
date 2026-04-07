"""Feedback and request_log operations."""

from __future__ import annotations

import json

from backend.infrastructure.supabase.client_types import AsyncPGPool
from backend.infrastructure.supabase.helpers import _require_row


class FeedbackRepository:
    """Feedback and request log data access."""

    def __init__(self, pool: AsyncPGPool) -> None:
        self._pool = pool

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
            await self._pool.fetchrow(
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
        """Write one request log row for eval/monitoring."""
        row = _require_row(
            await self._pool.fetchrow(
                """
                INSERT INTO request_log (
                    session_id, query_text, locale, plan_steps,
                    intent, status, latency_ms
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
        rows = await self._pool.fetch(
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
        rows = await self._pool.fetch(
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
        await self._pool.execute(
            "UPDATE request_log SET plan_quality_score = $1 WHERE id = $2",
            score,
            log_id,
        )
