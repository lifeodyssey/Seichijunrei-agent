"""
Session management service for Seichijunrei Bot.
Handles user session state and lifecycle.
"""

import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from threading import Lock
from typing import Any

from domain.entities import PilgrimageSession
from utils.logger import get_logger

# === Session Exceptions ===


class SessionNotFoundError(Exception):
    """Raised when a session is not found."""

    pass


class SessionExpiredError(Exception):
    """Raised when a session has expired."""

    pass


class SessionLimitExceededError(Exception):
    """Raised when maximum session limit is exceeded."""

    pass


# === Abstract Session Service ===


class SessionService(ABC):
    """Abstract interface for session management."""

    @abstractmethod
    async def create_session(self) -> str:
        """
        Create a new session.

        Returns:
            Session ID

        Raises:
            SessionLimitExceededError: If max sessions reached
        """
        pass

    @abstractmethod
    async def get_session(self, session_id: str) -> PilgrimageSession:
        """
        Get a session by ID.

        Args:
            session_id: Session identifier

        Returns:
            PilgrimageSession object

        Raises:
            SessionNotFoundError: If session doesn't exist
            SessionExpiredError: If session has expired
        """
        pass

    @abstractmethod
    async def update_session(self, session: PilgrimageSession) -> None:
        """
        Update an existing session.

        Args:
            session: Updated session object

        Raises:
            SessionNotFoundError: If session doesn't exist
        """
        pass

    @abstractmethod
    async def delete_session(self, session_id: str) -> bool:
        """
        Delete a session.

        Args:
            session_id: Session identifier

        Returns:
            True if deleted, False if not found
        """
        pass

    @abstractmethod
    async def cleanup_expired(self) -> int:
        """
        Clean up expired sessions.

        Returns:
            Number of sessions cleaned up
        """
        pass

    @abstractmethod
    async def get_active_count(self) -> int:
        """
        Get count of active sessions.

        Returns:
            Number of active sessions
        """
        pass


# === In-Memory Session Service Implementation ===


class InMemorySessionService(SessionService):
    """
    In-memory session management service.

    Features:
    - Thread-safe operations
    - TTL-based expiration
    - Session limit enforcement
    - Automatic cleanup
    """

    def __init__(
        self,
        max_sessions: int = 1000,
        session_ttl_seconds: int = 3600,
    ):
        """
        Initialize the session service.

        Args:
            max_sessions: Maximum number of concurrent sessions
            session_ttl_seconds: Session time-to-live in seconds
        """
        self.max_sessions = max_sessions
        self.session_ttl_seconds = session_ttl_seconds
        self._sessions: dict[str, tuple[PilgrimageSession, datetime]] = {}
        self._lock = Lock()  # Thread safety
        self._logger = get_logger("services.session")

        # Statistics
        self._created_total = 0
        self._expired_total = 0

    async def create_session(self) -> str:
        """Create a new session."""
        with self._lock:
            # Check session limit
            active_count = len(self._sessions)
            if active_count >= self.max_sessions:
                self._logger.warning(
                    "Session limit exceeded",
                    active=active_count,
                    max=self.max_sessions,
                )
                raise SessionLimitExceededError(
                    f"Maximum session limit ({self.max_sessions}) reached"
                )

            # Generate unique session ID
            session_id = str(uuid.uuid4())

            # Create session
            session = PilgrimageSession(session_id=session_id)
            expiry = datetime.now() + timedelta(seconds=self.session_ttl_seconds)

            # Store session with expiry
            self._sessions[session_id] = (session, expiry)
            self._created_total += 1

            self._logger.info(
                "Session created",
                session_id=session_id,
                expires_at=expiry.isoformat(),
            )

            return session_id

    async def get_session(self, session_id: str) -> PilgrimageSession:
        """Get a session by ID."""
        with self._lock:
            if session_id not in self._sessions:
                raise SessionNotFoundError(f"Session {session_id} not found")

            session, expiry = self._sessions[session_id]

            # Check expiration
            if datetime.now() > expiry:
                # Remove expired session
                del self._sessions[session_id]
                self._expired_total += 1
                self._logger.info("Session expired", session_id=session_id)
                raise SessionExpiredError(f"Session {session_id} has expired")

            return session

    async def update_session(self, session: PilgrimageSession) -> None:
        """Update an existing session."""
        with self._lock:
            if session.session_id not in self._sessions:
                raise SessionNotFoundError(f"Session {session.session_id} not found")

            # Update timestamp
            session.update()

            # Keep existing expiry
            _, expiry = self._sessions[session.session_id]
            self._sessions[session.session_id] = (session, expiry)

            self._logger.debug(
                "Session updated",
                session_id=session.session_id,
            )

    async def delete_session(self, session_id: str) -> bool:
        """Delete a session."""
        with self._lock:
            if session_id in self._sessions:
                del self._sessions[session_id]
                self._logger.info("Session deleted", session_id=session_id)
                return True
            return False

    async def cleanup_expired(self) -> int:
        """Clean up expired sessions."""
        cleaned = 0
        now = datetime.now()

        with self._lock:
            expired_ids = [
                sid for sid, (_, expiry) in self._sessions.items() if now > expiry
            ]

            for session_id in expired_ids:
                del self._sessions[session_id]
                cleaned += 1
                self._expired_total += 1

        if cleaned > 0:
            self._logger.info(
                "Expired sessions cleaned",
                count=cleaned,
                remaining=len(self._sessions),
            )

        return cleaned

    async def get_active_count(self) -> int:
        """Get count of active sessions."""
        with self._lock:
            # First cleanup expired
            now = datetime.now()
            expired_ids = [
                sid for sid, (_, expiry) in self._sessions.items() if now > expiry
            ]
            for session_id in expired_ids:
                del self._sessions[session_id]
                self._expired_total += 1

            return len(self._sessions)

    async def get_all_sessions(self) -> list[PilgrimageSession]:
        """
        Get all active sessions.

        Returns:
            List of active sessions
        """
        sessions = []
        with self._lock:
            now = datetime.now()
            for session, expiry in self._sessions.values():
                if now <= expiry:
                    sessions.append(session)
        return sessions

    async def get_statistics(self) -> dict[str, Any]:
        """
        Get session service statistics.

        Returns:
            Dictionary with statistics
        """
        active_count = await self.get_active_count()

        return {
            "active_sessions": active_count,
            "max_sessions": self.max_sessions,
            "session_ttl_seconds": self.session_ttl_seconds,
            "created_total": self._created_total,
            "expired_total": self._expired_total,
            "capacity_used_percent": (active_count / self.max_sessions) * 100,
        }

    async def extend_session(self, session_id: str, seconds: int) -> None:
        """
        Extend a session's TTL.

        Args:
            session_id: Session to extend
            seconds: Additional seconds to add to TTL

        Raises:
            SessionNotFoundError: If session doesn't exist
        """
        with self._lock:
            if session_id not in self._sessions:
                raise SessionNotFoundError(f"Session {session_id} not found")

            session, current_expiry = self._sessions[session_id]
            new_expiry = current_expiry + timedelta(seconds=seconds)
            self._sessions[session_id] = (session, new_expiry)

            self._logger.info(
                "Session extended",
                session_id=session_id,
                new_expiry=new_expiry.isoformat(),
            )

    def __repr__(self) -> str:
        """String representation of the service."""
        return (
            f"InMemorySessionService("
            f"sessions={len(self._sessions)}, "
            f"max={self.max_sessions}, "
            f"ttl={self.session_ttl_seconds}s)"
        )
