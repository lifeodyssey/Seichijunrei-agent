"""E2E API tests — real LLM + real Supabase.

Calls run_pipeline() against a live database to verify the full chain:
intent classification → plan → retrieval → response shaping.

These tests require:
    - SUPABASE_DB_URL pointing to a real database with seeded data
    - EVAL_MODEL or default LM Studio for LLM fallback

Usage:
    uv run python -m pytest tests/eval/test_api_e2e.py -v --no-cov
    EVAL_MODEL=gemini-2.0-flash uv run python -m pytest tests/eval/test_api_e2e.py -v --no-cov
"""

from __future__ import annotations

import os

import pytest
from dotenv import load_dotenv

from backend.agents.pipeline import run_pipeline
from backend.config.settings import get_settings
from backend.infrastructure.supabase.client import SupabaseClient

load_dotenv()

# Skip entire module if no real DB configured
_settings = get_settings()
_dsn = _settings.supabase_db_url.strip()
pytestmark = [
    pytest.mark.skipif(not _dsn, reason="SUPABASE_DB_URL not set"),
    pytest.mark.integration,
]


def _make_model():
    """Reuse the model factory from intent eval."""
    from tests.eval.test_intent_llm import make_model

    return make_model(os.environ.get("EVAL_MODEL"))


@pytest.fixture
async def db():
    """Provide a real SupabaseClient connected to Supabase."""
    client = SupabaseClient(_dsn)
    await client.connect()
    yield client
    await client.close()


# ── Cases from real debugging session 2026-03-22 ─────────────────────


async def test_bangumi_search_returns_rows_with_coordinates(db: SupabaseClient):
    """秒速5センチメートル search should return rows with screenshots and coords."""
    result = await run_pipeline("秒速5センチメートル の聖地を探して", db)

    assert result.success
    assert result.intent == "search_by_bangumi"

    rows = result.final_output.get("data", {}).get("results", {}).get("rows", [])
    assert len(rows) > 0, "Expected at least 1 row"

    first = rows[0]
    assert first.get("screenshot_url"), "Row missing screenshot_url"
    assert first.get("latitude") is not None, (
        "Row missing latitude (location backfill issue?)"
    )
    assert first.get("longitude") is not None, "Row missing longitude"
    assert first.get("name"), "Row missing name"


async def test_geo_search_uji_returns_nearby_points(db: SupabaseClient):
    """宇治駅 geo search should find nearby pilgrimage points with distance."""
    result = await run_pipeline("宇治駅の近くにある聖地を教えて", db)

    assert result.success
    assert result.intent == "search_by_location"

    rows = result.final_output.get("data", {}).get("results", {}).get("rows", [])
    assert len(rows) > 0, "Expected points near Uji station (location backfilled?)"

    first = rows[0]
    assert "distance_m" in first, "Geo result missing distance_m"
    assert first["distance_m"] < 10000, "First result should be within 10km"


async def test_route_planning_returns_ordered_points_with_coords(db: SupabaseClient):
    """Route planning should return ordered points with coordinates."""
    result = await run_pipeline("新宿から君の名はの聖地を回るルートを作って", db)

    assert result.success
    assert result.intent == "plan_route"

    route = result.final_output.get("data", {}).get("route", {})
    points = route.get("ordered_points", [])
    assert len(points) > 0, "Route should have at least 1 point"

    with_coords = sum(1 for p in points if p.get("latitude") is not None)
    assert with_coords == len(points), (
        f"All route points should have coordinates, got {with_coords}/{len(points)}"
    )


async def test_unclear_input_returns_clarification(db: SupabaseClient):
    """Vague input should return needs_clarification without errors."""
    result = await run_pipeline("你好", db)

    assert result.success
    assert result.intent == "unclear"
    assert result.final_output.get("data", {}).get("status") == "needs_clarification"


# ── Locale / i18n tests (real LLM message generation) ─────────────


async def test_unclear_message_is_japanese_when_locale_ja(db: SupabaseClient):
    """locale=ja should produce a Japanese clarification message."""
    result = await run_pipeline("hello", db, locale="ja")

    assert result.success
    assert result.intent == "unclear"
    msg = result.final_output.get("message", "")
    assert msg, "Expected non-empty message"
    # Should contain Japanese characters (hiragana/katakana/kanji), not English
    import re

    assert re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", msg), (
        f"Expected Japanese characters in message, got: {msg}"
    )


async def test_unclear_message_is_chinese_when_locale_zh(db: SupabaseClient):
    """locale=zh should produce a Chinese clarification message."""
    result = await run_pipeline("hello", db, locale="zh")

    assert result.success
    assert result.intent == "unclear"
    msg = result.final_output.get("message", "")
    assert msg, "Expected non-empty message"
    import re

    assert re.search(r"[\u4e00-\u9fff]", msg), (
        f"Expected Chinese characters in message, got: {msg}"
    )


async def test_bangumi_search_message_respects_locale_zh(db: SupabaseClient):
    """Bangumi search with locale=zh should return a Chinese message."""
    result = await run_pipeline("秒速5厘米的取景地在哪", db, locale="zh")

    assert result.success
    assert result.intent == "search_by_bangumi"
    msg = result.final_output.get("message", "")
    if msg:  # empty message is acceptable for success cases
        import re

        assert re.search(r"[\u4e00-\u9fff]", msg), (
            f"Expected Chinese in message, got: {msg}"
        )


async def test_route_message_respects_locale_ja(db: SupabaseClient):
    """Route planning with locale=ja should return a Japanese message."""
    result = await run_pipeline(
        "新宿から君の名はの聖地を回るルートを作って", db, locale="ja"
    )

    assert result.success
    assert result.intent == "plan_route"
    msg = result.final_output.get("message", "")
    if msg:
        import re

        assert re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", msg), (
            f"Expected Japanese in message, got: {msg}"
        )
