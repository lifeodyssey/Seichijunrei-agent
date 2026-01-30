"""A2A Session Adapter.

Provides the adapter pattern for mapping A2A context_id to ADK session_id.
This module bridges the A2A protocol session model with the ADK session service.

Session Mapping Strategy:
- A2A context_id -> ADK session.id (1:1 mapping for MVP)
- A2A client user -> ADK session.user_id (configurable, default: "a2a-client")
- A2A agent name -> ADK session.app_name (fixed per deployment)
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any

from contracts.a2ui import InMemorySessionStore, SessionInfo, SessionStore
from utils.logger import get_logger

if TYPE_CHECKING:
    from google.adk.sessions import InMemorySessionService
    from google.adk.sessions.session import Session

logger = get_logger(__name__)


class SessionAdapter(ABC):
    """Abstract session adapter interface.

    Adapters handle the mapping between A2A context identifiers
    and ADK session objects, plus state synchronization.
    """

    @abstractmethod
    async def get_or_create_session(
        self,
        *,
        context_id: str,
        user_id: str,
        app_name: str,
    ) -> tuple[SessionInfo, Session]:
        """Get or create both A2UI session info and ADK session.

        Args:
            context_id: A2A context identifier
            user_id: User identifier for state isolation
            app_name: Application name

        Returns:
            Tuple of (SessionInfo, ADK Session)
        """
        ...

    @abstractmethod
    async def sync_state_to_store(
        self,
        context_id: str,
        state: dict[str, Any],
    ) -> None:
        """Sync ADK session state to the session store.

        Args:
            context_id: A2A context identifier
            state: Current ADK session state
        """
        ...

    @abstractmethod
    async def get_state(self, context_id: str) -> dict[str, Any]:
        """Get the current state for a context.

        Args:
            context_id: A2A context identifier

        Returns:
            Current session state dict
        """
        ...


class InMemorySessionAdapter(SessionAdapter):
    """In-memory session adapter for local development.

    Uses InMemorySessionStore for A2UI session tracking and
    maintains a local state dict for ADK session state.
    """

    def __init__(
        self,
        *,
        session_store: SessionStore | None = None,
        default_user_id: str = "a2a-client",
        default_app_name: str = "seichijunrei_bot",
    ) -> None:
        self._session_store = session_store or InMemorySessionStore()
        self._default_user_id = default_user_id
        self._default_app_name = default_app_name
        self._states: dict[str, dict[str, Any]] = {}
        self._adk_session_service: Any = None

    @property
    def session_store(self) -> SessionStore:
        """Get the underlying session store."""
        return self._session_store

    @property
    def states(self) -> dict[str, dict[str, Any]]:
        """Get the state dictionary (for direct access)."""
        return self._states

    def _get_adk_session_service(self) -> InMemorySessionService:
        """Get or create the ADK session service."""
        if self._adk_session_service is None:
            from google.adk.sessions import InMemorySessionService

            self._adk_session_service = InMemorySessionService()
        return self._adk_session_service

    async def get_or_create_session(
        self,
        *,
        context_id: str,
        user_id: str | None = None,
        app_name: str | None = None,
    ) -> tuple[SessionInfo, Session]:
        """Get or create both A2UI session info and ADK session."""
        from google.adk.sessions.session import Session

        effective_user_id = user_id or self._default_user_id
        effective_app_name = app_name or self._default_app_name

        # Get or create A2UI session info
        session_info = await self._session_store.get_or_create(
            context_id=context_id,
            user_id=effective_user_id,
            app_name=effective_app_name,
        )

        # Get or create state dict
        state = self._states.setdefault(context_id, {})

        # Create ADK session with the same state reference
        adk_session = Session(
            id=context_id,
            app_name=effective_app_name,
            user_id=effective_user_id,
            state=state,
        )

        logger.debug(
            "Session adapter: get_or_create",
            context_id=context_id,
            user_id=effective_user_id,
            state_keys=list(state.keys()),
        )

        return session_info, adk_session

    async def sync_state_to_store(
        self,
        context_id: str,
        state: dict[str, Any],
    ) -> None:
        """Sync ADK session state to the session store."""
        # Update local state dict
        self._states[context_id] = state

        # Update session store
        await self._session_store.update_state(context_id, state)

        logger.debug(
            "Session adapter: state synced",
            context_id=context_id,
            state_keys=list(state.keys()),
        )

    async def get_state(self, context_id: str) -> dict[str, Any]:
        """Get the current state for a context."""
        return self._states.get(context_id, {})

    async def set_processing(self, context_id: str) -> bool:
        """Mark session as processing."""
        if isinstance(self._session_store, InMemorySessionStore):
            return await self._session_store.set_processing(context_id)
        return False

    async def set_active(self, context_id: str) -> bool:
        """Mark session as active."""
        if isinstance(self._session_store, InMemorySessionStore):
            return await self._session_store.set_active(context_id)
        return False

    async def record_error(self, context_id: str, error_message: str) -> bool:
        """Record an error for the session."""
        if isinstance(self._session_store, InMemorySessionStore):
            return await self._session_store.record_error(context_id, error_message)
        return False

    async def delete_session(self, context_id: str) -> bool:
        """Delete a session and its state."""
        # Remove from local state
        self._states.pop(context_id, None)

        # Remove from session store
        return await self._session_store.delete(context_id)

    async def cleanup_expired(self, ttl_seconds: float) -> int:
        """Clean up expired sessions."""
        # Get expired sessions from store
        removed = await self._session_store.cleanup_expired(ttl_seconds)

        # Also clean up local states for sessions that no longer exist
        existing_sessions = await self._session_store.list_sessions()
        existing_ids = {s.context_id for s in existing_sessions}
        stale_ids = [cid for cid in self._states if cid not in existing_ids]
        for cid in stale_ids:
            del self._states[cid]

        return removed
