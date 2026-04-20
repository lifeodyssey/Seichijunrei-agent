"""Retriever strategy submodules.

Re-exports for convenient import from backend.agents.retrievers.
"""

from backend.agents.retrievers.enrichment import (
    ensure_bangumi_record,
    fetch_bangumi_lite,
    load_bangumi_metadata,
    persist_points,
    point_to_db_row,
    subject_to_bangumi_fields,
    update_bangumi_points_count,
    write_through_bangumi_points,
)
from backend.agents.retrievers.geo import (
    fetch_geo_rows,
    get_area_suggestions,
    records_to_dicts,
)
from backend.agents.retrievers.hybrid import merge_rows_preserving_order
from backend.agents.retrievers.sql import (
    execute_sql_with_fallback,
    should_try_db_miss_fallback,
)

__all__ = [
    "ensure_bangumi_record",
    "execute_sql_with_fallback",
    "fetch_bangumi_lite",
    "fetch_geo_rows",
    "get_area_suggestions",
    "load_bangumi_metadata",
    "merge_rows_preserving_order",
    "persist_points",
    "point_to_db_row",
    "records_to_dicts",
    "should_try_db_miss_fallback",
    "subject_to_bangumi_fields",
    "update_bangumi_points_count",
    "write_through_bangumi_points",
]
