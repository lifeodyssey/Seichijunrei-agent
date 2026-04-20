"""Unit tests for SQL retrieval: execute_sql_with_fallback, should_try_db_miss_fallback."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.agents.models import RetrievalRequest
from backend.agents.retrievers.sql import (
    execute_sql_with_fallback,
    should_try_db_miss_fallback,
)
from backend.agents.sql_agent import SQLResult
from backend.domain.entities import Coordinates, Point


def _make_req(**kwargs: object) -> RetrievalRequest:
    return RetrievalRequest(tool="search_bangumi", **kwargs)  # type: ignore[arg-type]


def _make_sql_result(
    *,
    rows: list[dict] | None = None,
    error: str | None = None,
) -> SQLResult:
    r = rows or []
    return SQLResult(query="SELECT 1", params=[], rows=r, row_count=len(r), error=error)


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
    )


# ── should_try_db_miss_fallback ──


class TestShouldTryDbMissFallback:
    def test_true_for_search_bangumi_with_bangumi_id(self) -> None:
        req = _make_req(bangumi_id="115908")
        assert should_try_db_miss_fallback(req) is True

    def test_false_for_search_bangumi_without_bangumi_id(self) -> None:
        req = _make_req()
        assert should_try_db_miss_fallback(req) is False

    def test_false_for_search_nearby_tool(self) -> None:
        req = RetrievalRequest(tool="search_nearby", bangumi_id="115908")
        assert should_try_db_miss_fallback(req) is False


# ── execute_sql_with_fallback ──


class TestExecuteSqlWithFallback:
    @pytest.mark.asyncio
    async def test_returns_immediately_on_sql_error(self) -> None:
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            return_value=_make_sql_result(error="syntax error")
        )
        req = _make_req(bangumi_id="115908")
        result, meta = await execute_sql_with_fallback(
            req, sql_agent, MagicMock(), None, None
        )
        assert not result.success
        assert meta["data_origin"] == "db"

    @pytest.mark.asyncio
    async def test_returns_existing_rows_without_fallback(self) -> None:
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            return_value=_make_sql_result(rows=[{"id": "p1"}])
        )
        req = _make_req(bangumi_id="115908")
        result, meta = await execute_sql_with_fallback(
            req, sql_agent, MagicMock(), None, None
        )
        assert result.row_count == 1
        assert meta["data_origin"] == "db"
        sql_agent.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_db_miss_with_no_fallback_fn_returns_early(self) -> None:
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(return_value=_make_sql_result())
        req = _make_req(bangumi_id="115908")
        result, meta = await execute_sql_with_fallback(
            req, sql_agent, MagicMock(), None, None
        )
        assert result.row_count == 0
        sql_agent.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_db_miss_triggers_write_through_and_reruns(self) -> None:
        db = MagicMock()
        db.upsert_points_batch = AsyncMock()
        db.upsert_bangumi = AsyncMock()
        pool = AsyncMock()
        pool.execute = AsyncMock()
        db.pool = pool

        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            side_effect=[
                _make_sql_result(),
                _make_sql_result(rows=[{"id": "p1"}]),
            ]
        )
        fetch_bangumi_points = AsyncMock(return_value=[_make_point()])
        get_bangumi_subject = AsyncMock(
            return_value={
                "name": "響け！ユーフォニアム",
                "images": {"large": "https://example.com/cover.jpg"},
            }
        )

        req = _make_req(bangumi_id="115908")
        with (
            MagicMock() as _anitabi_patch,
        ):
            from unittest.mock import patch

            with patch(
                "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
                new=AsyncMock(return_value=None),
            ):
                result, meta = await execute_sql_with_fallback(
                    req,
                    sql_agent,
                    db,
                    fetch_bangumi_points,
                    get_bangumi_subject,
                )

        assert result.row_count == 1
        assert meta.get("write_through") is True
        assert sql_agent.execute.await_count == 2

    @pytest.mark.asyncio
    async def test_force_refresh_triggers_fallback_even_with_rows(self) -> None:
        db = MagicMock()
        db.upsert_points_batch = AsyncMock()
        db.upsert_bangumi = AsyncMock()
        pool = AsyncMock()
        pool.execute = AsyncMock()
        db.pool = pool

        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            side_effect=[
                _make_sql_result(rows=[{"id": "p1"}]),
                _make_sql_result(rows=[{"id": "p1"}, {"id": "p2"}]),
            ]
        )
        fetch_bangumi_points = AsyncMock(
            return_value=[_make_point(), _make_point("p2")]
        )
        get_bangumi_subject = AsyncMock(return_value={"name": "Test"})

        req = _make_req(bangumi_id="115908", force_refresh=True)
        from unittest.mock import patch

        with patch(
            "backend.agents.retrievers.enrichment.fetch_bangumi_lite",
            new=AsyncMock(return_value=None),
        ):
            result, meta = await execute_sql_with_fallback(
                req,
                sql_agent,
                db,
                fetch_bangumi_points,
                get_bangumi_subject,
            )

        assert result.row_count == 2
        assert sql_agent.execute.await_count == 2

    @pytest.mark.asyncio
    async def test_no_fallback_when_bangumi_id_missing(self) -> None:
        # bangumi_id is None -> should_try_db_miss_fallback returns False
        # -> early return with 0 rows, no fallback triggered
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(return_value=_make_sql_result())
        req = RetrievalRequest(tool="search_bangumi")

        result, meta = await execute_sql_with_fallback(
            req,
            sql_agent,
            MagicMock(),
            AsyncMock(return_value=[]),
            None,
        )

        assert result.row_count == 0
        sql_agent.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_raises_if_bangumi_id_none_with_force_refresh_and_rows(self) -> None:
        # force_refresh=True bypasses the has_rows short-circuit but bangumi_id=None
        # -> should_try_db_miss_fallback=False, has_rows=True, force_refresh=True
        # -> falls through to the bangumi_id None check -> raises ValueError
        sql_agent = MagicMock()
        sql_agent.execute = AsyncMock(
            return_value=_make_sql_result(rows=[{"id": "p1"}])
        )
        req = RetrievalRequest(tool="search_bangumi", force_refresh=True)

        with pytest.raises(ValueError, match="bangumi_id"):
            await execute_sql_with_fallback(
                req,
                sql_agent,
                MagicMock(),
                AsyncMock(return_value=[]),
                None,
            )
