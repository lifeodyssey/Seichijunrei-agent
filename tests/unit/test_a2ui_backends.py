from dataclasses import dataclass
from typing import Any

import pytest
from google.genai import types

from interfaces.a2ui_web.backends import AgentEngineBackend, AgentEngineConfig


def test_agent_engine_config_from_settings_builds_full_resource_name():
    """Test that from_settings correctly builds the full resource name."""
    from dataclasses import dataclass as dc

    @dc
    class MockSettings:
        a2ui_vertexai_project: str = "p"
        a2ui_vertexai_location: str = "us-central1"
        a2ui_agent_engine_name: str = "123"
        a2ui_agent_engine_user_id: str = "u"

    cfg = AgentEngineConfig.from_settings(MockSettings())
    assert cfg.project == "p"
    assert cfg.location == "us-central1"
    assert cfg.user_id == "u"
    assert cfg.agent_engine_name.endswith("/reasoningEngines/123")
    assert cfg.agent_engine_name.startswith("projects/p/locations/us-central1/")


@dataclass
class _FakeSession:
    name: str
    session_state: dict[str, Any]


@dataclass
class _FakeOp:
    response: Any


@dataclass
class _FakeEvent:
    content: types.Content


class _FakeSessions:
    def __init__(self, store: dict[str, dict[str, Any]]):
        self._store = store
        self.last_update: dict[str, Any] | None = None

    def _update(self, *, name: str, config: Any = None) -> _FakeOp:
        # `name` is the session name in this API.
        state = getattr(config, "session_state", None) or getattr(
            config, "sessionState", None
        )
        if not isinstance(state, dict):
            raise AssertionError("Expected sessionState dict in update config")
        self._store[name] = state
        self.last_update = {"name": name, "state": state}
        return _FakeOp(response=_FakeSession(name=name, session_state=state))


class _FakeAgentEngines:
    def __init__(self):
        self._sessions: dict[str, dict[str, Any]] = {}
        self._events: dict[str, list[_FakeEvent]] = {}
        self.sessions = _FakeSessions(self._sessions)

    def create_session(self, *, name: str, user_id: str, config: Any = None) -> _FakeOp:
        display = getattr(config, "display_name", None) or getattr(
            config, "displayName", None
        )
        session_name = f"{name}/sessions/{display or 's'}"
        self._sessions[session_name] = {}
        return _FakeOp(response=_FakeSession(name=session_name, session_state={}))

    def _stream_query(self, *, name: str, config: Any = None):
        payload = getattr(config, "input", None) or {}
        session_id = payload.get("session_id")
        message = payload.get("message")
        assert isinstance(session_id, str) and session_id
        assert name
        # Simulate an agent updating session state.
        self._sessions.setdefault(session_id, {})["last_user_message"] = message
        self._events[session_id] = [
            _FakeEvent(
                content=types.Content(
                    role="user", parts=[types.Part(text=str(message))]
                )
            ),
            _FakeEvent(
                content=types.Content(role="model", parts=[types.Part(text="ok")])
            ),
        ]
        yield {"data": "ok"}

    def get_session(self, *, name: str, config: Any = None) -> _FakeSession:
        return _FakeSession(name=name, session_state=self._sessions.get(name, {}))

    def list_session_events(self, *, name: str, config: Any = None):
        return iter(self._events.get(name, []))


class _FakeVertexAIClient:
    def __init__(self):
        self.agent_engines = _FakeAgentEngines()


@pytest.mark.asyncio
async def test_agent_engine_backend_chat_fetches_state_and_last_text(monkeypatch):
    cfg = AgentEngineConfig(
        project="p",
        location="us-central1",
        agent_engine_name="projects/p/locations/us-central1/reasoningEngines/123",
        user_id="u",
    )
    backend = AgentEngineBackend(cfg)
    backend._client = _FakeVertexAIClient()  # type: ignore[attr-defined]

    text, state = await backend.chat(session_id="local", user_text="hello")
    assert text == "ok"
    assert state.get("last_user_message") == "hello"


@pytest.mark.asyncio
async def test_agent_engine_backend_remove_point_updates_remote_session_state(
    monkeypatch,
):
    cfg = AgentEngineConfig(
        project="p",
        location="us-central1",
        agent_engine_name="projects/p/locations/us-central1/reasoningEngines/123",
        user_id="u",
    )
    backend = AgentEngineBackend(cfg)
    fake_client = _FakeVertexAIClient()
    backend._client = fake_client  # type: ignore[attr-defined]

    # Create a remote session first.
    _, state = await backend.chat(session_id="local", user_text="seed")
    remote_session_name = next(iter(fake_client.agent_engines._sessions.keys()))

    # Seed state with a minimal Stage 2 shape so remove can replan.
    fake_client.agent_engines._sessions[remote_session_name] = {
        "extraction_result": {"location": "Tokyo", "user_language": "en"},
        "selected_bangumi": {"bangumi_title": "JP"},
        "all_points": [
            {"name": "A", "episode": 1, "time_seconds": 0},
            {"name": "B", "episode": 2, "time_seconds": 0},
        ],
        "points_selection_result": {
            "selected_points": [
                {"name": "A", "episode": 1, "time_seconds": 0},
                {"name": "B", "episode": 2, "time_seconds": 0},
            ],
            "selection_rationale": "initial",
            "estimated_coverage": "episodes 1-2",
            "total_available": 2,
            "rejected_count": 0,
        },
    }

    ok, updated = await backend.remove_point(session_id="local", index_0=0)
    assert ok is True
    assert len(updated["points_selection_result"]["selected_points"]) == 1
    assert len(updated["route_plan"]["recommended_order"]) == 1
    assert fake_client.agent_engines.sessions.last_update is not None
