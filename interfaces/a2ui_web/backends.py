"""Chat backends for the A2UI web UI.

Defines the A2UIBackend protocol. Concrete implementations will be added
in ITER-3 when the Pydantic AI agent chain is wired to the A2UI interface.
"""

from __future__ import annotations

from typing import Any, Protocol


class A2UIBackend(Protocol):
    """Protocol for A2UI chat backends."""

    async def chat(
        self, *, session_id: str, user_text: str
    ) -> tuple[str | None, dict[str, Any]]: ...

    async def remove_point(
        self, *, session_id: str, index_0: int
    ) -> tuple[bool, dict[str, Any]]: ...

    async def select_candidate(
        self, *, session_id: str, index_1: int
    ) -> tuple[bool, dict[str, Any]]: ...

    async def go_back(self, *, session_id: str) -> tuple[bool, dict[str, Any]]: ...


class LocalInProcessBackend:
    """In-memory backend for local development.

    Placeholder — will be wired to the Pydantic AI agent chain in ITER-3.
    Currently supports only deterministic state mutations (no LLM calls).
    """

    def __init__(self) -> None:
        self._states: dict[str, dict[str, Any]] = {}

    async def chat(
        self, *, session_id: str, user_text: str
    ) -> tuple[str | None, dict[str, Any]]:
        state = self._states.setdefault(session_id, {})
        # TODO(ITER-3): wire to Pydantic AI agent chain
        return None, state

    async def remove_point(
        self, *, session_id: str, index_0: int
    ) -> tuple[bool, dict[str, Any]]:
        from .state_mutations import remove_selected_point_by_index

        state = self._states.setdefault(session_id, {})
        ok = remove_selected_point_by_index(state, index_0=index_0)
        return ok, state

    async def select_candidate(
        self, *, session_id: str, index_1: int
    ) -> tuple[bool, dict[str, Any]]:
        from .state_mutations import select_candidate_by_index

        state = self._states.setdefault(session_id, {})
        ok = select_candidate_by_index(state, index_1=index_1)
        return ok, state

    async def go_back(self, *, session_id: str) -> tuple[bool, dict[str, Any]]:
        from .state_mutations import go_back_to_candidates

        state = self._states.setdefault(session_id, {})
        ok = go_back_to_candidates(state)
        return ok, state


def create_backend() -> A2UIBackend:
    """Create the appropriate backend based on settings."""
    return LocalInProcessBackend()
