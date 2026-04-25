"""Runtime journey contract tests.

Tests that the sync runtime endpoint returns correct stage contracts for
frontend journey rendering. These tests define the expected behavior BEFORE
the runtime refactoring — they should FAIL until the implementation matches.

Endpoints under test:
  POST /v1/runtime
  GET  /v1/bangumi/popular
  GET  /v1/routes
  GET  /v1/conversations/{session_id}/messages
"""

from __future__ import annotations

import pytest


@pytest.mark.integration
def test_runtime_clarify_response_has_full_contract(client):
    """AC A: clarify response must have intent=clarify, message, full data shape."""
    response = client.post("/v1/runtime", json={"text": "凉宫", "locale": "zh"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["intent"] == "clarify"
    assert payload["message"], "clarify message must be non-empty"
    data = payload["data"]
    assert data["status"] == "needs_clarification"
    assert "question" in data
    assert "options" in data
    assert "candidates" in data
    assert isinstance(data["candidates"], list)


@pytest.mark.integration
def test_runtime_clarify_candidate_has_required_fields(client):
    """AC A: each clarify candidate must have title, cover_url, spot_count, city."""
    response = client.post("/v1/runtime", json={"text": "涼宮", "locale": "zh"})
    payload = response.json()
    candidates = payload["data"].get("candidates", [])
    if not candidates:
        pytest.skip("No candidates returned — LLM may not have triggered clarify")
    candidate = candidates[0]
    assert "title" in candidate
    assert "cover_url" in candidate
    assert "spot_count" in candidate
    assert "city" in candidate


@pytest.mark.integration
def test_runtime_nearby_response_has_search_contract(client):
    """AC B: nearby search must return results with rows, row_count, metadata."""
    response = client.post(
        "/v1/runtime",
        json={"text": "宇治站附近有什么圣地？", "locale": "zh"},
    )
    assert response.status_code == 200
    payload = response.json()
    if payload["intent"] == "clarify":
        pytest.skip("LLM asked for clarification instead of searching")
    assert payload["intent"] == "search_nearby"
    results = payload["data"].get("results")
    assert results is not None
    assert "rows" in results
    assert "row_count" in results
    assert "metadata" in results
    assert "radius_m" in results["metadata"]
    assert "nearby_groups" in results
    assert isinstance(results["nearby_groups"], list)
    if results["nearby_groups"]:
        group = results["nearby_groups"][0]
        assert "title" in group
        assert "points_count" in group


@pytest.mark.integration
def test_runtime_nearby_rows_include_distance_m(client):
    """AC B: nearby rows must have distance_m for frontend distance rendering."""
    response = client.post(
        "/v1/runtime",
        json={"text": "宇治站附近有什么圣地？", "locale": "zh"},
    )
    payload = response.json()
    if payload["intent"] == "clarify":
        pytest.skip("LLM asked for clarification")
    rows = payload["data"].get("results", {}).get("rows", [])
    if not rows:
        pytest.skip("No nearby rows returned")
    first_row = rows[0]
    assert "distance_m" in first_row


@pytest.mark.integration
def test_runtime_route_response_has_full_contract(client):
    """AC C: route response must have route with ordered_points, point_count, timed_itinerary."""
    response = client.post(
        "/v1/runtime",
        json={
            "text": "響け！ユーフォニアム の聖地を巡るルートを作って",
            "locale": "ja",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    if payload["intent"] != "plan_route":
        pytest.skip(f"LLM returned intent={payload['intent']} instead of plan_route")
    route = payload["data"].get("route")
    assert route is not None
    assert "ordered_points" in route
    assert "point_count" in route
    assert "timed_itinerary" in route
    assert "cover_url" in route
    itinerary = route["timed_itinerary"]
    assert "stops" in itinerary
    assert "legs" in itinerary
    assert "total_minutes" in itinerary
    assert "total_distance_m" in itinerary


@pytest.mark.integration
def test_popular_bangumi_has_cover_and_titles(client):
    """GET /v1/bangumi/popular must return bangumi_id, title, cover_url."""
    response = client.get("/v1/bangumi/popular")
    assert response.status_code == 200
    data = response.json()
    assert "bangumi" in data
    if not data["bangumi"]:
        pytest.skip("No popular bangumi returned")
    item = data["bangumi"][0]
    assert "bangumi_id" in item
    assert "title" in item
    assert "cover_url" in item


@pytest.mark.integration
def test_route_history_loads(client):
    """GET /v1/routes must return 200 with a routes array."""
    response = client.get("/v1/routes")
    assert response.status_code == 200
    data = response.json()
    assert "routes" in data
    assert isinstance(data["routes"], list)


@pytest.mark.integration
def test_conversation_messages_hydrate(client):
    """GET /v1/conversations/{session_id}/messages must return messages array."""
    response = client.post(
        "/v1/runtime",
        json={"text": "你好", "locale": "zh"},
    )
    payload = response.json()
    session_id = payload.get("session_id")
    if not session_id:
        pytest.skip("No session_id returned")
    history = client.get(f"/v1/conversations/{session_id}/messages")
    assert history.status_code == 200
    messages = history.json().get("messages", [])
    assert len(messages) >= 2  # user message + assistant response


# ── SSE done authority tests ──────────────────────────────────────────


@pytest.mark.integration
def test_sse_done_event_has_full_payload(sse_client):
    """AC E: SSE done event must carry the complete final response."""
    events = sse_client.stream(
        "/v1/runtime/stream",
        json={"text": "你好", "locale": "zh"},
    )
    done_events = [e for e in events if e.get("event") == "done"]
    assert len(done_events) == 1
    done = done_events[0]
    assert "intent" in done
    assert "message" in done
    assert done["message"], "done event message must be non-empty"
    assert "data" in done


@pytest.mark.integration
def test_sse_done_event_clarify_is_complete(sse_client):
    """AC E: clarify done event must carry question/candidates without step merge."""
    events = sse_client.stream(
        "/v1/runtime/stream",
        json={"text": "涼宮", "locale": "zh"},
    )
    done_events = [e for e in events if e.get("event") == "done"]
    assert len(done_events) == 1
    done = done_events[0]
    data = done.get("data", {})
    if data.get("status") == "needs_clarification":
        assert "question" in data
        assert "candidates" in data


@pytest.mark.integration
def test_message_is_not_static_template(client):
    """AC D: message should reference actual context, not a static template like '找到N处圣地'."""
    response = client.post("/v1/runtime", json={"text": "你好", "locale": "zh"})
    payload = response.json()
    msg = payload.get("message", "")
    assert msg, "message must be non-empty"
    # Static template pattern check — if message matches a template exactly, it's suspicious
    static_patterns = [
        "該当する巡礼地が見つかりませんでした",
        "没有找到相关的巡礼地",
        "No pilgrimage spots found",
    ]
    assert msg not in static_patterns, f"message looks like a static template: {msg}"
