"""Unit tests for FeedbackRepository."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.supabase.repositories.feedback import FeedbackRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> FeedbackRepository:
    return FeedbackRepository(pool)


async def test_save_feedback_returns_feedback_id(
    repo: FeedbackRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "fb-uuid-123"}
    result = await repo.save_feedback(
        session_id="sess-1",
        query_text="Where is Liz filmed?",
        intent="search_anime",
        rating="good",
        comment="Helpful!",
    )
    assert result == "fb-uuid-123"
    pool.fetchrow.assert_awaited_once()
    sql = pool.fetchrow.await_args.args[0]
    assert "INSERT INTO feedback" in sql
    assert "RETURNING id" in sql


async def test_save_feedback_raises_when_no_row_returned(
    repo: FeedbackRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    with pytest.raises(RuntimeError, match="save_feedback"):
        await repo.save_feedback(
            session_id="sess-1",
            query_text="test",
            intent=None,
            rating="bad",
        )


async def test_insert_request_log_returns_id(
    repo: FeedbackRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "log-uuid-456"}
    result = await repo.insert_request_log(
        session_id="sess-1",
        query_text="test query",
        locale="ja",
        plan_steps=["resolve_anime", "search_bangumi"],
        intent="search",
        status="ok",
        latency_ms=120,
    )
    assert result == "log-uuid-456"


async def test_fetch_bad_feedback_returns_list(
    repo: FeedbackRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {
            "id": "1",
            "query_text": "bad result",
            "intent": None,
            "comment": "wrong",
            "created_at": "2026-01-01",
        }
    ]
    result = await repo.fetch_bad_feedback(limit=10)
    assert len(result) == 1
    assert result[0]["query_text"] == "bad result"


async def test_update_request_log_score_calls_execute(
    repo: FeedbackRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.update_request_log_score(log_id="log-1", score=0.85)
    pool.execute.assert_awaited_once()
    call_args = pool.execute.await_args.args
    assert "UPDATE request_log" in call_args[0]
    assert call_args[1] == 0.85
    assert call_args[2] == "log-1"
