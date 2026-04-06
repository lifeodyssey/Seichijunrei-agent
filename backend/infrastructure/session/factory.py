"""Factory function for session store creation.

Provides a unified way to create session stores based on configuration.
Returns SupabaseSessionStore when a DB client is provided, otherwise
falls back to InMemorySessionStore.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from backend.infrastructure.session.base import SessionStore
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.utils.logger import get_logger

if TYPE_CHECKING:
    from backend.infrastructure.supabase.client import SupabaseClient

logger = get_logger(__name__)


def create_session_store(
    db: SupabaseClient | None = None,
) -> SessionStore:
    """Create a session store.

    If a SupabaseClient is provided, returns a SupabaseSessionStore that
    persists state across container restarts. Otherwise returns the
    in-memory store suitable for local development.
    """
    if db is not None:
        from backend.infrastructure.session.supabase_session import (
            SupabaseSessionStore,
        )

        logger.info("Creating Supabase-backed session store")
        return SupabaseSessionStore(db)

    logger.info("Creating in-memory session store")
    return InMemorySessionStore()
