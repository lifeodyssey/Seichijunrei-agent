"""
Bangumi API client for anime/manga metadata.

Official API: https://bangumi.github.io/api/
Provides methods to:
- Search for anime/manga by keyword
- Retrieve subject details by ID
"""

import urllib.parse

from clients.base import BaseHTTPClient
from domain.entities import APIError
from utils.logger import get_logger

logger = get_logger(__name__)


class BangumiClient(BaseHTTPClient):
    """
    Client for the Bangumi metadata API.

    Provides access to anime/manga metadata including:
    - Subject search by keyword
    - Subject details by ID
    - Ratings and reviews

    Note: Search endpoints do NOT require authentication.
    """

    # API Constants
    BANGUMI_API_BASE = "https://api.bgm.tv"
    USER_AGENT = "Seichijunrei/1.0 (https://github.com/yourusername/seichijunrei)"

    # Subject Types
    TYPE_BOOK = 1
    TYPE_ANIME = 2
    TYPE_MUSIC = 3
    TYPE_GAME = 4
    TYPE_REAL = 6

    def __init__(
        self,
        base_url: str | None = None,
        use_cache: bool = True,
        rate_limit_calls: int = 30,
        rate_limit_period: float = 60.0,
    ):
        """
        Initialize Bangumi API client.

        Args:
            base_url: Override base URL (default: https://api.bgm.tv)
            use_cache: Whether to cache GET responses (default: True)
            rate_limit_calls: Number of calls allowed per period
            rate_limit_period: Rate limit period in seconds
        """
        super().__init__(
            base_url=base_url or self.BANGUMI_API_BASE,
            api_key=None,  # No API key needed for search
            timeout=10,
            max_retries=3,
            rate_limit_calls=rate_limit_calls,
            rate_limit_period=rate_limit_period,
            use_cache=use_cache,
            cache_ttl_seconds=86400,  # Cache for 24 hours
        )

        logger.info(
            "Bangumi client initialized",
            base_url=self.base_url,
            cache_enabled=use_cache,
            rate_limit=f"{rate_limit_calls}/{rate_limit_period}s",
        )

    async def search_subject(
        self, keyword: str, subject_type: int = TYPE_ANIME, max_results: int = 10
    ) -> list[dict]:
        """
        Search for subjects by keyword.

        Args:
            keyword: Search keyword (anime/manga name)
            subject_type: Type filter (1=book, 2=anime, 3=music, 4=game, 6=real)
            max_results: Maximum results to return (1-20)

        Returns:
            List of subject dictionaries with id, name, name_cn, type, images, etc.

        Raises:
            APIError: On API communication failure
            ValueError: On invalid parameters

        Example:
            >>> client = BangumiClient()
            >>> results = await client.search_subject("Your Name")
            >>> print(results[0]["name_cn"])
            'Your Name.'
        """
        # Validate parameters
        if not keyword or not keyword.strip():
            raise ValueError("Keyword cannot be empty")

        if not 1 <= max_results <= 20:
            raise ValueError("max_results must be between 1 and 20")

        try:
            logger.info(
                "Searching bangumi subjects",
                keyword=keyword,
                subject_type=subject_type,
                max_results=max_results,
            )

            # URL encode the keyword
            encoded_keyword = urllib.parse.quote(keyword)

            # Make API request
            response = await self.get(
                f"/search/subject/{encoded_keyword}",
                params={"type": subject_type, "max_results": max_results},
                headers={"User-Agent": self.USER_AGENT},
            )

            # Extract results
            results = response.get("list", [])

            logger.info(
                "Bangumi search completed", keyword=keyword, results_count=len(results)
            )

            return results

        except APIError:
            # Re-raise API errors
            raise

        except Exception as e:
            logger.error(
                "Bangumi search failed", keyword=keyword, error=str(e), exc_info=True
            )
            raise APIError(f"Bangumi search failed: {str(e)}") from e

    async def get_subject(self, subject_id: int) -> dict:
        """
        Get detailed information about a subject by ID.

        Args:
            subject_id: Bangumi subject ID

        Returns:
            Subject details dictionary

        Raises:
            APIError: On API communication failure
            ValueError: On invalid subject_id

        Example:
            >>> client = BangumiClient()
            >>> subject = await client.get_subject(160209)
            >>> print(subject["name"])
            'Kimi no Na wa.'
        """
        if subject_id <= 0:
            raise ValueError("subject_id must be positive")

        try:
            logger.info("Fetching bangumi subject details", subject_id=subject_id)

            response = await self.get(
                f"/subject/{subject_id}", headers={"User-Agent": self.USER_AGENT}
            )

            logger.info(
                "Bangumi subject fetched",
                subject_id=subject_id,
                name=response.get("name"),
            )

            return response

        except APIError:
            raise

        except Exception as e:
            logger.error(
                "Failed to fetch bangumi subject",
                subject_id=subject_id,
                error=str(e),
                exc_info=True,
            )
            raise APIError(f"Failed to fetch subject {subject_id}: {str(e)}") from e
