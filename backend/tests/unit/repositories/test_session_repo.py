"""Unit tests for SessionRepository."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.supabase.repositories.session import SessionRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> SessionRepository:
    return SessionRepository(pool)


async def test_upsert_session_calls_execute_with_correct_params(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    state = {"context": {"bangumi_id": "115908"}}
    metadata = {"locale": "ja"}
    await repo.upsert_session("sess-1", state, metadata)
    pool.execute.assert_awaited_once()
    call_args = pool.execute.await_args.args
    assert "INSERT INTO sessions" in call_args[0]
    assert call_args[1] == "sess-1"
    assert call_args[2] == json.dumps(state)
    assert call_args[3] == json.dumps(metadata)


async def test_upsert_session_defaults_metadata_to_empty(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.upsert_session("sess-1", {"key": "val"})
    call_args = pool.execute.await_args.args
    assert call_args[3] == json.dumps({})


async def test_get_session_returns_row(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "sess-1", "state": "{}"}
    result = await repo.get_session("sess-1")
    assert result is not None
    assert result["id"] == "sess-1"


async def test_get_session_returns_none(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.get_session("missing")
    assert result is None


async def test_upsert_conversation_calls_execute(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.upsert_conversation("sess-1", "user-1", "Where is Liz filmed?")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO conversations" in sql


async def test_get_session_state_returns_dict(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"state": json.dumps({"bangumi_id": "1"})}
    result = await repo.get_session_state("sess-1")
    assert result == {"bangumi_id": "1"}


async def test_get_session_state_returns_none_when_missing(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.get_session_state("missing")
    assert result is None


async def test_delete_session_state_calls_execute(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.delete_session_state("sess-1")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "DELETE FROM sessions" in sql


async def test_check_session_owner_returns_true_when_owned(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"?column?": 1}
    result = await repo.check_session_owner("sess-1", "user-1")
    assert result is True
    pool.fetchrow.assert_awaited_once()


async def test_check_session_owner_returns_false_when_not_owned(
    repo: SessionRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.check_session_owner("sess-1", "user-999")
    assert result is False
