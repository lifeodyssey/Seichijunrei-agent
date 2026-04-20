"""Unit tests for bangumi enrichment: write_through_bangumi_points, ensure_bangumi_record, etc."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.retrievers.enrichment import (
    ensure_bangumi_record,
    load_bangumi_metadata,
    persist_points,
    point_to_db_row,
    subject_to_bangumi_fields,
    update_bangumi_points_count,
    write_through_bangumi_points,
)
from backend.domain.entities import Coordinates, Point
from backend.infrastructure.supabase.client import SupabaseClient


def _make_point(point_id: str = "p1") -> Point:
    return Point(
        id=point_id,
        name="宇治桥",
        cn_name="宇治桥",
        coordinates=Coordinates(latitude=34.8843, longitude=135.7997),
        bangumi_id="115908",
        bangumi_title="響け！ユーフォニアム",
        episode=1,
        time_seconds=42,
        screenshot_url="https://example.com/s.jpg",
        origin="Anitabi",
        origin_url="https://anitabi.cn/p/p1",
    )


def _make_db(
    *,
    has_upsert_batch: bool = True,
    has_upsert_bangumi: bool = True,
    has_pool: bool = True,
) -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    if has_upsert_batch:
        db.points.upsert_points_batch = AsyncMock()
    else:
        db.points = MagicMock(spec=[])
    if has_upsert_bangumi:
        db.bangumi.upsert_bangumi = AsyncMock()
    else:
        db.bangumi = MagicMock(spec=[])
    if has_pool:
        pool = AsyncMock()
        pool.execute = AsyncMock()
        db.pool = pool
    else:
        db.pool = None
    return db


# ── point_to_db_row ──


class TestPointToDbRow:
    def test_produces_expected_keys(self) -> None:
        row = point_to_db_row(_make_point())
        expected_keys = {
            "id",
            "bangumi_id",
            "name",
            "name_cn",
            "latitude",
            "longitude",
            "episode",
            "time_seconds",
            "image",
            "origin",
            "origin_url",
            "location",
        }
        assert set(row.keys()) == expected_keys

    def test_location_wkt_format(self) -> None:
        row = point_to_db_row(_make_point())
        assert row["location"] == "POINT(135.7997 34.8843)"

    def test_coordinates_are_stored_separately(self) -> None:
        row = point_to_db_row(_make_point())
        assert row["latitude"] == 34.8843
        assert row["longitude"] == 135.7997


# ── subject_to_bangumi_fields ──


class TestSubjectToBangumiFields:
    def test_extracts_title_from_name(self) -> None:
        subject = {"name": "響け", "name_cn": "吹响"}
        fields = subject_to_bangumi_fields(subject, points_count=5)
        assert fields["title"] == "響け"
        assert fields["title_cn"] == "吹响"
        assert fields["points_count"] == 5

    def test_falls_back_to_name_cn_when_no_name(self) -> None:
        subject = {"name_cn": "吹响"}
        fields = subject_to_bangumi_fields(subject, points_count=0)
        assert fields["title"] == "吹响"

    def test_falls_back_to_unknown_when_no_names(self) -> None:
        fields = subject_to_bangumi_fields({}, points_count=0)
        assert fields["title"] == "Unknown"

    def test_extracts_cover_url_from_large_image(self) -> None:
        subject = {
            "name": "X",
            "images": {"large": "https://img/l.jpg", "common": "c.jpg"},
        }
        fields = subject_to_bangumi_fields(subject, points_count=0)
        assert fields["cover_url"] == "https://img/l.jpg"

    def test_falls_back_to_common_image(self) -> None:
        subject = {"name": "X", "images": {"common": "c.jpg"}}
        fields = subject_to_bangumi_fields(subject, points_count=0)
        assert fields["cover_url"] == "c.jpg"

    def test_non_mapping_images_ignored(self) -> None:
        subject = {"name": "X", "images": "bad"}
        fields = subject_to_bangumi_fields(subject, points_count=0)
        assert fields["cover_url"] == ""

    def test_extracts_rating_score(self) -> None:
        subject = {"name": "X", "rating": {"score": 8.7}}
        fields = subject_to_bangumi_fields(subject, points_count=0)
        assert fields["rating"] == 8.7

    def test_non_mapping_rating_ignored(self) -> None:
        subject = {"name": "X", "rating": 9.0}
        fields = subject_to_bangumi_fields(subject, points_count=0)
        assert fields["rating"] is None

    def test_summary_truncated_at_2000_chars(self) -> None:
        subject = {"name": "X", "summary": "A" * 3000}
        fields = subject_to_bangumi_fields(subject, points_count=0)
        assert len(str(fields["summary"])) == 2000


# ── load_bangumi_metadata ──


class TestLoadBangumiMetadata:
    @pytest.mark.asyncio
    async def test_uses_subject_when_available(self) -> None:
        subject = {"name": "響け", "images": {"large": "https://img.jpg"}}
        get_subject = AsyncMock(return_value=subject)
        result = await load_bangumi_metadata("115908", [_make_point()], get_subject)
        assert result["title"] == "響け"

    @pytest.mark.asyncio
    async def test_falls_back_to_minimal_when_get_subject_is_none(self) -> None:
        result = await load_bangumi_metadata("115908", [_make_point()], None)
        assert result["title"] == "響け！ユーフォニアム"
        assert result["points_count"] == 1

    @pytest.mark.asyncio
    async def test_uses_bangumi_id_as_title_when_no_points(self) -> None:
        result = await load_bangumi_metadata("115908", [], None)
        assert result["title"] == "115908"

    @pytest.mark.asyncio
    async def test_falls_back_to_minimal_on_exception(self) -> None:
        get_subject = AsyncMock(side_effect=RuntimeError("API error"))
        result = await load_bangumi_metadata("115908", [_make_point()], get_subject)
        assert result["title"] == "響け！ユーフォニアム"


# ── persist_points ──


class TestPersistPoints:
    @pytest.mark.asyncio
    async def test_calls_upsert_with_converted_rows(self) -> None:
        db = _make_db()
        await persist_points(db, [_make_point()])
        db.points.upsert_points_batch.assert_awaited_once()
        rows = db.points.upsert_points_batch.await_args.args[0]
        assert rows[0]["id"] == "p1"

    @pytest.mark.asyncio
    async def test_no_op_when_db_not_supabase_client(self) -> None:
        await persist_points(object(), [_make_point()])

    @pytest.mark.asyncio
    async def test_no_op_for_empty_points(self) -> None:
        db = _make_db()
        await persist_points(db, [])
        rows = db.points.upsert_points_batch.await_args.args[0]
        assert rows == []


# ── update_bangumi_points_count ──


class TestUpdateBangumiPointsCount:
    @pytest.mark.asyncio
    async def test_executes_update_sql(self) -> None:
        db = _make_db()
        await update_bangumi_points_count(db, "115908", 10)
        db.pool.execute.assert_awaited_once()
        call_args = db.pool.execute.await_args.args
        assert "UPDATE bangumi" in call_args[0]
        assert call_args[1] == 10
        assert call_args[2] == "115908"

    @pytest.mark.asyncio
    async def test_no_op_when_db_lacks_pool(self) -> None:
        db = _make_db(has_pool=False)
        await update_bangumi_points_count(db, "115908", 10)

    @pytest.mark.asyncio
    async def test_no_op_when_pool_lacks_execute(self) -> None:
        db = _make_db()
        del db.pool.execute
        await update_bangumi_points_count(db, "115908", 10)


# ── ensure_bangumi_record ──


class TestEnsureBangumiRecord:
    @pytest.mark.asyncio
    async def test_calls_upsert_bangumi(self) -> None:
        db = _make_db()
        get_subject = AsyncMock(return_value={"name": "響け"})
        with patch(
            "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
            new=AsyncMock(return_value=None),
        ):
            await ensure_bangumi_record(db, "115908", [_make_point()], get_subject)
        db.bangumi.upsert_bangumi.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_op_when_db_not_supabase_client(self) -> None:
        with patch(
            "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
            new=AsyncMock(return_value=None),
        ):
            await ensure_bangumi_record(object(), "115908", [_make_point()], None)

    @pytest.mark.asyncio
    async def test_lite_title_overrides_metadata_title(self) -> None:
        db = _make_db()
        lite = {
            "title": "LiteTitle",
            "cn": "LiteCN",
            "city": "京都",
            "cover": "https://c.jpg",
        }
        with patch(
            "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
            new=AsyncMock(return_value=lite),
        ):
            await ensure_bangumi_record(db, "115908", [_make_point()], None)
        call_kwargs = db.bangumi.upsert_bangumi.await_args.kwargs
        assert call_kwargs["title"] == "LiteTitle"
        assert call_kwargs["title_cn"] == "LiteCN"
        assert call_kwargs["city"] == "京都"
        assert call_kwargs["cover_url"] == "https://c.jpg"


# ── write_through_bangumi_points ──


class TestWriteThroughBangumiPoints:
    @pytest.mark.asyncio
    async def test_disabled_when_fetch_fn_is_none(self) -> None:
        result = await write_through_bangumi_points(MagicMock(), "115908", None, None)
        assert result["fallback_status"] == "disabled"

    @pytest.mark.asyncio
    async def test_returns_error_metadata_on_fetch_exception(self) -> None:
        fetch_fn = AsyncMock(side_effect=RuntimeError("API down"))
        result = await write_through_bangumi_points(
            MagicMock(), "115908", fetch_fn, None
        )
        assert result["data_origin"] == "db_miss"
        assert "fallback_error" in result

    @pytest.mark.asyncio
    async def test_returns_empty_status_when_no_points(self) -> None:
        fetch_fn = AsyncMock(return_value=[])
        result = await write_through_bangumi_points(
            MagicMock(), "115908", fetch_fn, None
        )
        assert result["fallback_status"] == "empty"

    @pytest.mark.asyncio
    async def test_writes_through_and_returns_written_metadata(self) -> None:
        db = _make_db()
        fetch_fn = AsyncMock(return_value=[_make_point()])
        with patch(
            "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
            new=AsyncMock(return_value=None),
        ):
            result = await write_through_bangumi_points(db, "115908", fetch_fn, None)
        assert result["write_through"] is True
        assert result["fetched_points"] == 1
        assert result["fallback_status"] == "written"
        db.points.upsert_points_batch.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_updates_points_count_after_write(self) -> None:
        db = _make_db()
        fetch_fn = AsyncMock(return_value=[_make_point(), _make_point("p2")])
        with patch(
            "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
            new=AsyncMock(return_value=None),
        ):
            result = await write_through_bangumi_points(db, "115908", fetch_fn, None)
        assert result["fetched_points"] == 2
        db.pool.execute.assert_awaited_once()
