"""
HTTP client implementations for external APIs.

Provides:
- Base HTTP client with retry, rate limiting, and caching
- Anitabi API client for anime location data
- Bangumi API client for anime/manga metadata
- Google Maps client for directions and places
- Weather API client for weather information
"""

from clients.anitabi import AnitabiClient
from clients.bangumi import BangumiClient
from clients.base import BaseHTTPClient, HTTPMethod
from clients.google_maps import GoogleMapsClient
from clients.weather import WeatherClient

__all__ = [
    "BaseHTTPClient",
    "HTTPMethod",
    "AnitabiClient",
    "BangumiClient",
    "GoogleMapsClient",
    "WeatherClient",
]
