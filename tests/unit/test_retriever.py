"""Unit tests for deterministic retrieval strategy selection and execution."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from agents.intent_agent import ExtractedParams, IntentOutput
from agents.retriever import RetrievalStrategy, Retriever, _merge_rows_preserving_order
from domain.entities import Coordinates, Point
from services.cache import ResponseCache


@pytest.fixture
def mock_db():
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    pool.execute = AsyncMock()
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.get_bangumi = AsyncMock(
        return_value={"id": "115908", "title": "響け！ユーフォニアム"}
    )
    db.upsert_bangumi = AsyncMock()
    db.upsert_points_batch = AsyncMock(return_value=0)
    return db


def _make_intent(intent: str, **kwargs) -> IntentOutput:
    return IntentOutput(
        intent=intent,
        confidence=0.95,
        extracted_params=ExtractedParams(**kwargs),
    )


def _make_point(point_id: str = "p1", *, bangumi_id: str = "115908") -> Point:
    return Point(
        id=point_id,
        name="宇治桥",
        cn_name="宇治桥",
        coordinates=Coordinates(latitude=34.8843, longitude=135.7997),
        bangumi_id=bangumi_id,
        bangumi_title="響け！ユーフォニアム",
        episode=1,
        time_seconds=42,
        screenshot_url="https://example.com/point.jpg",
        address="Uji, Kyoto",
        origin="Anitabi",
        origin_url="https://anitabi.cn/points/p1",
    )


class TestStrategySelection:
    def test_location_uses_geo(self, mock_db):
        retriever = Retriever(mock_db)
        strategy = retriever.choose_strategy(
            _make_intent("search_by_location", location="宇治")
        )
        assert strategy == RetrievalStrategy.GEO

    def test_bangumi_with_location_uses_hybrid(self, mock_db):
        retriever = Retriever(mock_db)
        strategy = retriever.choose_strategy(
            _make_intent("search_by_bangumi", bangumi="115908", location="宇治")
        )
        assert strategy == RetrievalStrategy.HYBRID

    def test_bangumi_without_location_uses_sql(self, mock_db):
        retriever = Retriever(mock_db)
        strategy = retriever.choose_strategy(
            _make_intent("search_by_bangumi", bangumi="115908")
        )
        assert strategy == RetrievalStrategy.SQL

    def test_route_with_origin_uses_hybrid(self, mock_db):
        retriever = Retriever(mock_db)
        strategy = retriever.choose_strategy(
            _make_intent("plan_route", bangumi="115908", origin="京都站")
        )
        assert strategy == RetrievalStrategy.HYBRID


class TestRetrievalExecution:
    @pytest.mark.asyncio
    async def test_cache_hit_skips_second_db_query(self, mock_db):
        cache = ResponseCache(default_ttl_seconds=60, cleanup_interval_seconds=0)
        mock_db.pool.fetch.return_value = [{"id": "p1", "bangumi_id": "115908"}]
        retriever = Retriever(mock_db, cache=cache)

        first = await retriever.execute(
            _make_intent("search_by_bangumi", bangumi="115908")
        )
        second = await retriever.execute(
            _make_intent("search_by_bangumi", bangumi="115908")
        )

        assert first.success
        assert second.success
        assert second.metadata["cache"] == "hit"
        assert mock_db.pool.fetch.await_count == 1

    @pytest.mark.asyncio
    async def test_geo_strategy_uses_supabase_geo_search(self, mock_db):
        mock_db.search_points_by_location.return_value = [
            {"id": "p1", "bangumi_id": "115908", "distance_m": 100},
        ]
        retriever = Retriever(mock_db)

        result = await retriever.execute(
            _make_intent("search_by_location", location="宇治")
        )

        assert result.success
        assert result.strategy == RetrievalStrategy.GEO
        assert result.row_count == 1
        mock_db.search_points_by_location.assert_awaited_once()
        mock_db.pool.fetch.assert_not_called()

    @pytest.mark.asyncio
    async def test_sql_strategy_uses_sql_agent(self, mock_db):
        mock_db.pool.fetch.return_value = [{"id": "p1", "bangumi_id": "115908"}]
        retriever = Retriever(mock_db)

        result = await retriever.execute(
            _make_intent("search_by_bangumi", bangumi="115908")
        )

        assert result.success
        assert result.strategy == RetrievalStrategy.SQL
        assert result.row_count == 1
        mock_db.pool.fetch.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_sql_db_miss_triggers_write_through_fallback(self, mock_db):
        cache = ResponseCache(default_ttl_seconds=60, cleanup_interval_seconds=0)
        mock_db.pool.fetch.side_effect = [
            [],
            [{"id": "p1", "bangumi_id": "115908", "title": "響け！ユーフォニアム"}],
        ]
        mock_db.get_bangumi.return_value = None
        fetch_bangumi_points = AsyncMock(return_value=[_make_point()])
        get_bangumi_subject = AsyncMock(
            return_value={
                "name": "響け！ユーフォニアム",
                "name_cn": "吹响吧！上低音号",
                "images": {"large": "https://example.com/cover.jpg"},
                "rating": {"score": 8.7},
                "date": "2015-04-01",
                "eps": 13,
            }
        )
        retriever = Retriever(
            mock_db,
            cache=cache,
            fetch_bangumi_points=fetch_bangumi_points,
            get_bangumi_subject=get_bangumi_subject,
        )

        result = await retriever.execute(
            _make_intent("search_by_bangumi", bangumi="115908")
        )

        assert result.success
        assert result.strategy == RetrievalStrategy.SQL
        assert result.metadata["data_origin"] == "fallback"
        assert result.metadata["write_through"] is True
        fetch_bangumi_points.assert_awaited_once_with("115908")
        get_bangumi_subject.assert_awaited_once_with(115908)
        mock_db.upsert_bangumi.assert_awaited_once()
        mock_db.upsert_points_batch.assert_awaited_once()
        written_rows = mock_db.upsert_points_batch.await_args.args[0]
        assert written_rows[0]["location"] == "POINT(135.7997 34.8843)"
        assert mock_db.pool.fetch.await_count == 2

    @pytest.mark.asyncio
    async def test_hybrid_merges_sql_and_geo_results(self, mock_db):
        mock_db.pool.fetch.return_value = [
            {"id": "p1", "bangumi_id": "115908", "name": "A"},
            {"id": "p2", "bangumi_id": "115908", "name": "B"},
        ]
        mock_db.search_points_by_location.return_value = [
            {"id": "p2", "bangumi_id": "115908", "distance_m": 120},
            {"id": "p1", "bangumi_id": "115908", "distance_m": 80},
            {"id": "p3", "bangumi_id": "999", "distance_m": 30},
        ]
        retriever = Retriever(mock_db)

        result = await retriever.execute(
            _make_intent("plan_route", bangumi="115908", origin="京都站")
        )

        assert result.success
        assert result.strategy == RetrievalStrategy.HYBRID
        assert result.metadata["mode"] == "hybrid"
        assert [row["id"] for row in result.rows] == ["p1", "p2"]
        assert result.rows[0]["distance_m"] == 80

    @pytest.mark.asyncio
    async def test_hybrid_db_miss_falls_back_then_merges_geo(self, mock_db):
        cache = ResponseCache(default_ttl_seconds=60, cleanup_interval_seconds=0)
        mock_db.pool.fetch.side_effect = [
            [],
            [{"id": "p1", "bangumi_id": "115908", "name": "A"}],
        ]
        mock_db.search_points_by_location.return_value = [
            {"id": "p1", "bangumi_id": "115908", "distance_m": 80},
        ]
        mock_db.get_bangumi.return_value = None
        retriever = Retriever(
            mock_db,
            cache=cache,
            fetch_bangumi_points=AsyncMock(return_value=[_make_point()]),
            get_bangumi_subject=AsyncMock(
                return_value={
                    "name": "響け！ユーフォニアム",
                    "images": {"large": "https://example.com/cover.jpg"},
                }
            ),
        )

        result = await retriever.execute(
            _make_intent("plan_route", bangumi="115908", origin="京都站")
        )

        assert result.success
        assert result.strategy == RetrievalStrategy.HYBRID
        assert result.metadata["data_origin"] == "fallback"
        assert result.rows[0]["distance_m"] == 80
        mock_db.upsert_points_batch.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_hybrid_falls_back_to_sql_on_unknown_anchor(self, mock_db):
        mock_db.pool.fetch.return_value = [{"id": "p1", "bangumi_id": "115908"}]
        retriever = Retriever(mock_db)

        result = await retriever.execute(
            _make_intent("search_by_bangumi", bangumi="115908", location="不存在")
        )

        assert result.success
        assert result.strategy == RetrievalStrategy.HYBRID
        assert result.metadata["mode"] == "sql_fallback"
        assert result.row_count == 1


class TestMergeRows:
    def test_preserves_sql_order(self):
        merged = _merge_rows_preserving_order(
            [
                {"id": "p2", "name": "B"},
                {"id": "p1", "name": "A"},
            ],
            [
                {"id": "p1", "distance_m": 80},
                {"id": "p2", "distance_m": 120},
            ],
        )
        assert [row["id"] for row in merged] == ["p2", "p1"]
        assert merged[0]["distance_m"] == 120
