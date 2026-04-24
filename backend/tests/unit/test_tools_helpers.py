"""Unit tests for tools.py helper functions (split for coverage)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from backend.agents.runtime_deps import RuntimeDeps
from backend.agents.tools import (
    _candidate_from_row,
    _db_lookup,
    _fetch_cover,
    _gateway_fallback,
    _write_through,
    enrich_clarify_candidates,
)


async def test_db_lookup_returns_empty_when_no_repo() -> None:
    deps = RuntimeDeps(db=MagicMock(spec=[]), locale="zh", query="q")
    result = await _db_lookup(deps, ["test"])
    assert result == {}


async def test_db_lookup_returns_empty_on_db_error() -> None:
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        side_effect=OSError("connection lost")
    )
    deps = RuntimeDeps(db=db, locale="zh", query="q")
    result = await _db_lookup(deps, ["test"])
    assert result == {}


async def test_db_lookup_skips_non_dict_rows() -> None:
    db = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        return_value=["not_a_dict", {"title": "好", "bangumi_id": "1"}]
    )
    deps = RuntimeDeps(db=db, locale="zh", query="q")
    result = await _db_lookup(deps, ["好"])
    assert "好" in result


def test_candidate_from_row_with_full_data() -> None:
    row = {
        "cover_url": "https://example.com/img.jpg",
        "points_count": 5,
        "city": "京都",
    }
    c = _candidate_from_row("響け", row)
    assert c["title"] == "響け"
    assert c["cover_url"] == "https://example.com/img.jpg"
    assert c["spot_count"] == 5
    assert c["city"] == "京都"


def test_candidate_from_row_with_empty_data() -> None:
    c = _candidate_from_row("test", {})
    assert c["cover_url"] is None
    assert c["spot_count"] == 0
    assert c["city"] == ""


async def test_fetch_cover_returns_large_image() -> None:
    deps = RuntimeDeps(db=MagicMock(), locale="zh", query="q")
    deps.gateway = MagicMock()
    deps.gateway.get_subject = AsyncMock(
        return_value={"images": {"large": "https://img.example.com/large.jpg"}}
    )
    result = await _fetch_cover(deps, "12345")
    assert result == "https://img.example.com/large.jpg"


async def test_fetch_cover_returns_none_on_error() -> None:
    deps = RuntimeDeps(db=MagicMock(), locale="zh", query="q")
    deps.gateway = MagicMock()
    deps.gateway.get_subject = AsyncMock(side_effect=OSError("timeout"))
    result = await _fetch_cover(deps, "12345")
    assert result is None


async def test_fetch_cover_returns_none_for_non_digit_id() -> None:
    deps = RuntimeDeps(db=MagicMock(), locale="zh", query="q")
    result = await _fetch_cover(deps, "not-a-number")
    assert result is None


async def test_gateway_fallback_returns_minimal_on_error() -> None:
    deps = RuntimeDeps(db=MagicMock(spec=[]), locale="zh", query="q")
    deps.gateway = MagicMock()
    deps.gateway.search_by_title = AsyncMock(side_effect=OSError("fail"))
    result = await _gateway_fallback(deps, "test")
    assert result["title"] == "test"
    assert result["cover_url"] is None
    assert result["spot_count"] == 0


async def test_write_through_logs_on_upsert_error() -> None:
    db = MagicMock()
    db.bangumi.upsert_bangumi_title = AsyncMock(side_effect=RuntimeError("fail"))
    db.bangumi.upsert_bangumi = AsyncMock()
    deps = RuntimeDeps(db=db, locale="zh", query="q")
    await _write_through(deps, "test", "123", "https://img.example.com/x.jpg")
    db.bangumi.upsert_bangumi_title.assert_awaited_once()


async def test_enrich_empty_titles_returns_empty() -> None:
    deps = RuntimeDeps(db=MagicMock(), locale="zh", query="q")
    result = await enrich_clarify_candidates(deps, [])
    assert result == []
