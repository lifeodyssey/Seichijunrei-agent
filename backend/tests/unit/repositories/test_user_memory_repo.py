"""Unit tests for UserMemoryRepository."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.supabase.repositories.user_memory import (
    UserMemoryRepository,
)


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> UserMemoryRepository:
    return UserMemoryRepository(pool)


async def test_upsert_user_memory_inserts_new_anime(
    repo: UserMemoryRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    pool.execute.return_value = None
    await repo.upsert_user_memory("user-1", bangumi_id="115908", anime_title="Liz")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO user_memory" in sql
    saved_json = json.loads(pool.execute.await_args.args[2])
    assert len(saved_json) == 1
    assert saved_json[0]["bangumi_id"] == "115908"
    assert saved_json[0]["title"] == "Liz"


async def test_upsert_user_memory_updates_existing_anime(
    repo: UserMemoryRepository, pool: AsyncMock
) -> None:
    existing = [{"bangumi_id": "115908", "title": "Old Title", "last_at": "2026-01-01"}]
    pool.fetchrow.return_value = {"visited_anime": json.dumps(existing)}
    pool.execute.return_value = None
    await repo.upsert_user_memory(
        "user-1", bangumi_id="115908", anime_title="New Title"
    )
    saved_json = json.loads(pool.execute.await_args.args[2])
    assert len(saved_json) == 1
    assert saved_json[0]["title"] == "New Title"


async def test_get_user_memory_returns_parsed_data(
    repo: UserMemoryRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {
        "visited_anime": json.dumps([{"bangumi_id": "1", "title": "A"}]),
        "visited_points": json.dumps([]),
    }
    result = await repo.get_user_memory("user-1")
    assert result is not None
    assert len(result["visited_anime"]) == 1
    assert result["visited_points"] == []


async def test_get_user_memory_returns_none_when_missing(
    repo: UserMemoryRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.get_user_memory("nonexistent")
    assert result is None
