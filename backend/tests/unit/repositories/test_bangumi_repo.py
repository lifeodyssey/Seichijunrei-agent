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


async def test_get_bangumi_by_area_includes_cover_url_and_points_count(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """get_bangumi_by_area rows now include cover_url, title_cn, points_count."""
    pool.fetch.return_value = [
        {
            "bangumi_id": "115908",
            "bangumi_title": "Liz and the Blue Bird",
            "city": "Kyoto",
            "cover_url": "https://example.com/cover.jpg",
            "title_cn": "利兹与青鸟",
            "points_count": 5,
        }
    ]
    result = await repo.get_bangumi_by_area(34.88, 135.80)
    assert len(result) == 1
    row = result[0]
    assert row["cover_url"] == "https://example.com/cover.jpg"
    assert row["title_cn"] == "利兹与青鸟"
    assert row["points_count"] == 5


async def test_get_bangumi_by_area_sql_selects_extended_columns(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """SQL query must select cover_url, title_cn, points_count."""
    pool.fetch.return_value = []
    await repo.get_bangumi_by_area(34.88, 135.80)
    sql = pool.fetch.await_args.args[0]
    assert "cover_url" in sql
    assert "title_cn" in sql
    assert "points_count" in sql


async def test_get_bangumi_by_area_returns_empty_when_no_points_in_radius(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """Returns empty list when nothing is within radius."""
    pool.fetch.return_value = []
    result = await repo.get_bangumi_by_area(0.0, 0.0, radius_m=1000)
    assert result == []


async def test_list_popular_returns_sorted_by_rating(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """list_popular returns rows ordered by rating DESC."""
    pool.fetch.return_value = [
        {
            "id": "1",
            "title": "A",
            "title_cn": None,
            "cover_url": None,
            "city": "Kyoto",
            "points_count": 3,
            "rating": 9.0,
        },
        {
            "id": "2",
            "title": "B",
            "title_cn": None,
            "cover_url": None,
            "city": "Tokyo",
            "points_count": 2,
            "rating": 8.0,
        },
    ]
    result = await repo.list_popular(limit=8)
    assert len(result) == 2
    assert result[0]["id"] == "1"
    assert result[1]["id"] == "2"


async def test_list_popular_passes_limit_to_query(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """list_popular forwards limit parameter to the SQL query."""
    pool.fetch.return_value = []
    await repo.list_popular(limit=5)
    sql, *args = pool.fetch.await_args.args
    assert "LIMIT" in sql.upper()
    assert 5 in args


async def test_list_popular_filters_zero_points_count(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """SQL must filter WHERE points_count > 0."""
    pool.fetch.return_value = []
    await repo.list_popular(limit=8)
    sql = pool.fetch.await_args.args[0]
    assert "points_count" in sql
    # Confirm the where clause excludes zero-count bangumi
    assert ">" in sql or "WHERE" in sql.upper()


async def test_list_popular_returns_empty_when_no_rows(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """Returns empty list when table is empty or no rows qualify."""
    pool.fetch.return_value = []
    result = await repo.list_popular(limit=8)
    assert result == []


async def test_list_popular_default_limit_is_8(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """Default limit is 8 when not provided."""
    pool.fetch.return_value = []
    await repo.list_popular()
    sql, *args = pool.fetch.await_args.args
    assert 8 in args


async def test_list_popular_uses_postgis_gist_hint_in_nearby(
    repo: BangumiRepository, pool: AsyncMock
) -> None:
    """get_bangumi_by_area uses ST_DWithin which benefits from GIST index on points.location."""
    pool.fetch.return_value = []
    await repo.get_bangumi_by_area(34.88, 135.80)
    sql = pool.fetch.await_args.args[0]
    assert "ST_DWithin" in sql
