"""Unit tests for backend.agents.tools."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from backend.agents.runtime_deps import RuntimeDeps
from backend.agents.tools import enrich_clarify_candidates


async def test_enrich_clarify_candidates_keeps_order_and_defaults() -> None:
    db = MagicMock()
    db.bangumi = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        return_value=[
            {
                "title": "凉宫春日的忧郁",
                "bangumi_id": "253",
                "cover_url": "https://example.com/a.jpg",
                "points_count": 12,
                "city": "西宫",
            },
            {
                "title": "凉宫春日的消失",
                "bangumi_id": "254",
                "cover_url": None,
                "points_count": 0,
                "city": "",
            },
        ]
    )
    deps = RuntimeDeps(db=db, locale="zh", query="q")

    candidates = await enrich_clarify_candidates(
        deps, ["凉宫春日的忧郁", "凉宫春日的消失"]
    )

    assert [c["title"] for c in candidates] == ["凉宫春日的忧郁", "凉宫春日的消失"]
    assert candidates[0]["cover_url"] == "https://example.com/a.jpg"
    assert candidates[0]["spot_count"] == 12
    assert candidates[0]["city"] == "西宫"
    assert candidates[1]["cover_url"] is None
    assert candidates[1]["spot_count"] == 0


async def test_enrich_clarify_candidates_falls_back_to_gateway_and_writes_through() -> (
    None
):
    db = MagicMock()
    db.bangumi = MagicMock()
    db.bangumi.find_candidate_details_by_titles = AsyncMock(
        return_value=[
            {
                "title": "凉宫春日的忧郁",
                "bangumi_id": None,
                "cover_url": None,
                "points_count": 0,
                "city": "",
            }
        ]
    )
    db.bangumi.upsert_bangumi_title = AsyncMock(return_value=None)
    db.bangumi.upsert_bangumi = AsyncMock(return_value=None)

    gateway = MagicMock()
    gateway.search_by_title = AsyncMock(return_value="999")
    gateway.get_subject = AsyncMock(
        return_value={
            "images": {
                "large": "https://example.com/c.jpg",
            }
        }
    )
    deps = RuntimeDeps(db=db, locale="zh", query="q", gateway=gateway)

    candidates = await enrich_clarify_candidates(deps, ["凉宫春日的忧郁"])

    assert candidates[0]["cover_url"] == "https://example.com/c.jpg"
    db.bangumi.upsert_bangumi_title.assert_awaited_once_with("凉宫春日的忧郁", "999")
    db.bangumi.upsert_bangumi.assert_awaited()
