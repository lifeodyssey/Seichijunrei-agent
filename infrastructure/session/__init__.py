"""Session store implementations for infrastructure layer.

This module provides various session store backends:
- InMemorySessionStore: For local development and testing
- RedisSessionStore: For distributed deployments with Redis
- FirestoreSessionStore: For GCP deployments with Firestore

Use the factory function to create the appropriate store based on configuration.
"""

from infrastructure.session.base import SessionData, SessionStore
from infrastructure.session.factory import create_session_store
from infrastructure.session.memory import InMemorySessionStore

__all__ = [
    "SessionStore",
    "SessionData",
    "InMemorySessionStore",
    "create_session_store",
]
