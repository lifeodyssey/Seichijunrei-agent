"""Unit tests for ExecutorAgent — route optimization wiring."""

from __future__ import annotations

import pytest

from backend.agents.executor_agent import ExecutorAgent


class FakeDB:
    async def find_bangumi_by_title(self, title: str) -> str | None:
        return "12345"

    async def upsert_bangumi_title(self, title: str, bid: str) -> None:
        pass


@pytest.fixture
def executor() -> ExecutorAgent:
    return ExecutorAgent(FakeDB())


async def test_plan_route_returns_timed_itinerary(executor: ExecutorAgent) -> None:
    """_optimize_route produces backward-compat ordered_points AND timed_itinerary."""
    rows: list[dict[str, object]] = [
        {
            "id": "p1",
            "latitude": 34.890,
            "longitude": 135.800,
            "name": "Spot A",
            "episode": 1,
            "time_seconds": 0,
            "screenshot_url": "",
            "bangumi_id": "12345",
        },
        {
            "id": "p2",
            "latitude": 34.891,
            "longitude": 135.801,
            "name": "Spot B",
            "episode": 2,
            "time_seconds": 0,
            "screenshot_url": "",
            "bangumi_id": "12345",
        },
    ]
    result = await executor._optimize_route(rows, {}, None)
    assert result.success
    assert isinstance(result.data, dict)
    assert "ordered_points" in result.data
    assert "timed_itinerary" in result.data
    itinerary = result.data["timed_itinerary"]
    assert len(itinerary["stops"]) > 0
    assert itinerary["total_minutes"] >= 0


async def test_optimize_route_empty_rows(executor: ExecutorAgent) -> None:
    """Empty valid rows returns failure."""
    rows: list[dict[str, object]] = [
        {"id": "p1", "latitude": 0.0, "longitude": 0.0, "name": "Null Island"},
    ]
    result = await executor._optimize_route(rows, {}, None)
    assert not result.success
    assert result.error == "No valid coordinates"


async def test_optimize_route_pacing_param(executor: ExecutorAgent) -> None:
    """Pacing param is forwarded to itinerary builder."""
    rows: list[dict[str, object]] = [
        {
            "id": "p1",
            "latitude": 35.0,
            "longitude": 139.0,
            "name": "Spot",
            "screenshot_url": "",
        },
    ]
    result = await executor._optimize_route(
        rows, {"pacing": "chill", "start_time": "10:00"}, None
    )
    assert result.success
    assert isinstance(result.data, dict)
    itinerary = result.data["timed_itinerary"]
    assert itinerary["pacing"] == "chill"
    assert itinerary["start_time"] == "10:00"


async def test_optimize_route_summary_fields(executor: ExecutorAgent) -> None:
    """Summary includes cluster count, total_minutes, total_distance_m."""
    rows: list[dict[str, object]] = [
        {
            "id": "p1",
            "latitude": 34.890,
            "longitude": 135.800,
            "name": "A",
            "screenshot_url": "",
        },
        {
            "id": "p2",
            "latitude": 34.891,
            "longitude": 135.801,
            "name": "B",
            "screenshot_url": "",
        },
    ]
    result = await executor._optimize_route(rows, {}, None)
    assert result.success
    assert isinstance(result.data, dict)
    summary = result.data["summary"]
    assert "clusters" in summary
    assert "total_minutes" in summary
    assert "total_distance_m" in summary
