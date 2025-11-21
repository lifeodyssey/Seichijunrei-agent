"""
Retry decorators and rate limiting for API clients.

Provides:
- Exponential backoff with jitter
- Configurable retry policies
- Token bucket rate limiting
- Thread-safe implementations
"""

import asyncio
import random
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import wraps
from threading import Lock
from typing import Callable, Optional, Tuple, Type, Union

from utils.logger import get_logger

logger = get_logger(__name__)


@dataclass
class RetryConfig:
    """Configuration for retry behavior."""

    max_attempts: int = 3
    base_delay: float = 1.0  # Base delay in seconds
    max_delay: float = 60.0  # Maximum delay in seconds
    exponential_base: float = 2.0  # Base for exponential backoff
    jitter_factor: float = 0.5  # Randomization factor (0-1)
    retry_on: Tuple[Type[Exception], ...] = (Exception,)  # Exceptions to retry on


def exponential_backoff_with_jitter(
    attempt: int,
    base_delay: float,
    max_delay: float,
    exponential_base: float = 2.0,
    jitter_factor: float = 0.5
) -> float:
    """
    Calculate exponential backoff delay with jitter.

    Args:
        attempt: Current attempt number (0-indexed)
        base_delay: Base delay in seconds
        max_delay: Maximum delay cap
        exponential_base: Base for exponential calculation
        jitter_factor: Random jitter factor (0-1)

    Returns:
        Delay in seconds with jitter applied
    """
    # Calculate exponential delay
    delay = base_delay * (exponential_base ** attempt)

    # Apply jitter to prevent thundering herd
    jitter_range = delay * jitter_factor
    delay = delay - jitter_range + (random.random() * jitter_range * 2)

    # Cap at maximum delay (after jitter to ensure we never exceed max)
    delay = min(delay, max_delay)

    return max(0, delay)  # Ensure non-negative


def retry_async(
    max_attempts: Optional[int] = None,
    base_delay: Optional[float] = None,
    max_delay: Optional[float] = None,
    exponential_base: Optional[float] = None,
    retry_on: Optional[Tuple[Type[Exception], ...]] = None,
    config: Optional[RetryConfig] = None
) -> Callable:
    """
    Async retry decorator with exponential backoff.

    Args:
        max_attempts: Maximum number of retry attempts
        base_delay: Base delay between retries
        max_delay: Maximum delay between retries
        exponential_base: Base for exponential backoff
        retry_on: Tuple of exceptions to retry on
        config: Complete RetryConfig object (overrides other params)

    Returns:
        Decorated function with retry logic
    """
    # Use provided config or create from parameters
    if config is None:
        config = RetryConfig()
        if max_attempts is not None:
            config.max_attempts = max_attempts
        if base_delay is not None:
            config.base_delay = base_delay
        if max_delay is not None:
            config.max_delay = max_delay
        if exponential_base is not None:
            config.exponential_base = exponential_base
        if retry_on is not None:
            config.retry_on = retry_on

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            last_exception = None

            for attempt in range(config.max_attempts):
                try:
                    # Attempt the function call
                    result = await func(*args, **kwargs)

                    if attempt > 0:
                        logger.info(
                            "Retry successful",
                            function=func.__name__,
                            attempt=attempt + 1,
                            max_attempts=config.max_attempts
                        )

                    return result

                except config.retry_on as e:
                    last_exception = e

                    # Check if we've exhausted retries
                    if attempt == config.max_attempts - 1:
                        logger.error(
                            "Max retries exceeded",
                            function=func.__name__,
                            attempt=attempt + 1,
                            max_attempts=config.max_attempts,
                            error=str(e)
                        )
                        raise

                    # Calculate backoff delay
                    delay = exponential_backoff_with_jitter(
                        attempt=attempt,
                        base_delay=config.base_delay,
                        max_delay=config.max_delay,
                        exponential_base=config.exponential_base,
                        jitter_factor=config.jitter_factor
                    )

                    logger.warning(
                        "Retrying after error",
                        function=func.__name__,
                        attempt=attempt + 1,
                        max_attempts=config.max_attempts,
                        delay=f"{delay:.2f}s",
                        error=str(e)
                    )

                    # Wait before retrying
                    await asyncio.sleep(delay)

                except Exception as e:
                    # Don't retry on unexpected exceptions
                    logger.error(
                        "Non-retryable exception",
                        function=func.__name__,
                        error=str(e),
                        exc_info=True
                    )
                    raise

            # Should never reach here, but for safety
            if last_exception:
                raise last_exception

        return wrapper
    return decorator


class RateLimiter:
    """
    Token bucket rate limiter for API calls.

    Thread-safe implementation using asyncio locks.
    """

    def __init__(
        self,
        calls_per_period: int,
        period_seconds: float,
        burst_multiplier: float = 1.0
    ):
        """
        Initialize rate limiter.

        Args:
            calls_per_period: Number of calls allowed per period
            period_seconds: Period duration in seconds
            burst_multiplier: Multiplier for burst capacity (default 1.0)
        """
        self.calls_per_period = calls_per_period
        self.period_seconds = period_seconds
        self.burst_multiplier = burst_multiplier

        # Token bucket parameters
        self.max_tokens = calls_per_period * burst_multiplier
        self.tokens = self.max_tokens
        self.refill_rate = calls_per_period / period_seconds
        self.last_refill = datetime.now()

        # Thread safety
        self._lock = Lock()

    def _refill_tokens(self) -> None:
        """Refill tokens based on elapsed time."""
        now = datetime.now()
        elapsed = (now - self.last_refill).total_seconds()

        # Calculate tokens to add
        tokens_to_add = elapsed * self.refill_rate

        # Update tokens (cap at max)
        self.tokens = min(self.max_tokens, self.tokens + tokens_to_add)
        self.last_refill = now

    def get_wait_time(self) -> float:
        """
        Get time to wait until next token is available.

        Returns:
            Wait time in seconds (0 if token available)
        """
        with self._lock:
            self._refill_tokens()

            if self.tokens >= 1:
                return 0

            # Calculate time until next token
            tokens_needed = 1 - self.tokens
            wait_time = tokens_needed / self.refill_rate

            return wait_time

    async def acquire(self, tokens: int = 1) -> bool:
        """
        Acquire tokens from the bucket.

        Args:
            tokens: Number of tokens to acquire (default 1)

        Returns:
            True when tokens acquired
        """
        while True:
            with self._lock:
                self._refill_tokens()

                if self.tokens >= tokens:
                    # Consume tokens
                    self.tokens -= tokens
                    logger.debug(
                        "Rate limit tokens acquired",
                        tokens_acquired=tokens,
                        tokens_remaining=self.tokens,
                        max_tokens=self.max_tokens
                    )
                    return True

                # Calculate wait time
                tokens_needed = tokens - self.tokens
                wait_time = tokens_needed / self.refill_rate

            # Wait for tokens to refill
            logger.debug(
                "Rate limit waiting for tokens",
                wait_time=f"{wait_time:.2f}s",
                tokens_needed=tokens,
                tokens_available=self.tokens
            )
            await asyncio.sleep(wait_time)

    def reset(self) -> None:
        """Reset the rate limiter to full capacity."""
        with self._lock:
            self.tokens = self.max_tokens
            self.last_refill = datetime.now()
            logger.debug("Rate limiter reset", tokens=self.tokens)