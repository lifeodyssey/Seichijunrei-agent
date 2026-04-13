"""Unit tests for MessagesRepository."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.supabase.repositories.messages import MessagesRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> MessagesRepository:
    return MessagesRepository(pool)


async def test_insert_message_calls_execute(
    repo: MessagesRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.insert_message("sess-1", "user", "Hello")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO conversation_messages" in sql
    assert pool.execute.await_args.args[1] == "sess-1"
    assert pool.execute.await_args.args[2] == "user"
    assert pool.execute.await_args.args[3] == "Hello"
    assert pool.execute.await_args.args[4] is None


async def test_insert_message_with_response_data(
    repo: MessagesRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    data = {"ui": {"type": "search_results"}}
    await repo.insert_message("sess-1", "assistant", "Found results", data)
    call_args = pool.execute.await_args.args
    assert call_args[4] == json.dumps(data)


async def test_get_messages_returns_list(
    repo: MessagesRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {
            "role": "user",
            "content": "Hi",
            "response_data": None,
            "created_at": "2026-01-01",
        },
        {
            "role": "assistant",
            "content": "Hello",
            "response_data": None,
            "created_at": "2026-01-01",
        },
    ]
    result = await repo.get_messages("sess-1", limit=50)
    assert len(result) == 2
    assert result[0]["role"] == "user"
    assert result[1]["role"] == "assistant"


async def test_get_messages_empty_conversation(
    repo: MessagesRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = []
    result = await repo.get_messages("empty-sess")
    assert result == []
