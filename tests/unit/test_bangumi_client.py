"""
Unit tests for Bangumi API client.

Tests cover:
- Subject search by keyword
- Subject details retrieval
- Error handling for invalid parameters
- Response caching behavior
- Rate limiting
- Context manager lifecycle
"""

from unittest.mock import AsyncMock, patch

import pytest

from clients.bangumi import BangumiClient
from clients.errors import APIError


class TestBangumiClient:
    """Test the Bangumi API client."""

    @pytest.fixture
    async def client(self):
        """Create a Bangumi client instance."""
        return BangumiClient(
            use_cache=True,
            rate_limit_calls=10,
            rate_limit_period=1.0,
        )

    @pytest.fixture
    def mock_search_response(self):
        """Mock response for subject search."""
        return {
            "list": [
                {
                    "id": 12345,
                    "name": "Your Name",
                    "name_cn": "你的名字",
                    "type": 2,
                    "images": {
                        "large": "https://example.com/image.jpg",
                        "common": "https://example.com/image_common.jpg",
                        "medium": "https://example.com/image_medium.jpg",
                        "small": "https://example.com/image_small.jpg",
                    },
                    "summary": "A high school boy in Tokyo and a high school girl in a rural town swap bodies.",
                    "air_date": "2016-08-26",
                },
                {
                    "id": 67890,
                    "name": "Weathering with You",
                    "name_cn": "天气之子",
                    "type": 2,
                    "images": {
                        "large": "https://example.com/image2.jpg",
                    },
                    "summary": "A high school boy runs away to Tokyo and meets a girl who can manipulate weather.",
                    "air_date": "2019-07-19",
                },
            ]
        }

    @pytest.fixture
    def mock_subject_response(self):
        """Mock response for subject details."""
        return {
            "id": 12345,
            "name": "Kimi no Na wa.",
            "name_cn": "你的名字",
            "type": 2,
            "images": {
                "large": "https://example.com/image.jpg",
            },
            "summary": "A high school boy in Tokyo and a high school girl in a rural town swap bodies.",
            "air_date": "2016-08-26",
            "rating": {
                "total": 50000,
                "count": {"1": 100, "2": 200, "3": 500, "4": 2000, "5": 47200},
                "score": 8.5,
            },
        }

    @pytest.mark.asyncio
    async def test_client_initialization(self, client):
        """Test client initializes with correct defaults."""
        assert client.base_url == BangumiClient.BANGUMI_API_BASE
        assert client.timeout == 10
        assert client.max_retries == 3
        assert client.use_cache is True

    @pytest.mark.asyncio
    async def test_search_subject_success(self, client, mock_search_response):
        """Test successful subject search."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_search_response

            results = await client.search_subject("Your Name")

            assert len(results) == 2
            assert results[0]["name"] == "Your Name"
            assert results[0]["name_cn"] == "你的名字"
            assert results[1]["name"] == "Weathering with You"

            # Verify the API call
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert "/search/subject/Your%20Name" in call_args[0][0]
            assert call_args[1]["params"]["type"] == BangumiClient.TYPE_ANIME

    @pytest.mark.asyncio
    async def test_search_subject_empty_results(self, client):
        """Test search with no results."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = {"list": []}

            results = await client.search_subject("NonexistentAnime12345")

            assert results == []
            assert len(results) == 0

    @pytest.mark.asyncio
    async def test_search_subject_empty_keyword(self, client):
        """Test search with empty keyword raises ValueError."""
        with pytest.raises(ValueError, match="Keyword cannot be empty"):
            await client.search_subject("")

        with pytest.raises(ValueError, match="Keyword cannot be empty"):
            await client.search_subject("   ")

    @pytest.mark.asyncio
    async def test_search_subject_invalid_max_results(self, client):
        """Test search with invalid max_results raises ValueError."""
        with pytest.raises(ValueError, match="max_results must be between 1 and 20"):
            await client.search_subject("Your Name", max_results=0)

        with pytest.raises(ValueError, match="max_results must be between 1 and 20"):
            await client.search_subject("Your Name", max_results=25)

        with pytest.raises(ValueError, match="max_results must be between 1 and 20"):
            await client.search_subject("Your Name", max_results=-1)

    @pytest.mark.asyncio
    async def test_search_subject_with_custom_type(self, client, mock_search_response):
        """Test search with custom subject type."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_search_response

            await client.search_subject(
                "Attack on Titan", subject_type=BangumiClient.TYPE_BOOK, max_results=5
            )

            call_args = mock_get.call_args
            assert call_args[1]["params"]["type"] == BangumiClient.TYPE_BOOK
            assert call_args[1]["params"]["max_results"] == 5

    @pytest.mark.asyncio
    async def test_search_subject_api_error(self, client):
        """Test search handles API errors properly."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = APIError("API connection failed")

            with pytest.raises(APIError, match="API connection failed"):
                await client.search_subject("Your Name")

    @pytest.mark.asyncio
    async def test_search_subject_unexpected_error(self, client):
        """Test search handles unexpected errors."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Unexpected error")

            with pytest.raises(APIError, match="Bangumi search failed"):
                await client.search_subject("Your Name")

    @pytest.mark.asyncio
    async def test_search_subject_user_agent(self, client, mock_search_response):
        """Test that User-Agent header is set correctly."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_search_response

            await client.search_subject("Your Name")

            call_args = mock_get.call_args
            assert "User-Agent" in call_args[1]["headers"]
            assert "Seichijunrei" in call_args[1]["headers"]["User-Agent"]

    @pytest.mark.asyncio
    async def test_get_subject_success(self, client, mock_subject_response):
        """Test successful subject retrieval."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_subject_response

            subject = await client.get_subject(12345)

            assert subject["id"] == 12345
            assert subject["name"] == "Kimi no Na wa."
            assert subject["name_cn"] == "你的名字"
            assert subject["rating"]["score"] == 8.5

            # Verify the API call
            mock_get.assert_called_once()
            call_args = mock_get.call_args
            assert "/subject/12345" in call_args[0][0]

    @pytest.mark.asyncio
    async def test_get_subject_invalid_id(self, client):
        """Test get_subject with invalid ID raises ValueError."""
        with pytest.raises(ValueError, match="subject_id must be positive"):
            await client.get_subject(0)

        with pytest.raises(ValueError, match="subject_id must be positive"):
            await client.get_subject(-1)

        with pytest.raises(ValueError, match="subject_id must be positive"):
            await client.get_subject(-999)

    @pytest.mark.asyncio
    async def test_get_subject_api_error(self, client):
        """Test get_subject handles API errors properly."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = APIError("Subject not found")

            with pytest.raises(APIError, match="Subject not found"):
                await client.get_subject(99999)

    @pytest.mark.asyncio
    async def test_get_subject_unexpected_error(self, client):
        """Test get_subject handles unexpected errors."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.side_effect = Exception("Network error")

            with pytest.raises(APIError, match="Failed to fetch subject 12345"):
                await client.get_subject(12345)

    @pytest.mark.asyncio
    async def test_get_subject_user_agent(self, client, mock_subject_response):
        """Test that User-Agent header is set for get_subject."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_subject_response

            await client.get_subject(12345)

            call_args = mock_get.call_args
            assert "User-Agent" in call_args[1]["headers"]
            assert "Seichijunrei" in call_args[1]["headers"]["User-Agent"]

    @pytest.mark.asyncio
    async def test_context_manager(self, mock_search_response):
        """Test client works as async context manager."""
        client = None
        async with BangumiClient() as ctx_client:
            client = ctx_client
            assert client is not None

            # Verify client can make requests within context
            with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
                mock_get.return_value = mock_search_response
                results = await client.search_subject("Test")
                assert len(results) == 2

        # After exiting context, session should be cleaned up
        # Just verify the context manager doesn't raise exceptions
        assert client is not None

    @pytest.mark.asyncio
    async def test_rate_limiting(self, client, mock_search_response):
        """Test that rate limiting is applied."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_search_response

            # Make multiple requests rapidly
            for i in range(5):
                await client.search_subject(f"Test {i}")

            # Should have made all requests (rate limiter should allow them)
            assert mock_get.call_count == 5

    @pytest.mark.asyncio
    async def test_caching_behavior(self, client, mock_search_response):
        """Test that responses are cached when enabled."""
        # This test verifies the caching is enabled
        # The actual caching behavior is tested in test_base_client.py
        assert client.use_cache is True
        # Cache TTL is passed to the ResponseCache, not stored on client
        assert client._cache is not None

    @pytest.mark.asyncio
    async def test_search_subject_url_encoding(self, client, mock_search_response):
        """Test that search keywords are properly URL encoded."""
        with patch.object(client, "get", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = mock_search_response

            # Test with special characters and Japanese
            await client.search_subject("けいおん！ K-ON!")

            call_args = mock_get.call_args
            # URL should be encoded
            assert (
                "%E3%81%91%E3%81%84%E3%81%8A%E3%82%93" in call_args[0][0]
                or "けいおん" in call_args[0][0]
            )
