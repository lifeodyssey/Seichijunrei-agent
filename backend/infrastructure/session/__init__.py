"""Session store implementations for infrastructure layer.

This module provides the in-memory session store backend.
Use the factory function to create the appropriate store based on configuration.
"""

from backend.infrastructure.session.base import SessionData, SessionStore
from backend.infrastructure.session.factory import create_session_store
from backend.infrastructure.session.memory import InMemorySessionStore

__all__ = [
    "SessionStore",
    "SessionData",
    "InMemorySessionStore",
    "create_session_store",
]
