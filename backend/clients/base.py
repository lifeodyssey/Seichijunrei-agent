"""
Base HTTP client with retry, rate limiting, and caching.

Provides a foundation for all API clients with:
- Automatic retry with exponential backoff
- Rate limiting to respect API quotas
- Response caching for GET requests
- Structured error handling
- Request/response logging

Cache integration lives in ``cache_mixin``, retry orchestration in
``retry``; this module wires them together.
"""

import asyncio
from collections.abc import Mapping, Sequence
from enum import Enum
from types import TracebackType
from typing import Self, TypeAlias
from urllib.parse import urlparse

import aiohttp
from aiohttp import ClientError, ClientResponseError, ClientTimeout

from backend.clients.cache_mixin import CacheMixin, ResponseCache
from backend.clients.errors import APIError
from backend.clients.retry import request_with_retry
from backend.services.cache import _CACHE_MISS  # noqa: F401 — re-export
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


def _wrap_transport_error(exc: Exception, timeout: int) -> APIError:
    """Convert transport-level exceptions to APIError."""
    if isinstance(exc, APIError):
        return exc
    if isinstance(exc, TimeoutError):
        return APIError(f"Request timeout after {timeout} seconds")
    if isinstance(exc, ClientResponseError):
        return APIError(f"HTTP {exc.status}: {exc.message}")
    if isinstance(exc, ClientError):
        return APIError(f"Request failed: {str(exc)}")
    return APIError(f"Unexpected error: {str(exc)}")


class HTTPMethod(str, Enum):
    """HTTP request methods."""

    GET = "GET"
    POST = "POST"
    PUT = "PUT"
    DELETE = "DELETE"
    PATCH = "PATCH"


class BaseHTTPClient(CacheMixin):
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

        self._session = session
        self._owns_session = session is None
        self._session_lock = asyncio.Lock()

        self._rate_limiter = RateLimiter(
            calls_per_period=rate_limit_calls,
            period_seconds=rate_limit_period,
        )
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

    # -- URL / header helpers -------------------------------------------------

    def _build_url(self, endpoint: str) -> str:
        if not endpoint.startswith("/"):
            endpoint = f"/{endpoint}"
        return f"{self.base_url}{endpoint}"

    def _get_headers(
        self, custom_headers: dict[str, str] | None = None
    ) -> dict[str, str]:
        headers = {"User-Agent": "Seichijunrei/1.0", "Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if custom_headers:
            headers.update(custom_headers)
        return headers

    # -- Session management ---------------------------------------------------

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is not None:
            return self._session
        async with self._session_lock:
            if self._session is None:
                self._session = aiohttp.ClientSession(
                    timeout=ClientTimeout(total=self.timeout),
                )
        return self._session

    # -- Core HTTP (single attempt) -------------------------------------------

    async def _make_request(
        self,
        method: HTTPMethod,
        url: str,
        headers: dict[str, str],
        params: QueryParams | None = None,
        json_data: JSONDict | None = None,
        data: object | None = None,
    ) -> JSONValue:
        session = await self._get_session()
        try:
            return await self._send_and_parse(
                session,
                method,
                url,
                headers,
                params,
                json_data,
                data,
            )
        except (APIError, TimeoutError, ClientResponseError, ClientError) as e:
            raise _wrap_transport_error(e, self.timeout) from e
        except Exception as e:
            raise APIError(f"Unexpected error: {str(e)}") from e

    async def _send_and_parse(
        self,
        session: aiohttp.ClientSession,
        method: HTTPMethod,
        url: str,
        headers: dict[str, str],
        params: QueryParams | None,
        json_data: JSONDict | None,
        data: object | None,
    ) -> JSONValue:
        async with session.request(
            method.value,
            url,
            headers=headers,
            params=params,
            json=json_data,
            data=data,
        ) as response:
            if response.status >= 400:
                text = await response.text()
                raise APIError(
                    f"API request failed with status {response.status}: {text}"
                )
            try:
                return _normalize_json(await response.json())
            except Exception:
                return {"raw_response": await response.text()}

    # -- Public request (retry + cache + rate-limit) --------------------------

    async def _rate_limited_attempt(
        self,
        method: HTTPMethod,
        url: str,
        headers: dict[str, str],
        params: QueryParams | None,
        json_data: JSONDict | None,
        data: object | None,
    ) -> JSONValue:
        """Single rate-limited HTTP attempt (called by retry loop)."""
        await self._rate_limiter.acquire()
        logger.debug(
            "Making request",
            method=method.value,
            url=url,
            params=params,
            has_body=json_data is not None or data is not None,
        )
        return await self._make_request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            json_data=json_data,
            data=data,
        )

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
        url = self._build_url(endpoint)
        req_headers = self._get_headers(headers)

        if method == HTTPMethod.GET and self.use_cache and not skip_cache:
            hit, cached = await self.cache_lookup(url, params)
            if hit:
                return cached

        response = await request_with_retry(
            max_retries=self.max_retries,
            make_request=lambda: self._rate_limited_attempt(
                method,
                url,
                req_headers,
                params,
                json_data,
                data,
            ),
            url=url,
            method_label=method.value,
        )

        if method == HTTPMethod.GET and self.use_cache:
            await self.cache_store(url, params, response)

        logger.debug("Request successful", url=url, method=method.value)
        return response

    # -- Convenience verbs ----------------------------------------------------

    async def get(
        self,
        endpoint: str,
        params: QueryParams | None = None,
        *,
        headers: dict[str, str] | None = None,
        skip_cache: bool = False,
        data: object | None = None,
    ) -> JSONValue:
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
        return await self.request(
            HTTPMethod.DELETE,
            endpoint,
            params=params,
            data=data,
            headers=headers,
            skip_cache=skip_cache,
        )

    # -- Lifecycle ------------------------------------------------------------

    async def close(self) -> None:
        if self._session and self._owns_session:
            await self._session.close()
            self._session = None
            logger.debug("HTTP session closed")

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        await self.close()
