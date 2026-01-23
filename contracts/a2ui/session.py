"""
A2A Session Store - Abstract interface and implementations.

Manages the mapping between A2A context_id and ADK sessions.
Provides adapter pattern for future Redis/Firestore implementations.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)


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

    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    """When the session was created."""

    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    """When the session was last updated."""

    metadata: dict[str, Any] = field(default_factory=dict)
    """Additional session metadata (e.g., client info, preferences)."""

    def is_expired(self, ttl_seconds: float) -> bool:
        """Check if session has expired based on TTL."""
        expiry = self.updated_at + timedelta(seconds=ttl_seconds)
        return datetime.now(UTC) > expiry

    def touch(self) -> None:
        """Update the last access time."""
        self.updated_at = datetime.now(UTC)


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

    @abstractmethod
    async def list_sessions(
        self,
        *,
        user_id: str | None = None,
        limit: int = 100,
    ) -> list[SessionInfo]:
        """List sessions, optionally filtered by user.

        Args:
            user_id: Optional filter by user
            limit: Maximum number of sessions to return

        Returns:
            List of SessionInfo objects
        """
        ...

    @abstractmethod
    async def cleanup_expired(self, ttl_seconds: float) -> int:
        """Remove expired sessions.

        Args:
            ttl_seconds: Sessions older than this are considered expired

        Returns:
            Number of sessions removed
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
            existing.touch()
            return existing

        session_info = SessionInfo(
            context_id=context_id,
            session_id=context_id,  # Use context_id as session_id for simplicity
            user_id=user_id or self._default_user_id,
            app_name=app_name,
            state={},
        )
        self._sessions[context_id] = session_info
        logger.debug(
            "Session created",
            context_id=context_id,
            user_id=session_info.user_id,
        )
        return session_info

    async def get(self, context_id: str) -> SessionInfo | None:
        """Get session by context_id if it exists."""
        session = self._sessions.get(context_id)
        if session:
            session.touch()
        return session

    async def update_state(
        self,
        context_id: str,
        state: dict[str, Any],
    ) -> None:
        """Update session state."""
        session = self._sessions.get(context_id)
        if session is not None:
            session.state = state
            session.touch()
            logger.debug(
                "Session state updated",
                context_id=context_id,
                state_keys=list(state.keys()),
            )

    async def delete(self, context_id: str) -> bool:
        """Delete a session."""
        if context_id in self._sessions:
            del self._sessions[context_id]
            logger.debug("Session deleted", context_id=context_id)
            return True
        return False

    async def list_sessions(
        self,
        *,
        user_id: str | None = None,
        limit: int = 100,
    ) -> list[SessionInfo]:
        """List sessions, optionally filtered by user."""
        sessions = list(self._sessions.values())
        if user_id:
            sessions = [s for s in sessions if s.user_id == user_id]
        # Sort by updated_at descending (most recent first)
        sessions.sort(key=lambda s: s.updated_at, reverse=True)
        return sessions[:limit]

    async def cleanup_expired(self, ttl_seconds: float) -> int:
        """Remove expired sessions."""
        expired_ids = [
            ctx_id
            for ctx_id, session in self._sessions.items()
            if session.is_expired(ttl_seconds)
        ]
        for ctx_id in expired_ids:
            del self._sessions[ctx_id]
        if expired_ids:
            logger.info(
                "Expired sessions cleaned up",
                count=len(expired_ids),
                ttl_seconds=ttl_seconds,
            )
        return len(expired_ids)

    def clear_all(self) -> None:
        """Clear all sessions (for testing)."""
        self._sessions.clear()
