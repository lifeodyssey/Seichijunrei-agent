"""Unit tests for A2UI integration in A2A server."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from starlette.testclient import TestClient

from interfaces.a2a_server.server import A2AServer, AGENT_CARD, create_app


@pytest.fixture
def mock_agent():
    """Create a mock agent for testing."""
    agent = MagicMock()
    agent.run_async = AsyncMock(return_value=iter([]))
    return agent


@pytest.fixture
def server_with_state(mock_agent):
    """Create A2A server with controllable state."""
    server = A2AServer(agent=mock_agent)
    server._run_agent = AsyncMock(return_value="Mock response")
    return server


@pytest.fixture
def client_with_state(server_with_state):
    """Create test client with controllable server state."""
    app = create_app(server_with_state)
    return TestClient(app), server_with_state


class TestAgentCardA2UI:
    """Tests for A2UI declaration in Agent Card."""

    def test_agent_card_has_a2ui_capability(self):
        """Agent card should declare A2UI support."""
        assert "a2ui" in AGENT_CARD["capabilities"]

    def test_a2ui_version_is_v08(self):
        """A2UI version should be v0.8."""
        a2ui = AGENT_CARD["capabilities"]["a2ui"]
        assert a2ui["version"] == "v0.8"

    def test_a2ui_declares_main_surface(self):
        """A2UI should declare 'main' surface."""
        a2ui = AGENT_CARD["capabilities"]["a2ui"]
        assert "main" in a2ui["surfaces"]

    def test_a2ui_declares_required_components(self):
        """A2UI should declare all required components."""
        a2ui = AGENT_CARD["capabilities"]["a2ui"]
        required = ["Text", "Button", "Card", "Row", "Column"]
        for comp in required:
            assert comp in a2ui["components"]


class TestA2UIResponse:
    """Tests for A2UI messages in task responses."""

    def test_tasks_send_returns_a2ui_messages(self, client_with_state):
        """Response should include a2ui field with messages."""
        client, server = client_with_state

        response = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": "test-1",
                "method": "tasks/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"text": "hello"}],
                    }
                },
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert "a2ui" in data["result"]
        assert isinstance(data["result"]["a2ui"], list)
        assert len(data["result"]["a2ui"]) >= 1

    def test_welcome_state_generates_welcome_ui(self, client_with_state):
        """Empty state should generate welcome UI."""
        client, server = client_with_state

        response = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": "test-2",
                "method": "tasks/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [{"text": "hi"}],
                    }
                },
            },
        )

        data = response.json()
        a2ui = data["result"]["a2ui"]
        # Should have surfaceUpdate and beginRendering
        assert any("surfaceUpdate" in msg for msg in a2ui)
        assert any("beginRendering" in msg for msg in a2ui)

    def test_candidates_state_generates_card_ui(self, client_with_state):
        """Candidates state should generate card UI."""
        client, server = client_with_state

        # Pre-set state with candidates
        session_id = "test-session-cand"
        server._states[session_id] = {
            "bangumi_candidates": {
                "query": "Slam Dunk",
                "candidates": [
                    {"title": "SLAM DUNK", "title_cn": "灌篮高手"},
                ],
            }
        }

        response = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": "test-3",
                "method": "tasks/send",
                "params": {
                    "sessionId": session_id,
                    "message": {
                        "role": "user",
                        "parts": [{"text": "search"}],
                    },
                },
            },
        )

        data = response.json()
        a2ui = data["result"]["a2ui"]
        assert any("surfaceUpdate" in msg for msg in a2ui)

    def test_route_state_generates_route_ui(self, client_with_state):
        """Route state should generate route UI."""
        client, server = client_with_state

        # Pre-set state with route plan
        session_id = "test-session-route"
        server._states[session_id] = {
            "route_plan": {
                "recommended_order": ["Point A", "Point B"],
                "estimated_duration": "2 hours",
            },
            "points_selection_result": {
                "selected_points": [
                    {"name": "Point A", "lat": 35.0, "lng": 139.0},
                ],
            },
        }

        response = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": "test-4",
                "method": "tasks/send",
                "params": {
                    "sessionId": session_id,
                    "message": {
                        "role": "user",
                        "parts": [{"text": "show route"}],
                    },
                },
            },
        )

        data = response.json()
        a2ui = data["result"]["a2ui"]
        assert any("surfaceUpdate" in msg for msg in a2ui)
        assert any("beginRendering" in msg for msg in a2ui)
