"""Session store implementations for infrastructure layer.

This module provides session store backends: in-memory for development
and Supabase-backed for production persistence.
Use the factory function to create the appropriate store based on configuration.
"""

from backend.infrastructure.session.base import SessionData, SessionStore
from backend.infrastructure.session.factory import create_session_store
from backend.infrastructure.session.memory import InMemorySessionStore
from backend.infrastructure.session.supabase_session import SupabaseSessionStore

__all__ = [
    "SessionStore",
    "SessionData",
    "InMemorySessionStore",
    "SupabaseSessionStore",
    "create_session_store",
]
