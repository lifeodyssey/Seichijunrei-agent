"""Unit tests for SupabaseClient write-through helpers."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from infrastructure.supabase.client import SupabaseClient


@pytest.fixture
def mock_pool() -> AsyncMock:
    pool = AsyncMock()
    pool.fetchrow = AsyncMock()
    pool.execute = AsyncMock()
    return pool


@pytest.mark.asyncio
async def test_upsert_point_uses_geography_cast_for_location() -> None:
    client = SupabaseClient("postgresql://example")
    pool = AsyncMock()
    client._pool = pool

    await client.upsert_point(
        "p1",
        bangumi_id="115908",
        name="宇治桥",
        name_cn="宇治桥",
        episode=1,
        time_seconds=42,
        image="https://example.com/point.jpg",
        location="POINT(135.7997 34.8843)",
    )

    sql = pool.execute.await_args.args[0]
    assert "ST_GeogFromText" in sql
    assert pool.execute.await_args.args[-1] == "POINT(135.7997 34.8843)"


@pytest.mark.asyncio
async def test_upsert_points_batch_accepts_latitude_and_longitude() -> None:
    client = SupabaseClient("postgresql://example")

    conn = MagicMock()
    conn.executemany = AsyncMock()
    tx = AsyncMock()
    tx.__aenter__.return_value = tx
    tx.__aexit__.return_value = None
    conn.transaction.return_value = tx

    acquire_ctx = AsyncMock()
    acquire_ctx.__aenter__.return_value = conn
    acquire_ctx.__aexit__.return_value = None

    pool = MagicMock()
    pool.acquire.return_value = acquire_ctx
    client._pool = pool

    await client.upsert_points_batch(
        [
            {
                "id": "p1",
                "bangumi_id": "115908",
                "name": "宇治桥",
                "name_cn": "宇治桥",
                "latitude": 34.8843,
                "longitude": 135.7997,
                "episode": 1,
                "time_seconds": 42,
                "image": "https://example.com/point.jpg",
                "location": "POINT(135.7997 34.8843)",
            }
        ]
    )

    sql = conn.executemany.await_args.args[0]
    args = conn.executemany.await_args.args[1]
    assert "latitude" in sql
    assert "longitude" in sql
    assert "ST_GeogFromText" in sql
    assert args == [
        (
            "p1",
            "115908",
            "宇治桥",
            "宇治桥",
            34.8843,
            135.7997,
            1,
            42,
            "https://example.com/point.jpg",
            "POINT(135.7997 34.8843)",
        )
    ]


@pytest.mark.asyncio
async def test_upsert_point_casts_embedding_to_vector() -> None:
    client = SupabaseClient("postgresql://example")
    pool = AsyncMock()
    client._pool = pool

    await client.upsert_point(
        "p1",
        bangumi_id="115908",
        name="宇治桥",
        latitude=34.8843,
        longitude=135.7997,
        embedding=[0.1, 0.2, 0.3],
    )

    sql = pool.execute.await_args.args[0]
    args = pool.execute.await_args.args[1:]
    assert "embedding" in sql
    assert "::vector" in sql
    assert args[-1] == "[0.1,0.2,0.3]"


@pytest.mark.asyncio
async def test_search_points_by_location_uses_runtime_contract_query() -> None:
    client = SupabaseClient("postgresql://example")
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    client._pool = pool

    await client.search_points_by_location(34.8843, 135.7997, 5000, limit=10)

    sql = pool.fetch.await_args.args[0]
    assert "SELECT *" not in sql
    assert "LEFT JOIN bangumi b ON p.bangumi_id = b.id" in sql
    assert "p.image AS screenshot_url" in sql
    assert "b.title" in sql
    assert "b.title_cn" in sql
    assert "distance_m" in sql


class TestFindBangumiByTitle:
    async def test_exact_title_match(self, mock_pool):
        mock_pool.fetchrow.return_value = {"id": "115908"}
        client = SupabaseClient.__new__(SupabaseClient)
        client._pool = mock_pool
        result = await client.find_bangumi_by_title("響け！ユーフォニアム")
        assert result == "115908"
        call_args = mock_pool.fetchrow.call_args[0]
        assert "ilike" in call_args[0].lower() or "$1" in call_args[0]

    async def test_no_match_returns_none(self, mock_pool):
        mock_pool.fetchrow.return_value = None
        client = SupabaseClient.__new__(SupabaseClient)
        client._pool = mock_pool
        result = await client.find_bangumi_by_title("unknown anime xyz")
        assert result is None


class TestUpsertBangumiTitle:
    async def test_upserts_title(self, mock_pool):
        mock_pool.execute.return_value = None
        client = SupabaseClient.__new__(SupabaseClient)
        client._pool = mock_pool
        await client.upsert_bangumi_title("進撃の巨人", "6718")
        mock_pool.execute.assert_awaited_once()
        sql, *args = mock_pool.execute.call_args[0]
        assert "6718" in args or "進撃の巨人" in args
