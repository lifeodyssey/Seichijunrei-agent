"""
Retry orchestration for HTTP clients.

Provides the retry loop with exponential backoff that wraps
individual HTTP requests, deciding which errors are transient.
"""

import asyncio
from collections.abc import Awaitable, Callable, Mapping, Sequence

from backend.clients.errors import APIError
from backend.utils.logger import get_logger

logger = get_logger(__name__)

# Type aliases duplicated here so retry.py is self-contained
QueryScalar = str | int | float
QueryValue = QueryScalar | Sequence[QueryScalar]
QueryParams = Mapping[str, QueryValue]

JSONValue = str | int | float | bool | None | dict[str, object] | list[object]
JSONDict = dict[str, object]

# 4xx codes that must not be retried
_CLIENT_ERROR_CODES = frozenset({"400", "401", "403", "404"})


async def request_with_retry(
    *,
    max_retries: int,
    make_request: Callable[[], Awaitable[JSONValue]],
    url: str,
    method_label: str,
) -> JSONValue:
    """Execute *make_request* with retry + exponential backoff.

    Args:
        max_retries: Total attempts (including first try).
        make_request: Zero-arg async callable that performs one HTTP attempt.
        url: For logging only.
        method_label: HTTP method string for logging.

    Returns:
        The response from a successful attempt.

    Raises:
        APIError: After all retries are exhausted, or immediately for 4xx.
    """
    last_exception: APIError | None = None

    for attempt in range(max_retries):
        try:
            return await make_request()
        except APIError as exc:
            last_exception = exc
            error_str = str(exc)

            if _is_client_error(error_str):
                logger.error(
                    "Client error (no retry)",
                    url=url,
                    method=method_label,
                    error=error_str,
                )
                raise

            if attempt == max_retries - 1:
                logger.error(
                    "Max retries exceeded",
                    url=url,
                    method=method_label,
                    error=error_str,
                    attempts=max_retries,
                )
                raise

            delay = min(2**attempt, 30)
            logger.warning(
                "Request failed (will retry)",
                url=url,
                method=method_label,
                error=error_str,
                attempt=attempt + 1,
                next_delay=delay,
            )
            await asyncio.sleep(delay)

        except (OSError, RuntimeError, ValueError, TypeError) as exc:
            logger.error(
                "Unexpected error (no retry)",
                url=url,
                method=method_label,
                error=str(exc),
                exc_info=True,
            )
            raise APIError(f"Unexpected error: {str(exc)}") from exc

    if last_exception:
        raise last_exception
    raise RuntimeError("request exhausted retries without capturing an exception")


def _is_client_error(error_str: str) -> bool:
    """Return True when the error string contains a 4xx status code."""
    return any(code in error_str for code in _CLIENT_ERROR_CODES)
