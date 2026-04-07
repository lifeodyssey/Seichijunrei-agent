"""Contract tests for the SSE streaming endpoint.

Validates that ``POST /v1/runtime/stream`` emits Server-Sent Events in the
expected order (``planning`` -> ``step*`` -> ``done``) and that the final
``done`` payload conforms to the PublicAPIResponse shape.
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock

from fastapi.testclient import TestClient

from backend.config.settings import Settings
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.interfaces.fastapi_service import create_fastapi_app
from backend.interfaces.public_api import PublicAPIResponse, RuntimeAPI

# ── Helpers ──────────────────────────────────────────────────────────────────


def _canned_response() -> PublicAPIResponse:
    return PublicAPIResponse(
        success=True,
        status="ok",
        intent="search_bangumi",
        session_id="sess-sse",
        message="Found 0 pilgrimage spots.",
        data={"results": {"rows": [], "row_count": 0}},
        ui={"component": "PilgrimageGrid"},
    )


def _parse_sse_events(raw: str) -> list[dict[str, object]]:
    """Parse raw SSE text into a list of {event, data} dicts."""
    events: list[dict[str, object]] = []
    current_event: str | None = None
    current_data_lines: list[str] = []

    for line in raw.split("\n"):
        if line.startswith("event: "):
            current_event = line[len("event: ") :]
        elif line.startswith("data: "):
            current_data_lines.append(line[len("data: ") :])
        elif line == "" and current_event is not None:
            data_str = "\n".join(current_data_lines)
            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                data = data_str
            events.append({"event": current_event, "data": data})
            current_event = None
            current_data_lines = []

    return events


def _mock_db() -> MagicMock:
    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.upsert_session = AsyncMock()
    db.upsert_conversation = AsyncMock()
    db.insert_message = AsyncMock()
    db.insert_request_log = AsyncMock()
    return db


def _build_runtime_api_mock(
    response: PublicAPIResponse | None = None,
    *,
    emit_steps: bool = True,
) -> MagicMock:
    """Build a mock RuntimeAPI whose ``handle`` optionally emits on_step calls."""
    canned = response or _canned_response()
    api = MagicMock(spec=RuntimeAPI)
    api._db = _mock_db()
    api._session_store = InMemorySessionStore()

    async def handle_side_effect(
        request: object,
        *,
        user_id: str | None = None,
        on_step: object = None,
    ) -> PublicAPIResponse:
        if emit_steps and on_step is not None and callable(on_step):
            await on_step("search_bangumi", "running", {"bangumi_id": "12345"})
            await on_step("search_bangumi", "done", {"rows": [], "row_count": 0})
        return canned

    api.handle = AsyncMock(side_effect=handle_side_effect)
    return api


# ── SSE event ordering ───────────────────────────────────────────────────────


class TestSSEEventOrdering:
    def test_stream_starts_with_planning_event(self) -> None:
        api = _build_runtime_api_mock()
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/v1/runtime/stream",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            ) as resp:
                body = "".join(resp.iter_text())

        events = _parse_sse_events(body)
        assert len(events) >= 1
        assert events[0]["event"] == "planning"

    def test_stream_ends_with_done_event(self) -> None:
        api = _build_runtime_api_mock()
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/v1/runtime/stream",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            ) as resp:
                body = "".join(resp.iter_text())

        events = _parse_sse_events(body)
        done_events = [e for e in events if e["event"] == "done"]
        assert len(done_events) == 1

    def test_event_order_is_planning_then_steps_then_done(self) -> None:
        api = _build_runtime_api_mock(emit_steps=True)
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/v1/runtime/stream",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            ) as resp:
                body = "".join(resp.iter_text())

        events = _parse_sse_events(body)
        event_names = [e["event"] for e in events]

        # First event must be planning
        assert event_names[0] == "planning"
        # Last event must be done
        assert event_names[-1] == "done"
        # Middle events (if any) must be step
        for name in event_names[1:-1]:
            assert name == "step"


# ── Done event shape ─────────────────────────────────────────────────────────


class TestSSEDoneEventShape:
    def test_done_event_contains_public_api_response_keys(self) -> None:
        api = _build_runtime_api_mock()
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/v1/runtime/stream",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            ) as resp:
                body = "".join(resp.iter_text())

        events = _parse_sse_events(body)
        done_events = [e for e in events if e["event"] == "done"]
        assert len(done_events) == 1

        data = done_events[0]["data"]
        assert isinstance(data, dict)
        for key in ("success", "status", "intent", "message", "data", "errors"):
            assert key in data, f"done event missing key: {key}"

        assert isinstance(data["success"], bool)
        assert isinstance(data["status"], str)
        assert isinstance(data["intent"], str)
        assert isinstance(data["errors"], list)


# ── Step event shape ─────────────────────────────────────────────────────────


class TestSSEStepEventShape:
    def test_step_events_have_required_keys(self) -> None:
        api = _build_runtime_api_mock(emit_steps=True)
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/v1/runtime/stream",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            ) as resp:
                body = "".join(resp.iter_text())

        events = _parse_sse_events(body)
        step_events = [e for e in events if e["event"] == "step"]
        assert len(step_events) >= 1

        for step in step_events:
            data = step["data"]
            assert isinstance(data, dict)
            for key in ("tool", "status"):
                assert key in data, f"step event missing key: {key}"
            assert isinstance(data["tool"], str)
            assert isinstance(data["status"], str)


# ── Planning event shape ─────────────────────────────────────────────────────


class TestSSEPlanningEventShape:
    def test_planning_event_has_status(self) -> None:
        api = _build_runtime_api_mock()
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/v1/runtime/stream",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            ) as resp:
                body = "".join(resp.iter_text())

        events = _parse_sse_events(body)
        planning = [e for e in events if e["event"] == "planning"]
        assert len(planning) == 1
        data = planning[0]["data"]
        assert isinstance(data, dict)
        assert "status" in data


# ── Error event shape ────────────────────────────────────────────────────────


class TestSSEErrorEvent:
    def test_runtime_error_emits_error_event_with_code_and_message(self) -> None:
        api = MagicMock(spec=RuntimeAPI)
        api.handle = AsyncMock(side_effect=RuntimeError("boom"))
        api._db = _mock_db()
        api._session_store = InMemorySessionStore()
        app = create_fastapi_app(runtime_api=api, settings=Settings())

        with TestClient(app) as client:
            with client.stream(
                "POST",
                "/v1/runtime/stream",
                json={"text": "京吹の聖地"},
                headers={"X-User-Id": "user-1"},
            ) as resp:
                body = "".join(resp.iter_text())

        events = _parse_sse_events(body)
        error_events = [e for e in events if e["event"] == "error"]
        assert len(error_events) == 1
        data = error_events[0]["data"]
        assert isinstance(data, dict)
        assert "code" in data
        assert "message" in data

    def test_blank_text_on_stream_returns_422(self) -> None:
        api = _build_runtime_api_mock()
        app = create_fastapi_app(runtime_api=api, settings=Settings())
        with TestClient(app) as client:
            resp = client.post(
                "/v1/runtime/stream",
                json={"text": "  "},
                headers={"X-User-Id": "user-1"},
            )
        assert resp.status_code == 422
        body = resp.json()
        assert "error" in body
