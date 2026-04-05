"""Google Geocoding API gateway for resolving addresses to coordinates."""

from __future__ import annotations

import os
from collections.abc import Mapping

import aiohttp
import structlog

logger = structlog.get_logger(__name__)

_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


class GoogleGeocodingGateway:
    """Resolve an address string to (lat, lng) via Google Geocoding API."""

    async def geocode(self, address: str) -> tuple[float, float] | None:
        """Geocode *address* and return ``(latitude, longitude)`` or ``None``.

        Returns ``None`` when:
        - ``GOOGLE_MAPS_API_KEY`` is not set
        - The API returns zero results
        - Any network or parsing error occurs
        """
        api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
        if not api_key:
            logger.warning(
                "google_geocoding_skipped", reason="GOOGLE_MAPS_API_KEY not set"
            )
            return None

        params = {
            "address": address,
            "key": api_key,
            "region": "jp",
            "language": "ja",
        }

        try:
            proxy = os.environ.get("https_proxy") or os.environ.get("HTTPS_PROXY")
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    _GEOCODE_URL, params=params, proxy=proxy
                ) as resp:
                    if resp.status != 200:
                        logger.warning(
                            "google_geocoding_http_error",
                            status=resp.status,
                            address=address,
                        )
                        return None

                    body: object = await resp.json()

            if not isinstance(body, Mapping):
                return None

            results = body.get("results")
            if not isinstance(results, list) or len(results) == 0:
                logger.info("google_geocoding_no_results", address=address)
                return None

            first = results[0]
            if not isinstance(first, Mapping):
                return None

            geometry = first.get("geometry")
            if not isinstance(geometry, Mapping):
                return None

            location = geometry.get("location")
            if not isinstance(location, Mapping):
                return None

            lat = location.get("lat")
            lng = location.get("lng")
            if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
                return None

            logger.info(
                "google_geocoding_resolved",
                address=address,
                lat=lat,
                lng=lng,
            )
            return (float(lat), float(lng))

        except Exception as exc:
            logger.warning(
                "google_geocoding_error",
                address=address,
                error=str(exc),
            )
            return None
