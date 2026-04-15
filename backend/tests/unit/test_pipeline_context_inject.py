"""Tests for Card B2: inject session search data into executor context."""

from __future__ import annotations

from backend.agents.pipeline import _seed_executor_context


class TestSeedExecutorContextSearchBangumi:
    """AC1: context has last_search_data with search_bangumi -> executor_context["search_bangumi"] pre-populated."""

    def test_search_bangumi_pre_populated(self) -> None:
        search_data: dict[str, object] = {
            "rows": [{"bangumi_id": "99", "title": "Eupho"}],
            "row_count": 1,
            "status": "ok",
        }
        context: dict[str, object] = {
            "last_search_data": {"search_bangumi": search_data},
        }
        executor_context: dict[str, object] = {"locale": "ja"}

        _seed_executor_context(executor_context, context)

        assert "search_bangumi" in executor_context
        assert executor_context["search_bangumi"] is search_data


class TestSeedExecutorContextSearchNearby:
    """AC2: context has last_search_data with search_nearby -> executor_context["search_nearby"] pre-populated."""

    def test_search_nearby_pre_populated(self) -> None:
        nearby_data: dict[str, object] = {
            "rows": [{"point_id": "p1", "name": "Uji Bridge"}],
            "row_count": 1,
            "status": "ok",
        }
        context: dict[str, object] = {
            "last_search_data": {"search_nearby": nearby_data},
        }
        executor_context: dict[str, object] = {"locale": "ja"}

        _seed_executor_context(executor_context, context)

        assert "search_nearby" in executor_context
        assert executor_context["search_nearby"] is nearby_data


class TestSeedExecutorContextNoData:
    """AC3: context is None or no last_search_data -> executor_context only has locale."""

    def test_context_none(self) -> None:
        executor_context: dict[str, object] = {"locale": "ja"}

        _seed_executor_context(executor_context, None)

        assert executor_context == {"locale": "ja"}

    def test_context_without_last_search_data(self) -> None:
        context: dict[str, object] = {"summary": "some summary"}
        executor_context: dict[str, object] = {"locale": "ja"}

        _seed_executor_context(executor_context, context)

        assert executor_context == {"locale": "ja"}


class TestSeedExecutorContextEmptyRows:
    """AC4: last_search_data present but rows is empty -> executor_context still seeded."""

    def test_empty_rows_still_seeded(self) -> None:
        search_data: dict[str, object] = {
            "rows": [],
            "row_count": 0,
            "status": "empty",
        }
        context: dict[str, object] = {
            "last_search_data": {"search_bangumi": search_data},
        }
        executor_context: dict[str, object] = {"locale": "ja"}

        _seed_executor_context(executor_context, context)

        assert "search_bangumi" in executor_context
        assert executor_context["search_bangumi"] is search_data
