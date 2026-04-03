"""
Base HTTP client with retry, rate limiting, and caching.

Provides a foundation for all API clients with:
- Automatic retry with exponential backoff
- Rate limiting to respect API quotas
- Response caching for GET requests
- Structured error handling
- Request/response logging
"""

import asyncio
from collections.abc import Mapping, Sequence
from enum import Enum
from types import TracebackType
from typing import Self, TypeAlias
from urllib.parse import urlparse

import aiohttp
from aiohttp import ClientError, ClientResponseError, ClientTimeout

from backend.clients.errors import APIError
from backend.services.cache import _CACHE_MISS, ResponseCache
from backend.services.retry import RateLimiter
from backend.utils.logger import get_logger

logger = get_logger(__name__)

JSONScalar: TypeAlias = str | int | float | bool | None
JSONValue: TypeAlias = JSONScalar | dict[str, object] | list[object]
JSONDict: TypeAlias = dict[str, object]
QueryScalar: TypeAlias = str | int | float
QueryValue: TypeAlias = QueryScalar | Sequence[QueryScalar]
QueryParams: TypeAlias = Mapping[str, QueryValue]

# Allowed URL schemes for SSRF prevention
_ALLOWED_SCHEMES = frozenset({"http", "https"})


def _normalize_json(value: object) -> JSONValue:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        return [_normalize_json(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _normalize_json(item) for key, item in value.items()}
    raise ValueError("Response was not valid JSON")


def expect_json_object(value: JSONValue, *, context: str) -> JSONDict:
    if not isinstance(value, dict):
        raise APIError(f"Invalid JSON object for {context}")
    return value


def expect_json_object_list(value: object, *, context: str) -> list[JSONDict]:
    if not isinstance(value, list):
        raise APIError(f"Invalid JSON list for {context}")

    objects: list[JSONDict] = []
    for item in value:
        if not isinstance(item, dict):
            raise APIError(f"Invalid JSON object item for {context}")
        objects.append({str(key): inner for key, inner in item.items()})
    return objects


def _str(value: object) -> str:
    """Narrow a JSON value to str at trust boundary."""
    if isinstance(value, str):
        return value
    return str(value) if value is not None else ""


def _str_or_none(value: object) -> str | None:
    """Narrow a JSON value to str or None."""
    if value is None:
        return None
    return str(value)


def _float(value: object) -> float:
    """Narrow a JSON value to float at trust boundary."""
    if isinstance(value, (int, float)):
        return float(value)
    return float(str(value))


def _int_or(value: object, default: int = 0) -> int:
    """Narrow a JSON value to int with fallback."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if value is None:
        return default
    try:
        return int(str(value))
    except (ValueError, TypeError):
        return default


class HTTPMethod(str, Enum):
    """HTTP request methods."""

    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"


class BaseHTTPClient:
    """
    Base HTTP client with retry, rate limiting, and caching.

    Features:
    - Automatic retry on transient failures (5xx, timeouts)
    - Rate limiting to prevent quota exhaustion
    - Response caching for GET requests
    - Structured error handling and logging
    """

    def __init__(
        self,
        base_url: str,
        api_key: str | None = None,
        timeout: int = 30,
        max_retries: int = 3,
        rate_limit_calls: int = 100,
        rate_limit_period: float = 60.0,
        use_cache: bool = True,
        cache_ttl_seconds: int = 3600,
        session: aiohttp.ClientSession | None = None,
    ):
        """
        Initialize the base HTTP client.

        Args:
            base_url: Base URL for API endpoints
            api_key: Optional API key for authentication
            timeout: Request timeout in seconds
            max_retries: Maximum retry attempts
            rate_limit_calls: Number of calls allowed per period
            rate_limit_period: Rate limit period in seconds
            use_cache: Whether to cache GET responses
            cache_ttl_seconds: Cache TTL in seconds
            session: Optional aiohttp session to use

        Raises:
            ValueError: If base_url has invalid scheme or missing netloc
        """
        # Validate URL to prevent SSRF attacks
        parsed = urlparse(base_url)
        if parsed.scheme not in _ALLOWED_SCHEMES:
            raise ValueError(
                f"Invalid URL scheme '{parsed.scheme}'. Only http/https allowed."
            )
        if not parsed.netloc:
            raise ValueError(f"Invalid URL: missing network location in '{base_url}'")

        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.max_retries = max_retries
        self.use_cache = use_cache

        # Session management
        self._session = session
        self._owns_session = session is None
        self._session_lock = asyncio.Lock()  # Protect lazy session creation

        # Rate limiter
        self._rate_limiter = RateLimiter(
            calls_per_period=rate_limit_calls, period_seconds=rate_limit_period
        )

        # Response cache
        self._cache = (
            ResponseCache(default_ttl_seconds=cache_ttl_seconds) if use_cache else None
        )

        logger.info(
            "HTTP client initialized",
            base_url=base_url,
            timeout=timeout,
            max_retries=max_retries,
            rate_limit=f"{rate_limit_calls}/{rate_limit_period}s",
            cache_enabled=use_cache,
        )

    def _build_url(self, endpoint: str) -> str:
        """Build full URL from endpoint."""
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        return f"{self.base_url}{endpoint}"

    def _get_headers(
        self, custom_headers: dict[str, str] | None = None
    ) -> dict[str, str]:
        """
        Get request headers with authentication.

        Args:
            custom_headers: Additional headers to include

        Returns:
            Combined headers dictionary
        """
        headers = {"User-Agent": "Seichijunrei/1.0", "Accept": "application/json"}

        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        if custom_headers:
            headers.update(custom_headers)

        return headers

    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session with thread-safe lazy initialization."""
        # Fast path: if session exists, return it immediately (no lock needed)
        if self._session is not None:
            return self._session

        # Slow path: acquire lock and use double-checked locking
        async with self._session_lock:
            # Check again after acquiring lock (another coroutine may have created it)
            if self._session is None:
                timeout = ClientTimeout(total=self.timeout)
                self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def _make_request(
        self,
        method: HTTPMethod,
        url: str,
        headers: dict[str, str],
        params: QueryParams | None = None,
        json_data: JSONDict | None = None,
        data: object | None = None,
    ) -> JSONValue:
        """
        Make the actual HTTP request.

        Args:
            method: HTTP method
            url: Full URL
            headers: Request headers
            params: Query parameters
            json_data: JSON body
            data: Form data

        Returns:
            Response data as dictionary

        Raises:
            APIError: On request failure
        """
        session = await self._get_session()

        try:
            # Make the request
            async with session.request(
                method.value,
                url,
                headers=headers,
                params=params,
                json=json_data,
                data=data,
            ) as response:
                # Check for errors
                if response.status >= 400:
                    error_text = await response.text()
                    raise APIError(
                        f"API request failed with status {response.status}: {error_text}"
                    )

                # Parse response
                try:
                    return _normalize_json(await response.json())
                except Exception:
                    # Fallback to text if JSON parsing fails
                    text = await response.text()
                    return {"raw_response": text}

        except TimeoutError as e:
            raise APIError(f"Request timeout after {self.timeout} seconds") from e
        except ClientResponseError as e:
            raise APIError(f"HTTP {e.status}: {e.message}") from e
        except ClientError as e:
            raise APIError(f"Request failed: {str(e)}") from e
        except Exception as e:
            logger.error(
                "Unexpected error in request",
                method=method,
                url=url,
                error=str(e),
                exc_info=True,
            )
            raise APIError(f"Unexpected error: {str(e)}") from e

    async def request(
        self,
        method: HTTPMethod,
        endpoint: str,
        params: QueryParams | None = None,
        json_data: JSONDict | None = None,
        data: object | None = None,
        headers: dict[str, str] | None = None,
        skip_cache: bool = False,
    ) -> JSONValue:
        """
        Make an HTTP request with retry, rate limiting, and caching.

        Args:
            method: HTTP method
            endpoint: API endpoint path
            params: Query parameters
            json_data: JSON body data
            data: Form data
            headers: Additional headers
            skip_cache: Skip cache for this request

        Returns:
            Response data as dictionary

        Raises:
            APIError: On request failure after retries
        """
        # Build URL and headers
        url = self._build_url(endpoint)
        request_headers = self._get_headers(headers)

        # Check cache for GET requests
        if (
            method == HTTPMethod.GET
            and self.use_cache
            and not skip_cache
            and self._cache
        ):
            cache_key = self._cache.generate_key(url, params)
            cached = await self._cache.get(cache_key)
            if cached is not _CACHE_MISS:
                logger.debug("Cache hit", url=url, params=params)
                return _normalize_json(cached)

        # Manual retry logic
        last_exception = None
        for attempt in range(self.max_retries):
            try:
                # Apply rate limiting
                await self._rate_limiter.acquire()

                logger.debug(
                    "Making request",
                    method=method.value,
                    url=url,
                    params=params,
                    has_body=json_data is not None or data is not None,
                    attempt=attempt + 1,
                )

                # Make the request
                response = await self._make_request(
                    method=method,
                    url=url,
                    headers=request_headers,
                    params=params,
                    json_data=json_data,
                    data=data,
                )

                # Cache successful GET responses
                if method == HTTPMethod.GET and self.use_cache and self._cache:
                    cache_key = self._cache.generate_key(url, params)
                    await self._cache.set(cache_key, response)

                logger.debug("Request successful", url=url, method=method.value)
                return response

            except APIError as e:
                last_exception = e
                error_str = str(e)

                # Check if it's a client error (4xx) - don't retry these
                if any(code in error_str for code in ["400", "401", "403", "404"]):
                    logger.error(
                        "Client error (no retry)",
                        url=url,
                        method=method.value,
                        error=error_str,
                    )
                    raise

                # If we've exhausted retries
                if attempt == self.max_retries - 1:
                    logger.error(
                        "Max retries exceeded",
                        url=url,
                        method=method.value,
                        error=error_str,
                        attempts=self.max_retries,
                    )
                    raise

                # Calculate backoff delay
                delay = min(2**attempt, 30)  # Exponential backoff capped at 30s

                logger.warning(
                    "Request failed (will retry)",
                    url=url,
                    method=method.value,
                    error=error_str,
                    attempt=attempt + 1,
                    next_delay=delay,
                )

                await asyncio.sleep(delay)

            except Exception as e:
                # Unexpected errors - don't retry
                logger.error(
                    "Unexpected error (no retry)",
                    url=url,
                    method=method.value,
                    error=str(e),
                    exc_info=True,
                )
                raise APIError(f"Unexpected error: {str(e)}") from e

        # Should never reach here
        if last_exception:
            raise last_exception
        raise RuntimeError("request exhausted retries without capturing an exception")

    async def get(
        self,
        endpoint: str,
        params: QueryParams | None = None,
        *,
        headers: dict[str, str] | None = None,
        skip_cache: bool = False,
        data: object | None = None,
    ) -> JSONValue:
        """Convenience method for GET requests."""
        return await self.request(
            HTTPMethod.GET,
            endpoint,
            params=params,
            data=data,
            headers=headers,
            skip_cache=skip_cache,
        )

    async def post(
        self,
        endpoint: str,
        json_data: JSONDict | None = None,
        *,
        params: QueryParams | None = None,
        data: object | None = None,
        headers: dict[str, str] | None = None,
        skip_cache: bool = False,
    ) -> JSONValue:
        """Convenience method for POST requests."""
        return await self.request(
            HTTPMethod.POST,
            endpoint,
            params=params,
            json_data=json_data,
            data=data,
            headers=headers,
            skip_cache=skip_cache,
        )

    async def put(
        self,
        endpoint: str,
        json_data: JSONDict | None = None,
        *,
        params: QueryParams | None = None,
        data: object | None = None,
        headers: dict[str, str] | None = None,
        skip_cache: bool = False,
    ) -> JSONValue:
        """Convenience method for PUT requests."""
        return await self.request(
            HTTPMethod.PUT,
            endpoint,
            params=params,
            json_data=json_data,
            data=data,
            headers=headers,
            skip_cache=skip_cache,
        )

    async def delete(
        self,
        endpoint: str,
        *,
        params: QueryParams | None = None,
        headers: dict[str, str] | None = None,
        skip_cache: bool = False,
        data: object | None = None,
    ) -> JSONValue:
        """Convenience method for DELETE requests."""
        return await self.request(
            HTTPMethod.DELETE,
            endpoint,
            params=params,
            data=data,
            headers=headers,
            skip_cache=skip_cache,
        )

    async def close(self) -> None:
        """Close the HTTP session."""
        if self._session and self._owns_session:
            await self._session.close()
            self._session = None
            logger.debug("HTTP session closed")

    async def __aenter__(self) -> Self:
        """Async context manager entry."""
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        """Async context manager exit."""
        await self.close()
