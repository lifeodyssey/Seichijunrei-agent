"""Base session store protocol and data types.

Defines the SessionStore Protocol that all implementations must follow.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol, runtime_checkable


@dataclass
class SessionData:
    """Session data container.

    A simplified session data structure for the infrastructure layer.
    Can be converted to/from the contracts SessionInfo as needed.
    """

    session_id: str
    """Unique session identifier."""

    state: dict[str, Any] = field(default_factory=dict)
    """Session state dictionary."""

    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    """When the session was created."""

    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    """When the session was last updated."""

    metadata: dict[str, Any] = field(default_factory=dict)
    """Additional session metadata."""

    def is_expired(self, ttl_seconds: float) -> bool:
        """Check if session has expired based on TTL."""
        expiry = self.updated_at + timedelta(seconds=ttl_seconds)
        return datetime.now(UTC) > expiry

    def touch(self) -> None:
        """Update the last access time."""
        self.updated_at = datetime.now(UTC)


@runtime_checkable
class SessionStore(Protocol):
    """Protocol for session storage backends.

    All session store implementations must provide these methods.
    This follows the simplified interface from the task specification.
    """

    async def get(self, session_id: str) -> dict[str, Any] | None:
        """Retrieve session state by ID."""
        ...

    async def set(self, session_id: str, state: dict[str, Any]) -> None:
        """Store or update session state."""
        ...

    async def delete(self, session_id: str) -> None:
        """Delete a session."""
        ...
