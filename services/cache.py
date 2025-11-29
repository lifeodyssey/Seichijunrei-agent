"""
Response caching layer for API clients.

Provides:
- In-memory cache with TTL support
- Thread-safe operations
- LRU eviction policy
- Cache statistics
- Decorator for caching async functions
"""

import asyncio
import hashlib
import json
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import wraps
from threading import Lock
from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class CacheEntry:
    """A single cache entry with expiration time."""

    value: Any
    expires_at: datetime

    def is_expired(self) -> bool:
        """Check if this entry has expired."""
        return datetime.now() >= self.expires_at


class ResponseCache:
    """
    Thread-safe response cache with TTL and LRU eviction.

    Features:
    - Time-based expiration (TTL)
    - Size-based eviction (LRU)
    - Thread-safe operations
    - Cache statistics
    """

    def __init__(
        self,
        default_ttl_seconds: float = 3600,
        max_size: int = 1000,
        cleanup_interval_seconds: float = 300,
    ):
        """
        Initialize the response cache.

        Args:
            default_ttl_seconds: Default time-to-live in seconds
            max_size: Maximum number of cache entries
            cleanup_interval_seconds: Interval for automatic cleanup
        """
        self.default_ttl_seconds = default_ttl_seconds
        self.max_size = max_size
        self.cleanup_interval_seconds = cleanup_interval_seconds

        # OrderedDict for LRU behavior
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._lock = Lock()

        # Statistics
        self._hits = 0
        self._misses = 0

        # Start cleanup task
        self._cleanup_task: asyncio.Task | None = None
        if cleanup_interval_seconds > 0:
            self._start_cleanup_task()

        logger.info(
            "Cache initialized",
            default_ttl=default_ttl_seconds,
            max_size=max_size,
            cleanup_interval=cleanup_interval_seconds,
        )

    def _start_cleanup_task(self) -> None:
        """Start the background cleanup task."""
        try:
            loop = asyncio.get_running_loop()
            self._cleanup_task = loop.create_task(self._cleanup_loop())
        except RuntimeError:
            # No event loop running, cleanup will be manual
            logger.debug("No event loop for automatic cleanup")

    async def _cleanup_loop(self) -> None:
        """Background task to cleanup expired entries."""
        while True:
            try:
                await asyncio.sleep(self.cleanup_interval_seconds)
                await self.cleanup_expired()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in cache cleanup", error=str(e), exc_info=True)

    async def get(self, key: str) -> Any | None:
        """
        Get a value from the cache.

        Args:
            key: Cache key

        Returns:
            Cached value or None if not found/expired
        """
        with self._lock:
            if key not in self._cache:
                self._misses += 1
                logger.debug("Cache miss", key=key)
                return None

            entry = self._cache[key]

            # Check expiration
            if entry.is_expired():
                del self._cache[key]
                self._misses += 1
                logger.debug("Cache expired", key=key)
                return None

            # Move to end for LRU (most recently used)
            self._cache.move_to_end(key)
            self._hits += 1
            logger.debug("Cache hit", key=key)

            return entry.value

    async def set(self, key: str, value: Any, ttl_seconds: float | None = None) -> None:
        """
        Set a value in the cache.

        Args:
            key: Cache key
            value: Value to cache
            ttl_seconds: Optional TTL override
        """
        ttl = ttl_seconds if ttl_seconds is not None else self.default_ttl_seconds
        expires_at = datetime.now() + timedelta(seconds=ttl)

        with self._lock:
            # Check size limit
            if len(self._cache) >= self.max_size and key not in self._cache:
                # Evict least recently used
                self._evict_lru()

            # Add or update entry
            self._cache[key] = CacheEntry(value=value, expires_at=expires_at)
            # Move to end (most recently used)
            self._cache.move_to_end(key)

            logger.debug(
                "Cache set", key=key, ttl=ttl, expires_at=expires_at.isoformat()
            )

    def _evict_lru(self) -> None:
        """Evict the least recently used entry."""
        if self._cache:
            lru_key = next(iter(self._cache))
            del self._cache[lru_key]
            logger.debug("Cache evicted LRU", key=lru_key)

    async def delete(self, key: str) -> bool:
        """
        Delete a key from the cache.

        Args:
            key: Cache key

        Returns:
            True if deleted, False if not found
        """
        with self._lock:
            if key in self._cache:
                del self._cache[key]
                logger.debug("Cache deleted", key=key)
                return True
            return False

    async def clear(self) -> None:
        """Clear all cache entries."""
        with self._lock:
            size = len(self._cache)
            self._cache.clear()
            self._hits = 0
            self._misses = 0
            logger.info("Cache cleared", entries_removed=size)

    async def cleanup_expired(self) -> int:
        """
        Remove expired entries from the cache.

        Returns:
            Number of entries removed
        """
        with self._lock:
            expired_keys = [
                key for key, entry in self._cache.items() if entry.is_expired()
            ]

            for key in expired_keys:
                del self._cache[key]

            if expired_keys:
                logger.info(
                    "Cache cleanup completed", entries_removed=len(expired_keys)
                )

            return len(expired_keys)

    async def get_stats(self) -> dict[str, Any]:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache statistics
        """
        with self._lock:
            total_requests = self._hits + self._misses
            hit_rate = self._hits / total_requests if total_requests > 0 else 0

            return {
                "hits": self._hits,
                "misses": self._misses,
                "size": len(self._cache),
                "max_size": self.max_size,
                "hit_rate": hit_rate,
                "total_requests": total_requests,
            }

    def generate_key(self, endpoint: str, params: dict[str, Any] | None = None) -> str:
        """
        Generate a cache key from endpoint and parameters.

        Args:
            endpoint: API endpoint URL
            params: Request parameters

        Returns:
            Cache key string
        """
        # Create a deterministic key from endpoint and params
        key_parts = [endpoint]

        if params:
            # Sort params for consistent key generation
            sorted_params = sorted(params.items())
            params_str = json.dumps(sorted_params, sort_keys=True, default=str)
            key_parts.append(params_str)

        key_str = "|".join(key_parts)
        # Use hash for shorter, fixed-length keys
        key_hash = hashlib.sha256(key_str.encode()).hexdigest()[:16]

        return f"{endpoint.split('/')[-1]}_{key_hash}"

    def cached(self, endpoint: str, ttl_seconds: float | None = None) -> Callable:
        """
        Decorator to cache async function results.

        Args:
            endpoint: Endpoint name for cache key generation
            ttl_seconds: Optional TTL override

        Returns:
            Decorated function
        """

        def decorator(func: Callable) -> Callable:
            @wraps(func)
            async def wrapper(*args, **kwargs):
                # Generate cache key from function args and kwargs
                params = {"args": args, "kwargs": kwargs}
                cache_key = self.generate_key(endpoint, params)

                # Try to get from cache
                cached_value = await self.get(cache_key)
                if cached_value is not None:
                    logger.debug(
                        "Cache decorator hit", function=func.__name__, endpoint=endpoint
                    )
                    return cached_value

                # Call the function
                result = await func(*args, **kwargs)

                # Cache the result
                await self.set(cache_key, result, ttl_seconds)

                return result

            return wrapper

        return decorator

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit with cleanup."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        await self.cleanup_expired()
