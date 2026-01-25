"""Google Geocoding tool for converting location names to coordinates.

This tool uses the Google Maps Geocoding API via the googlemaps library
to convert location names (in multiple languages) to latitude/longitude coordinates.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import googlemaps

from config import get_settings
from utils.logger import get_logger

from .result import ErrorCodes, ToolResult, error_result, success_result

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class GeocodingResult:
    """Result from geocoding a location."""

    latitude: float
    longitude: float
    formatted_address: str
    place_id: str
    location_type: str  # e.g., "ROOFTOP", "APPROXIMATE"

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "formatted_address": self.formatted_address,
            "place_id": self.place_id,
            "location_type": self.location_type,
        }


def _get_gmaps_client() -> googlemaps.Client:
    """Get Google Maps client instance."""
    settings = get_settings()
    if not settings.google_maps_api_key:
        raise ValueError("GOOGLE_MAPS_API_KEY is not configured")
    return googlemaps.Client(key=settings.google_maps_api_key)


async def geocode_location(
    location: str,
    language: str = "ja",
    region: str = "jp",
) -> ToolResult[GeocodingResult]:
    """Geocode a location name to coordinates.

    Supports multi-language input (Japanese, English, Chinese) and returns
    coordinates suitable for distance calculations.

    Args:
        location: Location name (station, city, address, landmark).
        language: Language for results (ja, en, zh-CN). Defaults to Japanese.
        region: Region bias for results. Defaults to Japan.

    Returns:
        ToolResult containing GeocodingResult on success, or error details.
    """
    if not location or not location.strip():
        return error_result(
            "Location cannot be empty",
            error_code=ErrorCodes.INVALID_INPUT,
        )

    location = location.strip()

    # Map language codes to Google's format
    lang_map = {
        "zh-CN": "zh-CN",
        "zh": "zh-CN",
        "ja": "ja",
        "en": "en",
    }
    google_lang = lang_map.get(language, "ja")

    logger.info(
        "[geocode_location] Starting geocoding",
        location=location,
        language=google_lang,
        region=region,
    )

    try:
        client = _get_gmaps_client()

        # Perform geocoding (synchronous call, but wrapped for async interface)
        results = client.geocode(
            address=location,
            language=google_lang,
            region=region,
        )

        if not results:
            logger.warning(
                "[geocode_location] No results found",
                location=location,
            )
            return error_result(
                f"No geocoding results found for: {location}",
                error_code=ErrorCodes.NOT_FOUND,
            )

        # Use the first (most relevant) result
        result = results[0]
        geometry = result.get("geometry", {})
        location_data = geometry.get("location", {})

        geocoding_result = GeocodingResult(
            latitude=location_data.get("lat", 0.0),
            longitude=location_data.get("lng", 0.0),
            formatted_address=result.get("formatted_address", ""),
            place_id=result.get("place_id", ""),
            location_type=geometry.get("location_type", "APPROXIMATE"),
        )

        logger.info(
            "[geocode_location] Geocoding successful",
            location=location,
            lat=geocoding_result.latitude,
            lng=geocoding_result.longitude,
            formatted_address=geocoding_result.formatted_address,
        )

        return success_result(geocoding_result)

    except googlemaps.exceptions.ApiError as e:
        logger.error(
            "[geocode_location] Google Maps API error",
            location=location,
            error=str(e),
            exc_info=True,
        )
        return error_result(
            f"Google Maps API error: {e}",
            error_code=ErrorCodes.EXTERNAL_SERVICE_ERROR,
        )
    except ValueError as e:
        logger.error(
            "[geocode_location] Configuration error",
            error=str(e),
        )
        return error_result(
            str(e),
            error_code=ErrorCodes.CONFIGURATION_ERROR,
        )
    except Exception as e:
        logger.error(
            "[geocode_location] Unexpected error",
            location=location,
            error=str(e),
            exc_info=True,
        )
        return error_result(
            f"Geocoding failed: {e}",
            error_code=ErrorCodes.INTERNAL_ERROR,
        )


async def geocode_location_dict(
    location: str,
    language: str = "ja",
    region: str = "jp",
) -> dict[str, Any]:
    """Geocode a location and return as dictionary (for ADK tool use).

    This is a convenience wrapper that returns a dict suitable for
    direct use as an ADK FunctionTool response.

    Args:
        location: Location name to geocode.
        language: Language for results.
        region: Region bias.

    Returns:
        Dictionary with geocoding results or error information.
    """
    result = await geocode_location(location, language, region)

    if result.success and result.data:
        return {
            "success": True,
            "location": location,
            "coordinates": {
                "latitude": result.data.latitude,
                "longitude": result.data.longitude,
            },
            "formatted_address": result.data.formatted_address,
            "place_id": result.data.place_id,
            "location_type": result.data.location_type,
            "error": None,
        }
    else:
        return {
            "success": False,
            "location": location,
            "coordinates": None,
            "formatted_address": None,
            "place_id": None,
            "location_type": None,
            "error": result.error,
            "error_code": result.error_code,
        }


__all__ = [
    "GeocodingResult",
    "geocode_location",
    "geocode_location_dict",
]
