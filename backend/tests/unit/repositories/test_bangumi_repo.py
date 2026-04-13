"""Unit tests for BangumiRepository."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.supabase.repositories.bangumi import BangumiRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> BangumiRepository:
    return BangumiRepository(pool)


async def test_get_bangumi_returns_row_when_exists(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "115908", "title": "Liz and the Blue Bird"}
    result = await repo.get_bangumi("115908")
    assert result is not None
    assert result["id"] == "115908"
    assert result["title"] == "Liz and the Blue Bird"
    pool.fetchrow.assert_awaited_once_with(
        "SELECT * FROM bangumi WHERE id = $1", "115908"
    )


async def test_get_bangumi_returns_none_when_not_found(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.get_bangumi("nonexistent")
    assert result is None


async def test_get_bangumi_raises_on_pool_error(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.side_effect = RuntimeError("connection lost")
    with pytest.raises(RuntimeError, match="connection lost"):
        await repo.get_bangumi("115908")


async def test_list_bangumi_returns_list(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {"id": "1", "title": "A", "rating": 9.0},
        {"id": "2", "title": "B", "rating": 8.0},
    ]
    result = await repo.list_bangumi(limit=10)
    assert len(result) == 2
    pool.fetch.assert_awaited_once()


async def test_upsert_bangumi_calls_execute(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.upsert_bangumi("115908", title="Liz")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO bangumi" in sql
    assert "ON CONFLICT (id)" in sql


async def test_find_bangumi_by_title_returns_id(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "115908"}
    result = await repo.find_bangumi_by_title("Liz")
    assert result == "115908"


async def test_find_bangumi_by_title_returns_none(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    result = await repo.find_bangumi_by_title("nonexistent")
    assert result is None


async def test_get_bangumi_by_area_returns_dicts(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {"bangumi_id": "1", "bangumi_title": "A", "city": "Kyoto"}
    ]
    result = await repo.get_bangumi_by_area(34.88, 135.80)
    assert len(result) == 1
    assert result[0]["city"] == "Kyoto"
