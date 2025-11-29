"""
HTTP client implementations for external APIs.

Provides:
- Base HTTP client with retry, rate limiting, and caching
- Anitabi API client for anime location data
- Bangumi API client for anime/manga metadata
"""

from clients.anitabi import AnitabiClient
from clients.bangumi import BangumiClient
from clients.base import BaseHTTPClient, HTTPMethod

__all__ = [
    "BaseHTTPClient",
    "HTTPMethod",
    "AnitabiClient",
    "BangumiClient",
]
