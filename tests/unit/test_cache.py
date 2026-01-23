"""
Unit tests for response caching layer.

Tests cover:
- Cache hit and miss scenarios
- TTL expiration
- Thread safety for concurrent access
- Cache key generation
- Cache eviction policies
"""

import asyncio
from datetime import datetime, timedelta

import pytest

from services.cache import _CACHE_MISS, CacheEntry, ResponseCache


class TestResponseCache:
    """Test the response caching layer."""

    @pytest.mark.asyncio
    async def test_cache_miss_returns_none(self):
        """Test that cache miss returns None."""
        cache = ResponseCache(default_ttl_seconds=60)

        result = await cache.get("nonexistent_key")
        assert result is _CACHE_MISS

    @pytest.mark.asyncio
    async def test_cache_set_and_get(self):
        """Test basic cache set and get operations."""
        cache = ResponseCache(default_ttl_seconds=60)

        # Set a value
        await cache.set("test_key", {"data": "test_value"})

        # Get the value
        result = await cache.get("test_key")
        assert result == {"data": "test_value"}

    @pytest.mark.asyncio
    async def test_cache_ttl_expiration(self):
        """Test that cached entries expire after TTL."""
        cache = ResponseCache(default_ttl_seconds=0.1)  # 100ms TTL

        # Set a value
        await cache.set("expiring_key", {"data": "will_expire"})

        # Should be available immediately
        result = await cache.get("expiring_key")
        assert result == {"data": "will_expire"}

        # Wait for expiration
        await asyncio.sleep(0.15)

        # Should be expired
        result = await cache.get("expiring_key")
        assert result is _CACHE_MISS

    @pytest.mark.asyncio
    async def test_cache_custom_ttl_override(self):
        """Test that custom TTL overrides default."""
        cache = ResponseCache(default_ttl_seconds=10)

        # Set with custom TTL
        await cache.set("custom_ttl", {"data": "test"}, ttl_seconds=0.1)

        # Should be available immediately
        result = await cache.get("custom_ttl")
        assert result == {"data": "test"}

        # Wait for custom TTL expiration
        await asyncio.sleep(0.15)

        # Should be expired even though default is 10s
        result = await cache.get("custom_ttl")
        assert result is _CACHE_MISS

    @pytest.mark.asyncio
    async def test_cache_delete(self):
        """Test cache delete operation."""
        cache = ResponseCache(default_ttl_seconds=60)

        # Set a value
        await cache.set("delete_me", {"data": "test"})

        # Verify it exists
        result = await cache.get("delete_me")
        assert result == {"data": "test"}

        # Delete it
        deleted = await cache.delete("delete_me")
        assert deleted is True

        # Should be gone
        result = await cache.get("delete_me")
        assert result is _CACHE_MISS

        # Deleting non-existent key returns False
        deleted = await cache.delete("nonexistent")
        assert deleted is False

    @pytest.mark.asyncio
    async def test_cache_clear(self):
        """Test clearing all cache entries."""
        cache = ResponseCache(default_ttl_seconds=60)

        # Set multiple values
        await cache.set("key1", {"data": "value1"})
        await cache.set("key2", {"data": "value2"})
        await cache.set("key3", {"data": "value3"})

        # Verify they exist
        assert await cache.get("key1") is not None
        assert await cache.get("key2") is not None
        assert await cache.get("key3") is not None

        # Clear all
        await cache.clear()

        # All should be gone
        assert await cache.get("key1") is _CACHE_MISS
        assert await cache.get("key2") is _CACHE_MISS
        assert await cache.get("key3") is _CACHE_MISS

    @pytest.mark.asyncio
    async def test_cache_concurrent_access(self):
        """Test thread safety with concurrent operations."""
        cache = ResponseCache(default_ttl_seconds=60)

        async def set_value(key: str, value: dict):
            await cache.set(key, value)

        async def get_value(key: str):
            return await cache.get(key)

        # Concurrent writes
        tasks = [set_value(f"key_{i}", {"value": i}) for i in range(20)]
        await asyncio.gather(*tasks)

        # Concurrent reads
        tasks = [get_value(f"key_{i}") for i in range(20)]
        results = await asyncio.gather(*tasks)

        # Verify all values are correct
        for i, result in enumerate(results):
            assert result == {"value": i}

    @pytest.mark.asyncio
    async def test_cache_size_limit(self):
        """Test cache size limit and LRU eviction."""
        cache = ResponseCache(
            default_ttl_seconds=60,
            max_size=3,  # Small cache
        )

        # Fill the cache
        await cache.set("key1", {"value": 1})
        await cache.set("key2", {"value": 2})
        await cache.set("key3", {"value": 3})

        # Access key1 to make it recently used
        await cache.get("key1")

        # Add a new key (should evict key2 as LRU)
        await cache.set("key4", {"value": 4})

        # key1 should still exist (recently accessed)
        assert await cache.get("key1") == {"value": 1}
        # key2 should be evicted (least recently used)
        assert await cache.get("key2") is _CACHE_MISS
        # key3 and key4 should exist
        assert await cache.get("key3") == {"value": 3}
        assert await cache.get("key4") == {"value": 4}

    def test_cache_key_generation(self):
        """Test cache key generation from endpoint and params."""
        cache = ResponseCache(default_ttl_seconds=60)

        # Test basic key generation
        key1 = cache.generate_key("https://api.example.com/data", {"param": "value"})
        key2 = cache.generate_key("https://api.example.com/data", {"param": "value"})
        key3 = cache.generate_key(
            "https://api.example.com/data", {"param": "different"}
        )

        # Same inputs should produce same key
        assert key1 == key2
        # Different params should produce different key
        assert key1 != key3

    def test_cache_key_generation_order_independence(self):
        """Test that cache key generation is order-independent for params."""
        cache = ResponseCache(default_ttl_seconds=60)

        key1 = cache.generate_key(
            "https://api.example.com/data", {"param1": "value1", "param2": "value2"}
        )
        key2 = cache.generate_key(
            "https://api.example.com/data", {"param2": "value2", "param1": "value1"}
        )

        # Order shouldn't matter
        assert key1 == key2

    @pytest.mark.asyncio
    async def test_cache_stats(self):
        """Test cache statistics tracking."""
        cache = ResponseCache(default_ttl_seconds=60)

        # Initial stats
        stats = await cache.get_stats()
        assert stats["hits"] == 0
        assert stats["misses"] == 0
        assert stats["size"] == 0

        # Add some data
        await cache.set("key1", {"value": 1})
        await cache.set("key2", {"value": 2})

        # Hit
        await cache.get("key1")
        # Miss
        await cache.get("nonexistent")

        stats = await cache.get_stats()
        assert stats["hits"] == 1
        assert stats["misses"] == 1
        assert stats["size"] == 2
        assert stats["hit_rate"] == 0.5

    @pytest.mark.asyncio
    async def test_cache_cleanup_expired_entries(self):
        """Test automatic cleanup of expired entries."""
        cache = ResponseCache(default_ttl_seconds=0.1, cleanup_interval_seconds=0.2)

        # Add entries
        await cache.set("key1", {"value": 1})
        await cache.set("key2", {"value": 2})

        # Wait for expiration and cleanup
        await asyncio.sleep(0.3)

        # Trigger cleanup (usually automatic)
        await cache.cleanup_expired()

        # Stats should show 0 size after cleanup
        stats = await cache.get_stats()
        assert stats["size"] == 0

    @pytest.mark.asyncio
    async def test_cache_decorator(self):
        """Test the cache decorator for async functions."""
        cache = ResponseCache(default_ttl_seconds=60)

        call_count = 0

        @cache.cached("test_endpoint")
        async def expensive_operation(param1: str, param2: int):
            nonlocal call_count
            call_count += 1
            return {"result": f"{param1}_{param2}", "calls": call_count}

        # First call
        result1 = await expensive_operation("test", 123)
        assert result1["calls"] == 1

        # Second call with same params (should be cached)
        result2 = await expensive_operation("test", 123)
        assert result2["calls"] == 1  # Same as first call

        # Call with different params
        result3 = await expensive_operation("different", 123)
        assert result3["calls"] == 2  # New call made

    @pytest.mark.asyncio
    async def test_cache_entry_is_expired(self):
        """Test CacheEntry expiration check."""
        # Create entry with short TTL
        entry = CacheEntry(
            value={"data": "test"}, expires_at=datetime.now() + timedelta(seconds=0.1)
        )

        # Should not be expired initially
        assert not entry.is_expired()

        # Wait for expiration
        await asyncio.sleep(0.15)

        # Should be expired now
        assert entry.is_expired()

    @pytest.mark.asyncio
    async def test_cache_with_none_values(self):
        """Test that cache can handle None values."""
        cache = ResponseCache(default_ttl_seconds=60)

        # Set None value
        await cache.set("null_key", None)

        # Should return None (the cached value, not a miss)
        result = await cache.get("null_key")
        assert result is None

        # Stats should show a hit, not a miss
        stats = await cache.get_stats()
        assert stats["hits"] == 1
        assert stats["misses"] == 0
