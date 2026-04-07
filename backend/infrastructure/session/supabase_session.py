"""Supabase-backed session store with LRU write-through cache.

Implements the SessionStore protocol, persisting state to Supabase while
keeping an in-memory cache to avoid repeated DB reads for active sessions.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from backend.utils.logger import get_logger

if TYPE_CHECKING:
    from backend.infrastructure.supabase.client import SupabaseClient

logger = get_logger(__name__)


class SupabaseSessionStore:
    """Persists session state to Supabase with in-memory FIFO cache.

    Write-through: every ``set`` writes to both the cache and the database.
    Reads check the cache first, falling back to the database on miss.
    """

    def __init__(self, db: SupabaseClient, cache_size: int = 256) -> None:
        self._db = db
        self._cache: dict[str, dict[str, object]] = {}
        self._cache_size = cache_size

    async def get(self, session_id: str) -> dict[str, object] | None:
        """Retrieve session state, checking cache first."""
        if session_id in self._cache:
            logger.debug("session_cache_hit", session_id=session_id)
            return self._cache[session_id]

        state = await self._db.get_session_state(session_id)  # type: ignore[operator]
        if state is not None:
            self._evict_if_full()
            self._cache[session_id] = state
            logger.debug("session_cache_miss_loaded", session_id=session_id)
        return state

    async def set(self, session_id: str, state: dict[str, object]) -> None:
        """Write-through: update cache and persist to DB."""
        self._evict_if_full()
        self._cache[session_id] = state
        await self._db.upsert_session_state(session_id, state)  # type: ignore[operator]
        logger.debug("session_persisted", session_id=session_id)

    async def delete(self, session_id: str) -> None:
        """Remove session from cache and DB."""
        self._cache.pop(session_id, None)
        await self._db.delete_session_state(session_id)  # type: ignore[operator]
        logger.debug("session_deleted", session_id=session_id)

    def _evict_if_full(self) -> None:
        """Evict oldest entries (FIFO) when cache is at capacity."""
        while len(self._cache) >= self._cache_size:
            oldest = next(iter(self._cache))
            del self._cache[oldest]
