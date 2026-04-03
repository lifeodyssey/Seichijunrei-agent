from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from domain.entities import Coordinates, Point
from scripts.seed_data import fetch_points


_REMOTE_SCHEMA = Path("supabase/migrations/20260402120000_remote_schema.sql")
_POINTS_ALIGNMENT_MIGRATION = Path("supabase/migrations/20260402123000_points_alignment.sql")
_OPERATIONAL_TABLES_MIGRATION = Path("supabase/migrations/20260402124000_operational_tables.sql")


def _sample_point() -> Point:
    return Point(
        id="p1",
        name="宇治桥",
        cn_name="宇治桥",
        coordinates=Coordinates(latitude=34.8843, longitude=135.7997),
        bangumi_id="115908",
        bangumi_title="響け！ユーフォニアム",
        episode=1,
        time_seconds=42,
        screenshot_url="https://example.com/point.jpg",
        origin="Anitabi",
        origin_url="https://anitabi.cn/points/p1",
    )


def test_points_baseline_schema_matches_runtime_column_names() -> None:
    sql = _REMOTE_SCHEMA.read_text(encoding="utf-8")

    assert "name_cn" in sql
    assert "latitude" in sql
    assert "longitude" in sql
    assert "image" in sql
    assert "scene_desc" in sql
    assert "embedding" in sql
    assert "vector(1024)" in sql
    assert "bangumi_id      TEXT REFERENCES bangumi(id)" in sql
    assert "location        GEOGRAPHY(POINT, 4326)" in sql

    assert "cn_name" not in sql
    assert "screenshot_url" not in sql
    assert "address" not in sql
    assert "location        GEOGRAPHY(POINT, 4326) NOT NULL" not in sql


def test_points_alignment_migration_exists_and_handles_legacy_columns() -> None:
    assert _POINTS_ALIGNMENT_MIGRATION.exists()

    sql = _POINTS_ALIGNMENT_MIGRATION.read_text(encoding="utf-8")

    assert "cn_name" in sql
    assert "name_cn" in sql
    assert "screenshot_url" in sql
    assert "image" in sql
    assert "ADD COLUMN IF NOT EXISTS latitude" in sql
    assert "ADD COLUMN IF NOT EXISTS longitude" in sql
    assert "ADD COLUMN IF NOT EXISTS scene_desc" in sql
    assert "ADD COLUMN IF NOT EXISTS embedding vector(1024)" in sql
    assert "ST_Y(location::geometry)" in sql
    assert "ST_X(location::geometry)" in sql
    assert "idx_points_embedding" in sql


def test_extensions_and_indexes_include_vector_support() -> None:
    remote_sql = _REMOTE_SCHEMA.read_text(encoding="utf-8")
    alignment_sql = _POINTS_ALIGNMENT_MIGRATION.read_text(encoding="utf-8")

    assert "CREATE EXTENSION IF NOT EXISTS vector" in remote_sql
    assert "idx_points_embedding" in alignment_sql
    assert "vector_cosine_ops" in alignment_sql


def test_operational_schema_baseline_and_waitlist_migration_exist() -> None:
    assert _OPERATIONAL_TABLES_MIGRATION.exists()

    sql = _OPERATIONAL_TABLES_MIGRATION.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS feedback" in sql
    assert "CREATE TABLE IF NOT EXISTS request_log" in sql
    assert "CREATE TABLE IF NOT EXISTS api_keys" in sql
    assert "CREATE TABLE IF NOT EXISTS waitlist" in sql
    assert "ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY" in sql
    assert "Anyone can join waitlist" in sql


def test_api_keys_migration_is_idempotent_for_policy_creation() -> None:
    sql = _OPERATIONAL_TABLES_MIGRATION.read_text(encoding="utf-8")

    assert "ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY" in sql
    assert "DO $$" in sql
    assert "Users manage their own keys" in sql


@pytest.mark.asyncio
async def test_seed_data_fetch_points_uses_runtime_points_columns() -> None:
    client = AsyncMock()
    client.get_bangumi_points.return_value = [_sample_point()]

    rows = await fetch_points(client, 115908)

    assert len(rows) == 1
    row = rows[0]
    assert row["name_cn"] == "宇治桥"
    assert row["image"] == "https://example.com/point.jpg"
    assert row["latitude"] == 34.8843
    assert row["longitude"] == 135.7997
    assert "cn_name" not in row
    assert "screenshot_url" not in row
