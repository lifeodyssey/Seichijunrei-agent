"""Tests for SupabaseSessionStore with LRU write-through cache."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.session.supabase_session import SupabaseSessionStore


@pytest.fixture()
def mock_db() -> AsyncMock:
    db = AsyncMock()
    db.session.get_session_state.return_value = None
    db.session.upsert_session_state.return_value = None
    db.session.delete_session_state.return_value = None
    return db


async def test_save_and_get(mock_db: AsyncMock) -> None:
    store = SupabaseSessionStore(mock_db)
    state: dict[str, object] = {"interactions": [], "summary": "test"}
    await store.set("s1", state)

    # Should be in cache — no DB read needed
    result = await store.get("s1")
    assert result == state

    # DB write was called
    mock_db.session.upsert_session_state.assert_called_once_with("s1", state)
    # DB read was NOT called (served from cache)
    mock_db.session.get_session_state.assert_not_called()


async def test_cache_miss_reads_db(mock_db: AsyncMock) -> None:
    mock_db.session.get_session_state.return_value = {"interactions": [1]}
    store = SupabaseSessionStore(mock_db)

    result = await store.get("s1")
    assert result == {"interactions": [1]}
    mock_db.session.get_session_state.assert_called_once_with("s1")


async def test_get_returns_none_on_miss(mock_db: AsyncMock) -> None:
    store = SupabaseSessionStore(mock_db)

    result = await store.get("nonexistent")
    assert result is None
    mock_db.session.get_session_state.assert_called_once_with("nonexistent")


async def test_cache_eviction(mock_db: AsyncMock) -> None:
    store = SupabaseSessionStore(mock_db, cache_size=2)
    await store.set("s1", {"a": 1})
    await store.set("s2", {"b": 2})
    await store.set("s3", {"c": 3})  # evicts s1

    assert "s1" not in store._cache
    assert "s2" in store._cache
    assert "s3" in store._cache


async def test_delete(mock_db: AsyncMock) -> None:
    store = SupabaseSessionStore(mock_db)
    await store.set("s1", {"x": 1})

    await store.delete("s1")

    assert "s1" not in store._cache
    mock_db.session.delete_session_state.assert_called_once_with("s1")


async def test_delete_nonexistent(mock_db: AsyncMock) -> None:
    """Deleting a session that doesn't exist should not raise."""
    store = SupabaseSessionStore(mock_db)
    await store.delete("nonexistent")
    mock_db.session.delete_session_state.assert_called_once_with("nonexistent")
