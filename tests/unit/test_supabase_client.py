"""Unit tests for SupabaseClient write-through helpers."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from infrastructure.supabase.client import SupabaseClient


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
