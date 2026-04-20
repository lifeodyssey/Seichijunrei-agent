"""Hybrid retrieval: merge SQL-constrained rows with geo proximity results."""

from __future__ import annotations


def merge_rows_preserving_order(
    sql_rows: list[dict[str, object]],
    geo_rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Merge SQL rows with geo rows, keeping SQL order as the primary ranking."""
    geo_by_id = {
        str(row.get("id")): row for row in geo_rows if row.get("id") is not None
    }

    merged: list[dict[str, object]] = []
    for sql_row in sql_rows:
        row_id = str(sql_row.get("id")) if sql_row.get("id") is not None else None
        if row_id is None:
            merged.append(dict(sql_row))
            continue

        geo_row = geo_by_id.get(row_id)
        if geo_row is None:
            merged.append(dict(sql_row))
            continue

        combined = dict(geo_row)
        combined.update(sql_row)
        merged.append(combined)

    return merged
