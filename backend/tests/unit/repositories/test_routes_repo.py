"""Unit tests for RoutesRepository."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from backend.infrastructure.supabase.repositories.routes import RoutesRepository


@pytest.fixture
def pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture
def repo(pool: AsyncMock) -> RoutesRepository:
    return RoutesRepository(pool)


async def test_save_route_returns_route_id(
    repo: RoutesRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "route-uuid-789"}
    result = await repo.save_route(
        session_id="sess-1",
        bangumi_id="115908",
        point_ids=["p1", "p2", "p3"],
        route_data={"steps": [{"from": "p1", "to": "p2"}]},
        origin_station="Uji Station",
        origin_lat=34.88,
        origin_lon=135.80,
        total_distance=5200.0,
        total_duration=3600,
    )
    assert result == "route-uuid-789"
    pool.fetchrow.assert_awaited_once()
    sql = pool.fetchrow.await_args.args[0]
    assert "INSERT INTO routes" in sql
    assert "RETURNING id" in sql
    assert "ST_MakePoint" in sql


async def test_save_route_without_origin(
    repo: RoutesRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = {"id": "route-uuid-abc"}
    result = await repo.save_route(
        session_id="sess-1",
        bangumi_id="115908",
        point_ids=["p1"],
        route_data={},
    )
    assert result == "route-uuid-abc"
    sql = pool.fetchrow.await_args.args[0]
    # No-origin path uses NULL directly in SQL, no ST_MakePoint
    assert "NULL" in sql
    assert "ST_MakePoint" not in sql


async def test_save_route_raises_when_no_row(
    repo: RoutesRepository, pool: AsyncMock
) -> None:
    pool.fetchrow.return_value = None
    with pytest.raises(RuntimeError, match="save_route"):
        await repo.save_route(
            session_id="sess-1",
            bangumi_id="115908",
            point_ids=["p1"],
            route_data={},
        )


async def test_get_user_routes_returns_list(
    repo: RoutesRepository, pool: AsyncMock
) -> None:
    pool.fetch.return_value = [
        {
            "id": "r1",
            "bangumi_id": "115908",
            "bangumi_title": "Liz",
            "point_count": 3,
            "created_at": "2026-01-01",
            "origin_station": None,
        }
    ]
    result = await repo.get_user_routes("user-1", limit=5)
    assert len(result) == 1
    assert result[0]["bangumi_id"] == "115908"
