"""Factory function for session store creation.

Provides a unified way to create session stores based on configuration.
"""

from typing import Literal

from infrastructure.session.base import SessionStore
from infrastructure.session.memory import InMemorySessionStore
from utils.logger import get_logger

logger = get_logger(__name__)

StoreType = Literal["memory", "redis", "firestore"]


def create_session_store(
    store_type: StoreType = "memory",
    **kwargs: object,
) -> SessionStore:
    """Create a session store based on the specified type.

    Args:
        store_type: Type of store to create ("memory", "redis", "firestore").
        **kwargs: Additional arguments passed to the store constructor.

    Returns:
        A SessionStore implementation.

    Raises:
        ValueError: If store_type is not recognized.
        ImportError: If required dependencies are not installed.
    """
    if store_type == "memory":
        logger.info("Creating in-memory session store")
        return InMemorySessionStore()

    elif store_type == "redis":
        from infrastructure.session.redis import RedisSessionStore

        logger.info("Creating Redis session store", **kwargs)
        return RedisSessionStore(**kwargs)  # type: ignore[arg-type]

    elif store_type == "firestore":
        from infrastructure.session.firestore import FirestoreSessionStore

        logger.info("Creating Firestore session store", **kwargs)
        return FirestoreSessionStore(**kwargs)  # type: ignore[arg-type]

    else:
        raise ValueError(f"Unknown session store type: {store_type}")
