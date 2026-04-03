"""Factory function for session store creation.

Provides a unified way to create session stores based on configuration.
"""

from backend.infrastructure.session.base import SessionStore
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.utils.logger import get_logger

logger = get_logger(__name__)


def create_session_store() -> SessionStore:
    """Create an in-memory session store."""
    logger.info("Creating in-memory session store")
    return InMemorySessionStore()
