"""Unit tests for PointsRepository."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.supabase.repositories.points import PointsRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> PointsRepository:
    return PointsRepository(pool)


async def test_get_points_by_bangumi_returns_list(
    repo: PointsRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {"id": "p1", "bangumi_id": "115908", "name": "Uji Bridge"},
        {"id": "p2", "bangumi_id": "115908", "name": "Station"},
    ]
    result = await repo.get_points_by_bangumi("115908")
    assert isinstance(result, list)
    assert len(result) == 2
    pool.fetch.assert_awaited_once()


async def test_get_points_by_bangumi_returns_empty_list(
    repo: PointsRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = []
    result = await repo.get_points_by_bangumi("nonexistent")
    assert result == []


async def test_get_points_by_ids_returns_ordered_dicts(
    repo: PointsRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {"id": "p1", "name": "A"},
        {"id": "p2", "name": "B"},
    ]
    result = await repo.get_points_by_ids(["p1", "p2"])
    assert len(result) == 2
    assert result[0]["id"] == "p1"


async def test_get_points_by_ids_empty_input(
    repo: PointsRepository, pool: AsyncMock
) -> None:
    result = await repo.get_points_by_ids([])
    assert result == []
    pool.fetch.assert_not_awaited()


async def test_search_points_by_location_returns_rows(
    repo: PointsRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [{"id": "p1", "distance_m": 100.0}]
    result = await repo.search_points_by_location(34.88, 135.80, 5000)
    assert len(result) == 1
    pool.fetch.assert_awaited_once()


async def test_upsert_point_calls_execute(
    repo: PointsRepository, pool: AsyncMock
) -> None:
    pool.execute.return_value = None
    await repo.upsert_point("p1", bangumi_id="115908", name="Uji")
    pool.execute.assert_awaited_once()
    sql = pool.execute.await_args.args[0]
    assert "INSERT INTO points" in sql
    assert "ON CONFLICT (id)" in sql
