"""Chat backends for the A2UI web UI.

Default is in-process execution (local dev). For deployment, we support an
optional Vertex AI Agent Engine backend which:
  - creates/uses a remote session
  - queries the deployed agent
  - fetches remote session_state to render deterministic A2UI surfaces
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from typing import Any, Protocol

from google.genai import types


class A2UIBackend(Protocol):
    async def chat(
        self, *, session_id: str, user_text: str
    ) -> tuple[str | None, dict[str, Any]]: ...

    async def remove_point(
        self, *, session_id: str, index_0: int
    ) -> tuple[bool, dict[str, Any]]: ...


def create_backend() -> A2UIBackend:
    mode = (os.getenv("A2UI_BACKEND", "local") or "local").strip().lower()
    if mode in {"agent_engine", "agentengine", "vertex", "remote"}:
        return AgentEngineBackend.from_env()
    return LocalInProcessBackend()


class LocalInProcessBackend:
    def __init__(self) -> None:
        from google.adk.sessions import InMemorySessionService

        self._session_service = InMemorySessionService()
        self._states: dict[str, dict[str, Any]] = {}

        # Lazy import to avoid pulling ADK agent deps when running in Agent Engine mode.
        from adk_agents.seichijunrei_bot.agent import root_agent

        self._root_agent = root_agent

    async def chat(
        self, *, session_id: str, user_text: str
    ) -> tuple[str | None, dict[str, Any]]:
        from google.adk.agents.invocation_context import InvocationContext
        from google.adk.sessions.session import Session

        state = self._states.setdefault(session_id, {})
        session = Session(
            id=session_id,
            app_name="seichijunrei_bot",
            user_id="a2ui-web",
            state=state,
        )
        ctx = InvocationContext(
            session_service=self._session_service,
            invocation_id=f"a2ui-{os.urandom(8).hex()}",
            agent=self._root_agent,
            user_content=types.Content(role="user", parts=[types.Part(text=user_text)]),
            session=session,
        )

        last_model_text: str | None = None
        async for event in self._root_agent.run_async(ctx):
            content = getattr(event, "content", None)
            parts = getattr(content, "parts", None) if content is not None else None
            if not parts:
                continue
            if getattr(content, "role", None) not in {None, "model", "assistant"}:
                continue
            texts = [p.text for p in parts if getattr(p, "text", None)]
            if texts:
                last_model_text = "\n".join(texts).strip() or last_model_text

        return last_model_text, state

    async def remove_point(
        self, *, session_id: str, index_0: int
    ) -> tuple[bool, dict[str, Any]]:
        from .state_mutations import remove_selected_point_by_index

        state = self._states.setdefault(session_id, {})
        ok = remove_selected_point_by_index(state, index_0=index_0)
        return ok, state


@dataclass(frozen=True)
class AgentEngineConfig:
    project: str
    location: str
    agent_engine_name: str
    user_id: str

    @staticmethod
    def from_env() -> AgentEngineConfig:
        project = (os.getenv("A2UI_VERTEXAI_PROJECT") or "").strip()
        location = (os.getenv("A2UI_VERTEXAI_LOCATION") or "").strip()
        name = (os.getenv("A2UI_AGENT_ENGINE_NAME") or "").strip()
        user_id = (os.getenv("A2UI_AGENT_ENGINE_USER_ID") or "a2ui-web").strip()

        if not project:
            raise RuntimeError("Missing env: A2UI_VERTEXAI_PROJECT")
        if not location:
            raise RuntimeError("Missing env: A2UI_VERTEXAI_LOCATION")
        if not name:
            raise RuntimeError("Missing env: A2UI_AGENT_ENGINE_NAME")

        # Accept RESOURCE_ID shorthand if project/location are provided.
        if not name.startswith("projects/"):
            name = f"projects/{project}/locations/{location}/reasoningEngines/{name}"

        return AgentEngineConfig(
            project=project, location=location, agent_engine_name=name, user_id=user_id
        )


class AgentEngineBackend:
    def __init__(self, cfg: AgentEngineConfig) -> None:
        import vertexai

        self._cfg = cfg
        self._client = vertexai.Client(project=cfg.project, location=cfg.location)
        self._remote_session_name_by_session_id: dict[str, str] = {}
        self._state_cache: dict[str, dict[str, Any]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    @classmethod
    def from_env(cls) -> AgentEngineBackend:
        return cls(AgentEngineConfig.from_env())

    def _lock_for(self, session_id: str) -> asyncio.Lock:
        lock = self._locks.get(session_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[session_id] = lock
        return lock

    async def _ensure_remote_session_name(self, session_id: str) -> str:
        existing = self._remote_session_name_by_session_id.get(session_id)
        if existing:
            return existing

        async with self._lock_for(session_id):
            existing = self._remote_session_name_by_session_id.get(session_id)
            if existing:
                return existing

            from vertexai._genai.types.common import CreateAgentEngineSessionConfig

            def _create() -> Any:
                return self._client.agent_engines.create_session(
                    name=self._cfg.agent_engine_name,
                    user_id=self._cfg.user_id,
                    config=CreateAgentEngineSessionConfig(displayName=session_id),
                )

            op = await asyncio.to_thread(_create)
            session = getattr(op, "response", None)
            remote_name = getattr(session, "name", None)
            if not isinstance(remote_name, str) or not remote_name:
                raise RuntimeError(
                    "Agent Engine session creation did not return a session name."
                )

            self._remote_session_name_by_session_id[session_id] = remote_name
            state = getattr(session, "session_state", None)
            self._state_cache[session_id] = state if isinstance(state, dict) else {}
            return remote_name

    async def _fetch_state(self, *, remote_session_name: str) -> dict[str, Any]:
        def _get() -> Any:
            return self._client.agent_engines.get_session(name=remote_session_name)

        session = await asyncio.to_thread(_get)
        state = getattr(session, "session_state", None)
        return state if isinstance(state, dict) else {}

    async def _fetch_last_model_text(self, *, remote_session_name: str) -> str | None:
        def _list_events() -> list[Any]:
            return list(
                self._client.agent_engines.list_session_events(name=remote_session_name)
            )

        events = await asyncio.to_thread(_list_events)
        last_text: str | None = None
        for event in events:
            content = getattr(event, "content", None)
            if content is None:
                continue
            role = getattr(content, "role", None)
            if role not in {None, "model", "assistant"}:
                continue
            parts = getattr(content, "parts", None)
            if not parts:
                continue
            texts = [p.text for p in parts if getattr(p, "text", None)]
            if texts:
                last_text = "\n".join(texts).strip() or last_text
        return last_text

    async def chat(
        self, *, session_id: str, user_text: str
    ) -> tuple[str | None, dict[str, Any]]:
        remote_session_name = await self._ensure_remote_session_name(session_id)

        from vertexai._genai.types.common import QueryAgentEngineConfig

        def _stream_query_and_drain() -> None:
            stream = self._client.agent_engines._stream_query(
                name=self._cfg.agent_engine_name,
                config=QueryAgentEngineConfig(
                    classMethod="async_stream_query",
                    input={
                        "message": user_text,
                        "user_id": self._cfg.user_id,
                        "session_id": remote_session_name,
                    },
                ),
            )
            for _ in stream:
                pass

        await asyncio.to_thread(_stream_query_and_drain)
        state = await self._fetch_state(remote_session_name=remote_session_name)
        self._state_cache[session_id] = state

        last_text = await self._fetch_last_model_text(
            remote_session_name=remote_session_name
        )
        return last_text, state

    async def remove_point(
        self, *, session_id: str, index_0: int
    ) -> tuple[bool, dict[str, Any]]:
        from vertexai._genai.types.common import UpdateAgentEngineSessionConfig

        remote_session_name = await self._ensure_remote_session_name(session_id)

        state = await self._fetch_state(remote_session_name=remote_session_name)

        from .state_mutations import remove_selected_point_by_index

        ok = remove_selected_point_by_index(state, index_0=index_0)
        if not ok:
            self._state_cache[session_id] = state
            return False, state

        def _update() -> Any:
            return self._client.agent_engines.sessions._update(
                name=remote_session_name,
                config=UpdateAgentEngineSessionConfig(
                    sessionState=state,
                    updateMask="sessionState",
                ),
            )

        op = await asyncio.to_thread(_update)
        updated_session = getattr(op, "response", None)
        updated_state = getattr(updated_session, "session_state", None)
        if isinstance(updated_state, dict):
            state = updated_state

        self._state_cache[session_id] = state
        return True, state
