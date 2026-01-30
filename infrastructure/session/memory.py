"""In-memory session store implementation.

Suitable for local development and testing. State is lost on restart.
"""

from datetime import UTC, datetime
from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)


class InMemorySessionStore:
    """In-memory session store for local development.

    State is lost on restart. Suitable for development and testing.
    Thread-safe for single-process async usage.
    """

    def __init__(self) -> None:
        """Initialize the in-memory store."""
        self._sessions: dict[str, dict[str, Any]] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    async def get(self, session_id: str) -> dict[str, Any] | None:
        """Retrieve session state by ID.

        Args:
            session_id: The unique session identifier.

        Returns:
            Session state dictionary if found, None otherwise.
        """
        state = self._sessions.get(session_id)
        if state is not None:
            # Update access time in metadata
            if session_id in self._metadata:
                self._metadata[session_id]["updated_at"] = datetime.now(UTC)
            logger.debug("Session retrieved", session_id=session_id)
        return state

    async def set(self, session_id: str, state: dict[str, Any]) -> None:
        """Store or update session state.

        Args:
            session_id: The unique session identifier.
            state: The state dictionary to store.
        """
        is_new = session_id not in self._sessions
        self._sessions[session_id] = state

        now = datetime.now(UTC)
        if is_new:
            self._metadata[session_id] = {
                "created_at": now,
                "updated_at": now,
            }
            logger.debug("Session created", session_id=session_id)
        else:
            self._metadata[session_id]["updated_at"] = now
            logger.debug("Session updated", session_id=session_id)

    async def delete(self, session_id: str) -> None:
        """Delete a session.

        Args:
            session_id: The unique session identifier.
        """
        if session_id in self._sessions:
            del self._sessions[session_id]
            self._metadata.pop(session_id, None)
            logger.debug("Session deleted", session_id=session_id)

    async def exists(self, session_id: str) -> bool:
        """Check if a session exists.

        Args:
            session_id: The unique session identifier.

        Returns:
            True if session exists, False otherwise.
        """
        return session_id in self._sessions

    async def list_sessions(self, limit: int = 100) -> list[str]:
        """List all session IDs.

        Args:
            limit: Maximum number of sessions to return.

        Returns:
            List of session IDs.
        """
        return list(self._sessions.keys())[:limit]

    def clear_all(self) -> None:
        """Clear all sessions (for testing)."""
        self._sessions.clear()
        self._metadata.clear()
        logger.debug("All sessions cleared")
