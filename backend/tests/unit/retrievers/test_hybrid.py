"""Unit tests for hybrid retrieval: merge_rows_preserving_order."""

from __future__ import annotations

from backend.agents.retrievers.hybrid import merge_rows_preserving_order


class TestMergeRowsPreservingOrder:
    def test_preserves_sql_row_order(self) -> None:
        sql_rows = [{"id": "p2", "name": "B"}, {"id": "p1", "name": "A"}]
        geo_rows = [{"id": "p1", "distance_m": 80}, {"id": "p2", "distance_m": 120}]
        merged = merge_rows_preserving_order(sql_rows, geo_rows)
        assert [r["id"] for r in merged] == ["p2", "p1"]

    def test_enriches_with_geo_fields(self) -> None:
        sql_rows = [{"id": "p1", "name": "A"}]
        geo_rows = [{"id": "p1", "distance_m": 50}]
        merged = merge_rows_preserving_order(sql_rows, geo_rows)
        assert merged[0]["distance_m"] == 50

    def test_sql_fields_override_geo_fields(self) -> None:
        sql_rows = [{"id": "p1", "name": "SQL Name"}]
        geo_rows = [{"id": "p1", "name": "Geo Name", "distance_m": 50}]
        merged = merge_rows_preserving_order(sql_rows, geo_rows)
        assert merged[0]["name"] == "SQL Name"
        assert merged[0]["distance_m"] == 50

    def test_sql_row_without_geo_match_is_included_unchanged(self) -> None:
        sql_rows = [{"id": "p1", "name": "A"}, {"id": "p99", "name": "Z"}]
        geo_rows = [{"id": "p1", "distance_m": 50}]
        merged = merge_rows_preserving_order(sql_rows, geo_rows)
        assert len(merged) == 2
        assert merged[1]["id"] == "p99"
        assert "distance_m" not in merged[1]

    def test_geo_rows_not_in_sql_are_excluded(self) -> None:
        sql_rows = [{"id": "p1", "name": "A"}]
        geo_rows = [{"id": "p1", "distance_m": 50}, {"id": "p9", "distance_m": 10}]
        merged = merge_rows_preserving_order(sql_rows, geo_rows)
        assert len(merged) == 1
        assert merged[0]["id"] == "p1"

    def test_empty_sql_rows_returns_empty(self) -> None:
        geo_rows = [{"id": "p1", "distance_m": 50}]
        assert merge_rows_preserving_order([], geo_rows) == []

    def test_empty_geo_rows_returns_sql_rows(self) -> None:
        sql_rows = [{"id": "p1", "name": "A"}]
        merged = merge_rows_preserving_order(sql_rows, [])
        assert merged == [{"id": "p1", "name": "A"}]

    def test_sql_row_without_id_is_included(self) -> None:
        sql_rows = [{"name": "No ID"}]
        geo_rows = [{"id": "p1", "distance_m": 50}]
        merged = merge_rows_preserving_order(sql_rows, geo_rows)
        assert merged == [{"name": "No ID"}]

    def test_geo_rows_without_id_are_excluded_from_index(self) -> None:
        sql_rows = [{"id": "p1", "name": "A"}]
        geo_rows = [{"name": "No ID"}, {"id": "p1", "distance_m": 50}]
        merged = merge_rows_preserving_order(sql_rows, geo_rows)
        assert merged[0]["distance_m"] == 50
