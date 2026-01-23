"""
A2A Session Store - Abstract interface and implementations.

Manages the mapping between A2A context_id and ADK sessions.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SessionInfo:
    """Information about an A2A-to-ADK session mapping."""

    context_id: str
    """A2A context identifier (from client_session_id)."""

    session_id: str
    """ADK session identifier."""

    user_id: str
    """User identifier for state isolation."""

    app_name: str
    """Application name (fixed per deployment)."""

    state: dict[str, Any] = field(default_factory=dict)
    """Current session state."""


class SessionStore(ABC):
    """Abstract session store interface.

    Implementations handle the mapping between A2A context_id
    and ADK session identifiers, plus state persistence.
    """

    @abstractmethod
    async def get_or_create(
        self,
        *,
        context_id: str,
        user_id: str,
        app_name: str,
    ) -> SessionInfo:
        """Get existing session or create new one.

        Args:
            context_id: A2A context identifier
            user_id: User identifier for state isolation
            app_name: Application name

        Returns:
            SessionInfo with session details and current state
        """
        ...

    @abstractmethod
    async def get(self, context_id: str) -> SessionInfo | None:
        """Get session by context_id if it exists.

        Args:
            context_id: A2A context identifier

        Returns:
            SessionInfo if found, None otherwise
        """
        ...

    @abstractmethod
    async def update_state(
        self,
        context_id: str,
        state: dict[str, Any],
    ) -> None:
        """Update session state.

        Args:
            context_id: A2A context identifier
            state: New state to store
        """
        ...

    @abstractmethod
    async def delete(self, context_id: str) -> bool:
        """Delete a session.

        Args:
            context_id: A2A context identifier

        Returns:
            True if session was deleted, False if not found
        """
        ...


class InMemorySessionStore(SessionStore):
    """In-memory session store for local development.

    State is lost on restart. Suitable for development and testing.
    """

    def __init__(self, default_user_id: str = "a2ui-web") -> None:
        self._sessions: dict[str, SessionInfo] = {}
        self._default_user_id = default_user_id

    async def get_or_create(
        self,
        *,
        context_id: str,
        user_id: str | None = None,
        app_name: str = "seichijunrei_bot",
    ) -> SessionInfo:
        """Get existing session or create new one."""
        existing = self._sessions.get(context_id)
        if existing is not None:
            return existing

        session_info = SessionInfo(
            context_id=context_id,
            session_id=context_id,  # Use context_id as session_id for simplicity
            user_id=user_id or self._default_user_id,
            app_name=app_name,
            state={},
        )
        self._sessions[context_id] = session_info
        return session_info

    async def get(self, context_id: str) -> SessionInfo | None:
        """Get session by context_id if it exists."""
        return self._sessions.get(context_id)

    async def update_state(
        self,
        context_id: str,
        state: dict[str, Any],
    ) -> None:
        """Update session state."""
        session = self._sessions.get(context_id)
        if session is not None:
            session.state = state

    async def delete(self, context_id: str) -> bool:
        """Delete a session."""
        if context_id in self._sessions:
            del self._sessions[context_id]
            return True
        return False

    def clear_all(self) -> None:
        """Clear all sessions (for testing)."""
        self._sessions.clear()
