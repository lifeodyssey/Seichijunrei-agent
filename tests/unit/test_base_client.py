"""
Unit tests for the base HTTP client.

Tests cover:
- HTTP request methods (GET, POST, PUT, DELETE)
- Retry integration
- Rate limiting integration
- Cache integration
- Error handling for various HTTP status codes
- Request/response logging
- Session management
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import aiohttp
import pytest

from clients.base import BaseHTTPClient, HTTPMethod
from domain.entities import APIError


class TestBaseHTTPClient:
    """Test the base HTTP client."""

    @pytest.fixture
    async def mock_session(self):
        """Create a mock aiohttp session."""
        session = MagicMock(spec=aiohttp.ClientSession)

        # Mock response with async context manager support
        response = MagicMock()
        response.status = 200
        response.json = AsyncMock(return_value={"data": "test"})
        response.text = AsyncMock(return_value='{"data": "test"}')
        response.raise_for_status = MagicMock()

        # Make response an async context manager
        response.__aenter__ = AsyncMock(return_value=response)
        response.__aexit__ = AsyncMock(return_value=None)

        # Mock session methods to return the response context manager
        session.get = MagicMock(return_value=response)
        session.post = MagicMock(return_value=response)
        session.put = MagicMock(return_value=response)
        session.delete = MagicMock(return_value=response)
        session.close = AsyncMock()

        return session

    @pytest.mark.asyncio
    async def test_client_initialization(self):
        """Test client initialization with default settings."""
        client = BaseHTTPClient(base_url="https://api.example.com", api_key="test_key")

        assert client.base_url == "https://api.example.com"
        assert client.api_key == "test_key"
        assert client.timeout == 30
        assert client.max_retries == 3

    @pytest.mark.asyncio
    async def test_get_request(self, mock_session):
        """Test GET request."""
        client = BaseHTTPClient(
            base_url="https://api.example.com", session=mock_session
        )

        result = await client.request(
            method=HTTPMethod.GET, endpoint="/test", params={"key": "value"}
        )

        assert result == {"data": "test"}
        mock_session.get.assert_called_once()
        call_args = mock_session.get.call_args
        assert "https://api.example.com/test" in str(call_args)

    @pytest.mark.asyncio
    async def test_post_request(self, mock_session):
        """Test POST request with JSON body."""
        client = BaseHTTPClient(
            base_url="https://api.example.com", session=mock_session
        )

        body = {"field": "value"}
        result = await client.request(
            method=HTTPMethod.POST, endpoint="/test", json_data=body
        )

        assert result == {"data": "test"}
        mock_session.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_request_with_headers(self, mock_session):
        """Test request with custom headers."""
        client = BaseHTTPClient(
            base_url="https://api.example.com", api_key="test_key", session=mock_session
        )

        custom_headers = {"X-Custom": "value"}
        await client.request(
            method=HTTPMethod.GET, endpoint="/test", headers=custom_headers
        )

        mock_session.get.assert_called_once()
        call_kwargs = mock_session.get.call_args[1]
        assert "headers" in call_kwargs
        assert "Authorization" in call_kwargs["headers"]  # API key
        assert "X-Custom" in call_kwargs["headers"]

    @pytest.mark.asyncio
    async def test_retry_on_server_error(self, mock_session):
        """Test retry on 5xx server errors."""
        # Setup responses: fail twice, then succeed
        error_response = MagicMock()
        error_response.status = 500
        error_response.text = AsyncMock(return_value="Server Error")
        error_response.raise_for_status = MagicMock()
        error_response.__aenter__ = AsyncMock(return_value=error_response)
        error_response.__aexit__ = AsyncMock(return_value=None)

        success_response = MagicMock()
        success_response.status = 200
        success_response.json = AsyncMock(return_value={"data": "success"})
        success_response.raise_for_status = MagicMock()
        success_response.__aenter__ = AsyncMock(return_value=success_response)
        success_response.__aexit__ = AsyncMock(return_value=None)

        # Make get return different responses on successive calls
        call_count = 0

        def get_side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                return error_response
            return success_response

        mock_session.get.side_effect = get_side_effect

        client = BaseHTTPClient(
            base_url="https://api.example.com", session=mock_session, max_retries=3
        )

        # Should retry and eventually succeed
        result = await client.request(method=HTTPMethod.GET, endpoint="/test")

        assert result == {"data": "success"}
        assert mock_session.get.call_count == 3

    @pytest.mark.asyncio
    async def test_no_retry_on_client_error(self, mock_session):
        """Test no retry on 4xx client errors."""
        error_response = MagicMock()
        error_response.status = 404
        error_response.text = AsyncMock(return_value="Not Found")
        error_response.raise_for_status = MagicMock()
        error_response.__aenter__ = AsyncMock(return_value=error_response)
        error_response.__aexit__ = AsyncMock(return_value=None)

        mock_session.get.return_value = error_response

        client = BaseHTTPClient(
            base_url="https://api.example.com", session=mock_session, max_retries=3
        )

        # Should not retry on 404
        with pytest.raises(APIError, match="404"):
            await client.request(method=HTTPMethod.GET, endpoint="/test")

        # Should only be called once (no retry)
        assert mock_session.get.call_count == 1

    @pytest.mark.asyncio
    async def test_rate_limiting(self):
        """Test rate limiting integration."""
        client = BaseHTTPClient(
            base_url="https://api.example.com",
            rate_limit_calls=2,
            rate_limit_period=0.5,  # 2 calls per 0.5 seconds
            use_cache=False,  # Disable cache for this test
        )

        with patch.object(
            client, "_make_request", new_callable=AsyncMock
        ) as mock_request:
            mock_request.return_value = {"data": "test"}

            # Make 3 rapid requests
            start_time = asyncio.get_event_loop().time()
            results = await asyncio.gather(
                client.request(HTTPMethod.GET, "/test1"),  # Different endpoints
                client.request(HTTPMethod.GET, "/test2"),  # to avoid cache
                client.request(HTTPMethod.GET, "/test3"),
            )
            elapsed = asyncio.get_event_loop().time() - start_time

            # Third request should be delayed
            assert elapsed >= 0.25  # Should wait for rate limit
            assert all(r == {"data": "test"} for r in results)

    @pytest.mark.asyncio
    async def test_caching_get_requests(self):
        """Test that GET requests are cached."""
        client = BaseHTTPClient(
            base_url="https://api.example.com", use_cache=True, cache_ttl_seconds=60
        )

        with patch.object(
            client, "_make_request", new_callable=AsyncMock
        ) as mock_request:
            mock_request.return_value = {"data": "test"}

            # First request
            result1 = await client.request(
                HTTPMethod.GET, "/test", params={"q": "search"}
            )

            # Second identical request (should be cached)
            result2 = await client.request(
                HTTPMethod.GET, "/test", params={"q": "search"}
            )

            # Only one actual request should be made
            assert mock_request.call_count == 1
            assert result1 == result2

    @pytest.mark.asyncio
    async def test_no_caching_post_requests(self):
        """Test that POST requests are not cached."""
        client = BaseHTTPClient(base_url="https://api.example.com", use_cache=True)

        with patch.object(
            client, "_make_request", new_callable=AsyncMock
        ) as mock_request:
            mock_request.return_value = {"data": "test"}

            # Make two identical POST requests
            await client.request(HTTPMethod.POST, "/test", json_data={"data": "value"})
            await client.request(HTTPMethod.POST, "/test", json_data={"data": "value"})

            # Both should make actual requests (no caching)
            assert mock_request.call_count == 2

    @pytest.mark.asyncio
    async def test_session_lifecycle(self):
        """Test session creation and cleanup."""
        client = BaseHTTPClient(base_url="https://api.example.com")

        # Session should be created on first use
        assert client._session is None

        with patch("aiohttp.ClientSession") as MockSession:
            mock_instance = AsyncMock()
            mock_instance.close = AsyncMock()

            # Create a mock response
            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.json = AsyncMock(return_value={"data": "test"})
            mock_response.__aenter__ = AsyncMock(return_value=mock_response)
            mock_response.__aexit__ = AsyncMock(return_value=None)

            # Mock the get method
            mock_instance.get = MagicMock(return_value=mock_response)
            MockSession.return_value = mock_instance

            # Use context manager and make a request
            async with client:
                # Make a request to trigger session creation
                await client.get("/test")
                # Session should be created
                assert client._session is not None

            # Session should be closed
            mock_instance.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_timeout_handling(self, mock_session):
        """Test request timeout handling."""
        mock_session.get.side_effect = TimeoutError()

        client = BaseHTTPClient(
            base_url="https://api.example.com",
            session=mock_session,
            timeout=1,
            max_retries=2,
        )

        with pytest.raises(APIError, match="timeout"):
            await client.request(HTTPMethod.GET, "/test")

        # Should retry on timeout
        assert mock_session.get.call_count == 2

    @pytest.mark.asyncio
    async def test_url_construction(self):
        """Test URL construction with various inputs."""
        client = BaseHTTPClient(base_url="https://api.example.com")

        # Test with leading slash
        url1 = client._build_url("/test")
        assert url1 == "https://api.example.com/test"

        # Test without leading slash
        url2 = client._build_url("test")
        assert url2 == "https://api.example.com/test"

        # Test with trailing slash in base URL
        client2 = BaseHTTPClient(base_url="https://api.example.com/")
        url3 = client2._build_url("/test")
        assert url3 == "https://api.example.com/test"

    @pytest.mark.asyncio
    async def test_error_response_parsing(self, mock_session):
        """Test parsing error messages from API responses."""
        error_response = MagicMock()
        error_response.status = 400
        error_response.json = AsyncMock(
            return_value={
                "error": "Invalid request",
                "message": "Missing required field",
            }
        )
        error_response.text = AsyncMock(return_value='{"error": "Invalid request"}')
        error_response.raise_for_status = MagicMock()
        error_response.__aenter__ = AsyncMock(return_value=error_response)
        error_response.__aexit__ = AsyncMock(return_value=None)

        mock_session.get.return_value = error_response

        client = BaseHTTPClient(
            base_url="https://api.example.com", session=mock_session
        )

        with pytest.raises(APIError) as exc_info:
            await client.request(HTTPMethod.GET, "/test")

        assert "400" in str(exc_info.value)
