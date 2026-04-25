"""Google Geocoding API gateway for resolving addresses to coordinates."""

from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import aiohttp
import structlog

logger = structlog.get_logger(__name__)

_GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


@dataclass(frozen=True, slots=True)
class GeocodingCandidate:
    """A single geocoding result with display label and coordinates."""

    label: str  # e.g. "藤沢駅, 神奈川県藤沢市"
    lat: float
    lng: float


def _parse_candidate(item: object) -> GeocodingCandidate | None:
    """Extract a candidate from a single API result object."""
    if not isinstance(item, Mapping):
        return None
    label = item.get("formatted_address")
    if not isinstance(label, str):
        return None
    geometry = item.get("geometry")
    if not isinstance(geometry, Mapping):
        return None
    location = geometry.get("location")
    if not isinstance(location, Mapping):
        return None
    lat = location.get("lat")
    lng = location.get("lng")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    return GeocodingCandidate(label=label, lat=float(lat), lng=float(lng))


class GoogleGeocodingGateway:
    """Resolve an address string to coordinates via Google Geocoding API."""

    async def geocode(self, address: str) -> tuple[float, float] | None:
        """Geocode *address* and return the first match as ``(lat, lng)``.

        Convenience wrapper over :meth:`geocode_candidates` for the common
        single-result case.
        """
        candidates = await self.geocode_candidates(address)
        if not candidates:
            return None
        return (candidates[0].lat, candidates[0].lng)

    async def geocode_candidates(
        self, address: str, *, max_results: int = 5
    ) -> Sequence[GeocodingCandidate]:
        """Return up to *max_results* geocoding candidates for *address*.

        Returns an empty sequence when the key is missing, the API returns
        zero results, or any error occurs.
        """
        api_key = os.environ.get("GOOGLE_MAPS_API_KEY")
        if not api_key:
            logger.warning(
                "google_geocoding_skipped", reason="GOOGLE_MAPS_API_KEY not set"
            )
            return ()

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
                        return ()

                    body: object = await resp.json()

            if not isinstance(body, Mapping):
                return ()

            results = body.get("results")
            if not isinstance(results, list) or len(results) == 0:
                logger.info("google_geocoding_no_results", address=address)
                return ()

            candidates: list[GeocodingCandidate] = []
            for item in results[:max_results]:
                c = _parse_candidate(item)
                if c is not None:
                    candidates.append(c)

            if candidates:
                logger.info(
                    "google_geocoding_resolved",
                    address=address,
                    count=len(candidates),
                    first=candidates[0].label,
                )

            return candidates

        except (OSError, RuntimeError, ValueError) as exc:
            logger.warning(
                "google_geocoding_error",
                address=address,
                error=str(exc),
            )
            return ()
