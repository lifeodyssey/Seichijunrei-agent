"""
Cache integration for HTTP clients.

Provides cache-aware request wrapping:
- Cache lookup before network calls (GET only)
- Cache storage after successful responses
- Cache key generation delegated to ResponseCache
"""

from collections.abc import Mapping

from backend.services.cache import _CACHE_MISS, ResponseCache
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# Re-export so base.py can import from here
__all__ = ["CacheMixin", "ResponseCache", "_CACHE_MISS"]


JSONValue = str | int | float | bool | None | dict[str, object] | list[object]


def _normalize_json(value: object) -> JSONValue:
    """Normalize a parsed JSON value to strict JSONValue."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_normalize_json(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _normalize_json(item) for key, item in value.items()}
    raise ValueError("Response was not valid JSON")


class CacheMixin:
    """Mixin that adds cache-aware request wrapping to an HTTP client."""

    _cache: ResponseCache | None

    async def cache_lookup(
        self,
        url: str,
        params: Mapping[str, object] | None,
    ) -> tuple[bool, JSONValue]:
        """Check the cache for a GET response.

        Returns:
            (hit, value) — hit is True when cache contained
            the key; value is the cached response.
        """
        if self._cache is None:
            return False, None
        cache_key = self._cache.generate_key(url, params)
        cached = await self._cache.get(cache_key)
        if cached is _CACHE_MISS:
            return False, None
        logger.debug("Cache hit", url=url, params=params)
        return True, _normalize_json(cached)

    async def cache_store(
        self,
        url: str,
        params: Mapping[str, object] | None,
        response: JSONValue,
    ) -> None:
        """Store a successful GET response in the cache."""
        if self._cache is None:
            return
        cache_key = self._cache.generate_key(url, params)
        await self._cache.set(cache_key, response)
