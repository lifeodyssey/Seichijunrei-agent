"""Frontend contract tests — TDD RED phase.

Defines the exact response shape the frontend consumes.
Failures reveal backend gaps. Requires: make serve + env vars.
"""

from __future__ import annotations

import json
import os
from typing import cast

import pytest

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore[assignment]

_API_URL = os.environ.get("SEICHI_API_URL", "")
_API_KEY = os.environ.get("SEICHI_API_KEY", "")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        not _API_URL or not _API_KEY,
        reason="SEICHI_API_URL and SEICHI_API_KEY required",
    ),
]

_HDR: dict[str, str] = {
    "Authorization": f"Bearer {_API_KEY}",
    "Content-Type": "application/json",
}

_TIMEOUT = aiohttp.ClientTimeout(total=30) if aiohttp else None


async def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
) -> tuple[int, dict[str, object]]:
    """Shared HTTP helper for POST/GET against the runtime API."""
    assert aiohttp is not None, "aiohttp is required for contract tests"
    kwargs: dict[str, object] = {"headers": _HDR, "timeout": _TIMEOUT}
    if body is not None:
        kwargs["json"] = body
    async with aiohttp.ClientSession() as s:
        async with getattr(s, method)(f"{_API_URL}{path}", **kwargs) as r:
            return r.status, cast(dict[str, object], await r.json())


async def _post(path: str, body: dict[str, object]) -> tuple[int, dict[str, object]]:
    return await _request("post", path, body)


async def _get(path: str) -> tuple[int, dict[str, object]]:
    return await _request("get", path)


async def _search_euphonium() -> list[dict[str, object]]:
    """Search euphonium and return rows (helper for route tests)."""
    st, body = await _post(
        "/v1/runtime", {"text": "響け！ユーフォニアム", "locale": "ja"}
    )
    assert st == 200
    data = cast(dict[str, object], body["data"])
    results = cast(dict[str, object], data["results"])
    return cast(list[dict[str, object]], results["rows"])


async def _plan_route(point_ids: list[str]) -> tuple[int, dict[str, object]]:
    """Plan route with given point IDs (helper)."""
    return await _post(
        "/v1/runtime",
        {
            "selected_point_ids": point_ids,
            "origin": "宇治駅",
            "locale": "ja",
        },
    )


async def _search_and_plan() -> tuple[list[dict[str, object]], dict[str, object]]:
    """Search + plan route combo used by AC-4 tests."""
    rows = await _search_euphonium()
    ids = [str(r["id"]) for r in rows[:3]]
    assert len(ids) >= 2, "Need at least 2 points"
    _, body = await _plan_route(ids)
    return rows, body


def _parse_sse(raw: str) -> list[dict[str, object]]:
    """Parse raw SSE text into [{event, data}, ...]."""
    events: list[dict[str, object]] = []
    cur_event: str | None = None
    data_buf: list[str] = []
    for line in raw.split("\n"):
        if line.startswith("event: "):
            cur_event = line[7:]
        elif line.startswith("data: "):
            data_buf.append(line[6:])
        elif line == "" and cur_event is not None:
            raw_data = "\n".join(data_buf)
            try:
                parsed = json.loads(raw_data)
            except json.JSONDecodeError:
                parsed = raw_data
            events.append({"event": cur_event, "data": parsed})
            cur_event = None
            data_buf = []
    return events


# ── AC-1: Search by anime title ─────────────────────────────────────────────


class TestAC1SearchBangumi:
    """Search by anime title returns typed PilgrimagePoint rows."""

    async def test_returns_200_with_success(self) -> None:
        status, body = await _post(
            "/v1/runtime",
            {"text": "響け！ユーフォニアムの聖地", "locale": "ja"},
        )
        assert status == 200
        assert body["success"] is True

    async def test_intent_is_search_bangumi(self) -> None:
        status, body = await _post(
            "/v1/runtime",
            {"text": "響け！ユーフォニアム", "locale": "ja"},
        )
        assert status == 200
        assert body["intent"] in ("search_bangumi", "search_by_bangumi")

    async def test_rows_are_present_and_non_empty(self) -> None:
        rows = await _search_euphonium()
        assert isinstance(rows, list)
        assert len(rows) > 0

    async def test_rows_have_required_pilgrimage_point_fields(self) -> None:
        """Every row must match frontend PilgrimagePoint type."""
        rows = await _search_euphonium()
        required = {"id", "name", "latitude", "longitude", "bangumi_id"}
        for row in rows:
            for f in required:
                assert f in row, f"Missing required field: {f}"
            assert isinstance(row["latitude"], (int, float))
            assert isinstance(row["longitude"], (int, float))
            assert row["latitude"] != 0 or row["longitude"] != 0


# ── AC-2: Nearby search ─────────────────────────────────────────────────────

_NEARBY_BODY: dict[str, object] = {
    "text": "附近有什么动漫圣地",
    "locale": "zh",
    "origin_lat": 34.886,
    "origin_lng": 135.805,
}


class TestAC2SearchNearby:
    """Nearby search with coordinates returns distance-sorted results."""

    async def test_intent_is_search_nearby(self) -> None:
        status, body = await _post("/v1/runtime", _NEARBY_BODY)
        assert status == 200
        assert body["intent"] in ("search_nearby", "search_by_location")

    async def test_rows_have_distance_m(self) -> None:
        """Each row should include distance_m for frontend sorting."""
        status, body = await _post("/v1/runtime", _NEARBY_BODY)
        assert status == 200
        data = cast(dict[str, object], body["data"])
        results = cast(dict[str, object], data["results"])
        rows = cast(list[dict[str, object]], results["rows"])
        assert isinstance(rows, list)
        for row in rows:
            assert "distance_m" in row, "Row must include distance_m"
            assert isinstance(row["distance_m"], (int, float))


# ── AC-3: Clarification with candidates ─────────────────────────────────────


class TestAC3ClarifyWithCandidates:
    """Ambiguous query returns clarify with REQUIRED candidates[]."""

    async def test_clarify_has_question_and_options(self) -> None:
        status, body = await _post("/v1/runtime", {"text": "涼宮", "locale": "zh"})
        assert status == 200
        data = cast(dict[str, object], body["data"])
        assert (
            data.get("status") == "needs_clarification"
            or body.get("intent") == "clarify"
        )
        assert "question" in data
        assert isinstance(data["options"], list)
        assert len(cast(list[object], data["options"])) >= 2

    async def test_clarify_has_candidates_with_metadata(self) -> None:
        """Backend must send candidates[] with structured metadata."""
        status, body = await _post("/v1/runtime", {"text": "涼宮", "locale": "zh"})
        assert status == 200
        data = cast(dict[str, object], body["data"])
        assert "candidates" in data, "Backend must send candidates[] with metadata"
        cands = cast(list[dict[str, object]], data["candidates"])
        assert isinstance(cands, list) and len(cands) >= 2
        for c in cands:
            for key in ("title", "spot_count", "city", "cover_url"):
                assert key in c, f"candidate missing {key}"


# ── AC-4: Route planning with selected points ───────────────────────────────


class TestAC4PlanSelectedRoute:
    """Route planning with selected point IDs returns timed itinerary."""

    async def test_plan_selected_returns_route(self) -> None:
        _, body = await _search_and_plan()
        assert body["intent"] in ("plan_selected", "plan_route")

    async def test_route_has_ordered_points_and_count(self) -> None:
        _, body = await _search_and_plan()
        route = cast(dict[str, object], cast(dict[str, object], body["data"])["route"])
        ordered = cast(list[object], route["ordered_points"])
        assert isinstance(ordered, list) and len(ordered) >= 2
        assert route["point_count"] == len(ordered)

    async def test_route_has_timed_itinerary(self) -> None:
        """Frontend needs timed_itinerary for timeline display."""
        _, body = await _search_and_plan()
        route = cast(dict[str, object], cast(dict[str, object], body["data"])["route"])
        assert "timed_itinerary" in route, "route must contain timed_itinerary"
        itin = cast(dict[str, object], route["timed_itinerary"])
        assert isinstance(itin["stops"], list)
        assert isinstance(itin["legs"], list)
        assert isinstance(itin["total_minutes"], (int, float))
        assert isinstance(itin["total_distance_m"], (int, float))


# ── AC-5: SSE streaming ─────────────────────────────────────────────────────


class TestAC5SSEStream:
    """SSE streaming returns step events + done event with full response."""

    async def _stream_euphonium(self) -> list[dict[str, object]]:
        assert aiohttp is not None
        async with aiohttp.ClientSession() as s:
            async with s.post(
                f"{_API_URL}/v1/runtime/stream",
                json={"text": "響け！ユーフォニアム", "locale": "ja"},
                headers=_HDR,
                timeout=_TIMEOUT,
            ) as r:
                assert r.status == 200
                return _parse_sse(await r.text())

    async def test_sse_stream_returns_step_and_done_events(self) -> None:
        events = await self._stream_euphonium()
        steps = [e for e in events if e.get("event") == "step"]
        dones = [e for e in events if e.get("event") == "done"]
        assert len(steps) >= 1, "No step events received"
        assert len(dones) == 1, "Expected exactly 1 done event"

    async def test_done_event_has_full_response_shape(self) -> None:
        events = await self._stream_euphonium()
        dones = [e for e in events if e.get("event") == "done"]
        assert len(dones) == 1
        done = cast(dict[str, object], dones[0]["data"])
        assert "intent" in done
        assert "data" in done
        assert "message" in done


# ── AC-6: Popular anime endpoint ─────────────────────────────────────────────


class TestAC6BangumiPopular:
    """Popular anime endpoint returns bangumi list with cover URLs."""

    async def test_popular_returns_200_list(self) -> None:
        status, body = await _get("/v1/bangumi/popular")
        assert status == 200
        assert isinstance(body.get("bangumi"), list)
        assert len(cast(list[object], body["bangumi"])) > 0

    async def test_popular_items_have_required_fields(self) -> None:
        status, body = await _get("/v1/bangumi/popular")
        assert status == 200
        items = cast(list[dict[str, object]], body["bangumi"])
        for item in items:
            assert "id" in item or "bangumi_id" in item
            assert "title" in item
            assert "cover_url" in item
