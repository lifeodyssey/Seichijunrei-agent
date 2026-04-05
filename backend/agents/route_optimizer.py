"""Pure-function route optimisation helpers.

All functions are deterministic and make no I/O or LLM calls.
"""

from __future__ import annotations

import math

from backend.agents.models import LocationCluster

# ── Haversine ────────────────────────────────────────────────────────

_EARTH_RADIUS_M = 6_371_000


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in **meters** between two WGS-84 points."""
    rlat1, rlon1, rlat2, rlon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = rlat2 - rlat1
    dlon = rlon2 - rlon1
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlon / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(a))


# ── Coordinate validation ────────────────────────────────────────────


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

        # Must be present and numeric
        if not isinstance(lat_raw, (int, float)) or not isinstance(lng_raw, (int, float)):
            invalid.append(row)
            continue

        lat = float(lat_raw)
        lng = float(lng_raw)

        # Null-island check
        if lat == 0.0 and lng == 0.0:
            invalid.append(row)
            continue

        # Range check
        if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
            invalid.append(row)
            continue

        valid.append(row)

    return valid, invalid


# ── Location clustering (union-find) ─────────────────────────────────


def _find(parent: dict[int, int], i: int) -> int:
    while parent[i] != i:
        parent[i] = parent[parent[i]]  # path compression
        i = parent[i]
    return i


def _union(parent: dict[int, int], rank: dict[int, int], a: int, b: int) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra == rb:
        return
    if rank[ra] < rank[rb]:
        ra, rb = rb, ra
    parent[rb] = ra
    if rank[ra] == rank[rb]:
        rank[ra] += 1


def cluster_by_location(
    rows: list[dict[str, object]],
    threshold_m: float = 50.0,
) -> list[LocationCluster]:
    """Group *rows* into :class:`LocationCluster` using union-find.

    Two points within *threshold_m* meters of each other belong to the same
    cluster.  ``cluster_id`` is the alphabetically-first point ``id`` in the
    group; ``center_lat`` / ``center_lng`` are the arithmetic mean of all
    points' coordinates.
    """
    if not rows:
        return []

    n = len(rows)
    parent: dict[int, int] = {i: i for i in range(n)}
    rank: dict[int, int] = dict.fromkeys(range(n), 0)

    # Pre-extract coordinates for speed
    coords: list[tuple[float, float]] = []
    for row in rows:
        coords.append((float(row["latitude"]), float(row["longitude"])))  # type: ignore[arg-type]

    # Build unions
    for i in range(n):
        for j in range(i + 1, n):
            if haversine_distance(coords[i][0], coords[i][1], coords[j][0], coords[j][1]) < threshold_m:
                _union(parent, rank, i, j)

    # Group indices by root
    groups: dict[int, list[int]] = {}
    for i in range(n):
        root = _find(parent, i)
        groups.setdefault(root, []).append(i)

    # Build clusters
    clusters: list[LocationCluster] = []
    for indices in groups.values():
        points = [rows[i] for i in indices]
        lats = [coords[i][0] for i in indices]
        lngs = [coords[i][1] for i in indices]
        ids = sorted(str(rows[i].get("id", "")) for i in indices)
        clusters.append(
            LocationCluster(
                center_lat=sum(lats) / len(lats),
                center_lng=sum(lngs) / len(lngs),
                points=points,
                photo_count=len(points),
                cluster_id=ids[0],
            )
        )

    # Deterministic output order: sort by cluster_id
    clusters.sort(key=lambda c: c.cluster_id)
    return clusters
