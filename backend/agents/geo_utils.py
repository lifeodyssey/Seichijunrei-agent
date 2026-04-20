"""Pure geometric helpers — haversine distance and coordinate validation.

No I/O, no LLM calls. All functions are deterministic.
"""

from __future__ import annotations

import math

_EARTH_RADIUS_M = 6_371_000


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in **meters** between two WGS-84 points."""
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


def validate_coordinates(
    rows: list[dict[str, object]],
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Split *rows* into (valid, invalid) based on lat/lng sanity checks.

    A row is **invalid** when any of the following is true:
    * ``latitude`` or ``longitude`` key is missing
    * Either value is not numeric (``int`` or ``float``)
    * Both lat and lng are exactly 0 (null-island sentinel)
    * lat is outside [-90, 90] or lng is outside [-180, 180]
    """
    valid: list[dict[str, object]] = []
    invalid: list[dict[str, object]] = []

    for row in rows:
        lat_raw = row.get("latitude")
        lng_raw = row.get("longitude")

        # Must be present, numeric, and not bool (bool is a subclass of int)
        if (
            isinstance(lat_raw, bool)
            or isinstance(lng_raw, bool)
            or not isinstance(lat_raw, (int, float))
            or not isinstance(lng_raw, (int, float))
        ):
            invalid.append(row)
            continue

        lat = float(lat_raw)
        lng = float(lng_raw)

        if lat == 0.0 and lng == 0.0:
            invalid.append(row)
            continue

        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            invalid.append(row)
            continue

        valid.append(row)

    return valid, invalid
