from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from domain.entities import Coordinates, Point
from scripts.seed_data import fetch_points


_BASELINE_SCHEMA = Path("scripts/supabase/003_points.sql")
_ALIGNMENT_MIGRATION = Path(
    "infrastructure/supabase/migrations/005_points_schema_alignment.sql"
)
_EXTENSIONS_SCHEMA = Path("scripts/supabase/001_extensions.sql")
_OPS_BASELINE_SCHEMA = Path("scripts/supabase/006_operational_tables.sql")
_WAITLIST_MIGRATION = Path("infrastructure/supabase/migrations/006_waitlist.sql")
_INDEXES_SCHEMA = Path("scripts/supabase/005_indexes.sql")
_API_KEYS_MIGRATION = Path("infrastructure/supabase/migrations/004_api_keys.sql")


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
    sql = _BASELINE_SCHEMA.read_text(encoding="utf-8")

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
    assert _ALIGNMENT_MIGRATION.exists()

    sql = _ALIGNMENT_MIGRATION.read_text(encoding="utf-8")

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
    extensions_sql = _EXTENSIONS_SCHEMA.read_text(encoding="utf-8")
    indexes_sql = _INDEXES_SCHEMA.read_text(encoding="utf-8")

    assert "CREATE EXTENSION IF NOT EXISTS vector" in extensions_sql
    assert "idx_points_embedding" in indexes_sql
    assert "vector_cosine_ops" in indexes_sql


def test_operational_schema_baseline_and_waitlist_migration_exist() -> None:
    assert _OPS_BASELINE_SCHEMA.exists()
    assert _WAITLIST_MIGRATION.exists()

    baseline_sql = _OPS_BASELINE_SCHEMA.read_text(encoding="utf-8")
    waitlist_sql = _WAITLIST_MIGRATION.read_text(encoding="utf-8")

    assert "CREATE TABLE IF NOT EXISTS feedback" in baseline_sql
    assert "CREATE TABLE IF NOT EXISTS request_log" in baseline_sql
    assert "CREATE TABLE IF NOT EXISTS api_keys" in baseline_sql
    assert "CREATE TABLE IF NOT EXISTS waitlist" in baseline_sql
    assert "ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY" in baseline_sql
    assert "Anyone can join waitlist" in baseline_sql

    assert "CREATE TABLE IF NOT EXISTS waitlist" in waitlist_sql
    assert "ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY" in waitlist_sql
    assert "Anyone can join waitlist" in waitlist_sql


def test_api_keys_migration_is_idempotent_for_policy_creation() -> None:
    sql = _API_KEYS_MIGRATION.read_text(encoding="utf-8")

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
