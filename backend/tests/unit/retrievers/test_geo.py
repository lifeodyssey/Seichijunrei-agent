"""Unit tests for geo retrieval strategy: fetch_geo_rows, get_area_suggestions, records_to_dicts."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.agents.retrievers.geo import (
    fetch_geo_rows,
    get_area_suggestions,
    records_to_dicts,
)
from backend.infrastructure.supabase.client import SupabaseClient


def _mock_db(
    *,
    has_area: bool = True,
) -> MagicMock:
    db = MagicMock(spec=SupabaseClient)
    db.points.search_points_by_location = AsyncMock(return_value=[])
    if has_area:
        db.get_bangumi_by_area = AsyncMock(return_value=[])
    else:
        del db.get_bangumi_by_area
    return db


# ── records_to_dicts ──


class TestRecordsToDicts:
    def test_converts_mappings_to_dicts(self) -> None:
        records = [{"id": "p1", "name": "A"}, {"id": "p2", "name": "B"}]
        result = records_to_dicts(records)
        assert result == [{"id": "p1", "name": "A"}, {"id": "p2", "name": "B"}]

    def test_empty_sequence_returns_empty_list(self) -> None:
        assert records_to_dicts([]) == []

    def test_each_item_is_a_plain_dict(self) -> None:
        records = [{"x": 1}]
        result = records_to_dicts(records)
        assert isinstance(result[0], dict)


# ── fetch_geo_rows ──


class TestFetchGeoRows:
    @pytest.mark.asyncio
    async def test_returns_error_on_empty_anchor(self) -> None:
        db = _mock_db()
        rows, error = await fetch_geo_rows(db, "", radius_m=5000)
        assert rows == []
        assert error is not None
        assert "Missing" in error

    @pytest.mark.asyncio
    async def test_returns_error_when_location_unresolvable(self) -> None:
        db = _mock_db()
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=None),
        ):
            rows, error = await fetch_geo_rows(db, "nowhere", radius_m=5000)
        assert rows == []
        assert error is not None
        assert "nowhere" in error

    @pytest.mark.asyncio
    async def test_returns_error_when_db_is_not_supabase_client(self) -> None:
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=(34.88, 135.79)),
        ):
            rows, error = await fetch_geo_rows(object(), "宇治", radius_m=5000)
        assert rows == []
        assert error is not None
        assert "geo retrieval" in error

    @pytest.mark.asyncio
    async def test_returns_rows_and_no_error_on_success(self) -> None:
        db = _mock_db()
        db.points.search_points_by_location = AsyncMock(
            return_value=[{"id": "p1", "name": "A"}]
        )
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=(34.88, 135.79)),
        ):
            rows, error = await fetch_geo_rows(db, "宇治", radius_m=5000)
        assert error is None
        assert rows == [{"id": "p1", "name": "A"}]
        db.points.search_points_by_location.assert_awaited_once_with(
            34.88, 135.79, 5000, limit=200
        )

    @pytest.mark.asyncio
    async def test_empty_result_returns_empty_rows_no_error(self) -> None:
        db = _mock_db()
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=(34.88, 135.79)),
        ):
            rows, error = await fetch_geo_rows(db, "宇治", radius_m=5000)
        assert rows == []
        assert error is None

    @pytest.mark.asyncio
    async def test_returns_error_when_coords_is_ambiguous(self) -> None:
        db = _mock_db()
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=[]),
        ):
            rows, error = await fetch_geo_rows(db, "宇治", radius_m=5000)
        assert rows == []
        assert error is not None
        assert "Ambiguous" in error


# ── get_area_suggestions ──


class TestGetAreaSuggestions:
    @pytest.mark.asyncio
    async def test_returns_empty_when_db_lacks_method(self) -> None:
        db = _mock_db(has_area=False)
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=(34.88, 135.79)),
        ):
            result = await get_area_suggestions(db, "宇治")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_when_location_unresolvable(self) -> None:
        db = _mock_db()
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=None),
        ):
            result = await get_area_suggestions(db, "nowhere")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_results_on_success(self) -> None:
        db = _mock_db()
        db.get_bangumi_by_area = AsyncMock(
            return_value=[{"id": "115908", "title": "響け"}]
        )
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=(34.88, 135.79)),
        ):
            result = await get_area_suggestions(db, "宇治")
        assert result == [{"id": "115908", "title": "響け"}]

    @pytest.mark.asyncio
    async def test_returns_empty_and_logs_on_db_exception(self) -> None:
        db = _mock_db()
        db.get_bangumi_by_area = AsyncMock(side_effect=RuntimeError("db error"))
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=(34.88, 135.79)),
        ):
            result = await get_area_suggestions(db, "宇治")
        assert result == []

    @pytest.mark.asyncio
    async def test_returns_empty_when_coords_is_list(self) -> None:
        db = _mock_db()
        with patch(
            "backend.agents.retrievers.geo.resolve_location",
            new=AsyncMock(return_value=[]),
        ):
            result = await get_area_suggestions(db, "宇治")
        assert result == []
