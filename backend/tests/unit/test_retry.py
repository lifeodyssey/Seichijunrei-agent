"""
Unit tests for retry decorators and rate limiting.

Tests cover:
- Exponential backoff with jitter
- Max retry attempts
- Selective retry on specific exceptions
- Rate limiting with token bucket
- Thread safety for concurrent requests
"""

import asyncio
import time
from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from backend.services.retry import (
    RateLimiter,
    RetryConfig,
    exponential_backoff_with_jitter,
    retry_async,
)


class TestRetryDecorator:
    """Test the async retry decorator."""

    @pytest.mark.asyncio
    async def test_successful_call_no_retry(self):
        """Test that successful calls don't trigger retries."""
        mock_func = AsyncMock(return_value="success")

        @retry_async()
        async def test_func():
            return await mock_func()

        result = await test_func()

        assert result == "success"
        assert mock_func.call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_exception(self):
        """Test that function retries on exceptions."""
        mock_func = AsyncMock(
            side_effect=[
                Exception("First failure"),
                Exception("Second failure"),
                "success",
            ]
        )

        @retry_async(max_attempts=3)
        async def test_func():
            return await mock_func()

        result = await test_func()

        assert result == "success"
        assert mock_func.call_count == 3

    @pytest.mark.asyncio
    async def test_max_retries_exceeded(self):
        """Test that max retries are respected."""
        mock_func = AsyncMock(side_effect=Exception("Always fails"))

        @retry_async(max_attempts=3)
        async def test_func():
            return await mock_func()

        with pytest.raises(Exception, match="Always fails"):
            await test_func()

        assert mock_func.call_count == 3

    @pytest.mark.asyncio
    async def test_selective_retry_on_specific_exceptions(self):
        """Test that only specific exceptions trigger retries."""

        class RetryableError(Exception):
            pass

        class NonRetryableError(Exception):
            pass

        mock_func = AsyncMock(side_effect=NonRetryableError("Should not retry"))

        @retry_async(max_attempts=3, retry_on=(RetryableError,))
        async def test_func():
            return await mock_func()

        with pytest.raises(NonRetryableError):
            await test_func()

        # Should not retry on NonRetryableError
        assert mock_func.call_count == 1

    @pytest.mark.asyncio
    async def test_exponential_backoff_timing(self):
        """Test that exponential backoff delays are applied."""
        mock_func = AsyncMock(
            side_effect=[Exception("First"), Exception("Second"), "success"]
        )

        @retry_async(max_attempts=3, base_delay=0.1, max_delay=1.0)
        async def test_func():
            return await mock_func()

        start_time = time.time()
        result = await test_func()
        elapsed_time = time.time() - start_time

        assert result == "success"
        assert mock_func.call_count == 3
        # With jitter factor of 0.5, minimum delay is:
        # First retry: 0.1 * 0.5 = 0.05s
        # Second retry: 0.2 * 0.5 = 0.10s
        # Total minimum: ~0.15s — use wide tolerance for slow CI runners
        assert elapsed_time >= 0.1, (
            f"Expected at least 0.1s delay, got {elapsed_time:.3f}s"
        )
        assert elapsed_time < 5.0, f"Backoff took too long: {elapsed_time:.3f}s"

    @pytest.mark.asyncio
    async def test_custom_retry_config(self):
        """Test using custom RetryConfig."""
        config = RetryConfig(
            max_attempts=2, base_delay=0.05, max_delay=0.5, exponential_base=3
        )

        mock_func = AsyncMock(side_effect=[Exception("Fail"), "success"])

        @retry_async(config=config)
        async def test_func():
            return await mock_func()

        result = await test_func()

        assert result == "success"
        assert mock_func.call_count == 2

    @pytest.mark.parametrize(
        "attempt,base_delay,max_delay,exp_base,lo,hi",
        [
            (0, 1.0, 10.0, 2, 0.5, 1.5),  # base case: 2^0 * 1.0 = 1.0 ± 50%
            (2, 1.0, 10.0, 2, 2.0, 6.0),  # growth: 2^2 * 1.0 = 4.0 ± 50%
            (10, 1.0, 5.0, 2, 0.0, 5.0),  # max delay cap
        ],
    )
    def test_exponential_backoff_with_jitter(
        self,
        attempt: int,
        base_delay: float,
        max_delay: float,
        exp_base: int,
        lo: float,
        hi: float,
    ):
        """Test exponential backoff calculation with jitter."""
        delay = exponential_backoff_with_jitter(
            attempt=attempt,
            base_delay=base_delay,
            max_delay=max_delay,
            exponential_base=exp_base,
        )
        assert lo <= delay <= hi

    @pytest.mark.asyncio
    async def test_retry_with_exponential_base_one(self):
        """Test retry config with exponential_base=1 produces constant delay."""
        config = RetryConfig(
            max_attempts=3, base_delay=0.05, max_delay=1.0, exponential_base=1
        )
        mock_func = AsyncMock(side_effect=[Exception("Fail"), Exception("Fail"), "ok"])

        @retry_async(config=config)
        async def test_func():
            return await mock_func()

        result = await test_func()
        assert result == "ok"
        assert mock_func.call_count == 3


class TestRateLimiter:
    """Test the token bucket rate limiter."""

    @pytest.mark.asyncio
    async def test_rate_limiter_allows_requests_within_limit(self):
        """Test that rate limiter allows requests within the limit."""
        limiter = RateLimiter(calls_per_period=5, period_seconds=1.0)

        # Should allow 5 requests immediately
        for _ in range(5):
            allowed = await limiter.acquire()
            assert allowed is True

    @pytest.mark.asyncio
    async def test_rate_limiter_blocks_excess_requests(self):
        """Test that rate limiter blocks requests exceeding the limit."""
        limiter = RateLimiter(calls_per_period=3, period_seconds=1.0)

        # Use up all tokens
        for _ in range(3):
            await limiter.acquire()

        # Next request should be delayed
        start_time = time.time()
        allowed = await limiter.acquire()
        elapsed = time.time() - start_time

        assert allowed is True
        # Note: this is timing-sensitive and may vary slightly across platforms
        # and CI runners. We only assert that it waited "meaningfully".
        assert elapsed >= 0.1, f"Expected at least 0.1s wait, got {elapsed:.3f}s"
        assert elapsed < 5.0, f"Rate limiter wait took too long: {elapsed:.3f}s"

    @pytest.mark.asyncio
    async def test_rate_limiter_token_refill(self):
        """Test that tokens are refilled over time."""
        limiter = RateLimiter(
            calls_per_period=2,
            period_seconds=0.2,  # 200ms period
        )

        # Use all tokens
        await limiter.acquire()
        await limiter.acquire()

        # Wait for refill
        await asyncio.sleep(0.25)

        # Should be able to acquire again
        allowed = await limiter.acquire()
        assert allowed is True

    @pytest.mark.asyncio
    async def test_rate_limiter_concurrent_access(self):
        """Test thread safety with concurrent requests."""
        limiter = RateLimiter(calls_per_period=10, period_seconds=1.0)

        async def make_request():
            return await limiter.acquire()

        # Make 10 concurrent requests
        tasks = [make_request() for _ in range(10)]
        results = await asyncio.gather(*tasks)

        # All should succeed
        assert all(results)
        assert len(results) == 10

    @pytest.mark.asyncio
    async def test_rate_limiter_burst_capacity(self):
        """Test that burst capacity works correctly."""
        limiter = RateLimiter(
            calls_per_period=5,
            period_seconds=1.0,
            burst_multiplier=2.0,  # Allow burst of 10
        )

        # Consume the full burst capacity in one call to reduce timing flakiness.
        allowed = await limiter.acquire(tokens=10)
        assert allowed is True

        # 11th request should be delayed
        start_time = time.time()
        allowed = await limiter.acquire()
        elapsed = time.time() - start_time

        assert allowed is True
        assert elapsed >= 0.1, (
            f"Expected at least 0.1s wait, got {elapsed:.3f}s"
        )  # 1 token requires ~0.2s at 5 tokens/sec
        assert elapsed < 5.0, f"Burst wait took too long: {elapsed:.3f}s"

    @pytest.mark.asyncio
    async def test_multiple_rate_limiters_independent(self):
        """Test that multiple rate limiters work independently."""
        limiter1 = RateLimiter(calls_per_period=2, period_seconds=1.0)
        limiter2 = RateLimiter(calls_per_period=3, period_seconds=1.0)

        # Use up limiter1
        await limiter1.acquire()
        await limiter1.acquire()

        # limiter2 should still have tokens
        for _ in range(3):
            allowed = await limiter2.acquire()
            assert allowed is True

    def test_rate_limiter_get_wait_time(self):
        """Test calculating wait time until next token."""
        limiter = RateLimiter(calls_per_period=2, period_seconds=1.0)

        # Initially should have no wait
        wait_time = limiter.get_wait_time()
        assert wait_time == 0

        # Use all tokens (synchronously for testing)
        limiter.tokens = 0
        limiter.last_refill = datetime.now()

        # Should need to wait for refill
        wait_time = limiter.get_wait_time()
        assert 0 < wait_time <= 0.5  # Half period for one token
