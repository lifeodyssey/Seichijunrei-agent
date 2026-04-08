"""Shared helpers for Supabase repository modules.

Column allowlists, validation, and utility functions used across repositories.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from numbers import Real

from backend.infrastructure.supabase.client_types import Row

_BANGUMI_COLUMNS = frozenset(
    {
        "title",
        "title_cn",
        "cover_url",
        "air_date",
        "summary",
        "eps_count",
        "rating",
        "points_count",
        "primary_color",
        "city",
    }
)
_POINT_COLUMNS = frozenset(
    {
        "bangumi_id",
        "name",
        "name_cn",
        "latitude",
        "longitude",
        "episode",
        "time_seconds",
        "image",
        "scene_desc",
        "embedding",
        "origin",
        "origin_url",
        "location",
    }
)


def _validate_columns(columns: frozenset[str], fields: Mapping[str, object]) -> None:
    """Raise ValueError if any field key is not in the allowlist."""
    bad = set(fields.keys()) - columns
    if bad:
        raise ValueError(f"Invalid column names: {bad}")


def _vector_literal(value: object) -> str:
    """Normalize a vector value into pgvector's text literal format."""
    if isinstance(value, str):
        return value

    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        items: list[str] = []
        for item in value:
            if not isinstance(item, Real):
                raise TypeError("Embedding values must be numeric")
            items.append(f"{float(item):g}")
        return f"[{','.join(items)}]"

    raise TypeError("Embedding must be a vector literal string or numeric sequence")


def _prepare_point_fields(fields: dict[str, object]) -> dict[str, object]:
    """Normalize point payloads before building dynamic SQL."""
    prepared = dict(fields)
    if "embedding" in prepared and prepared["embedding"] is not None:
        prepared["embedding"] = _vector_literal(prepared["embedding"])
    return prepared


def _decode_json_list(raw: object) -> list[dict[str, object]]:
    """Decode a JSON/JSONB payload into a list of dicts."""
    if raw is None:
        return []
    if isinstance(raw, str):
        decoded = json.loads(raw)
    elif isinstance(raw, Sequence) and not isinstance(raw, (str, bytes, bytearray)):
        decoded = raw
    else:
        return []

    if not isinstance(decoded, Sequence):
        return []

    return [dict(item) for item in decoded if isinstance(item, Mapping)]


def _point_placeholder(column: str, position: int) -> str:
    """Return the SQL placeholder for a point column."""
    if column == "location":
        return f"ST_GeogFromText(${position})"
    if column == "embedding":
        return f"${position}::vector"
    return f"${position}"


def _require_row(row: Row | None, *, operation: str) -> Row:
    if row is None:
        raise RuntimeError(f"Database did not return a row for {operation}")
    return row
