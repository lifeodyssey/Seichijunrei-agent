"""Pure-function route optimisation helpers.

All functions are deterministic and make no I/O or LLM calls.

Geometry primitives live in ``backend.agents.geo_utils``.
Export helpers live in ``backend.agents.export``.
"""

from __future__ import annotations

from typing import Literal

from backend.agents.geo_utils import haversine_distance, validate_coordinates
from backend.agents.models import (
    LocationCluster,
    TimedItinerary,
    TimedStop,
    TransitLeg,
)

__all__ = [
    "haversine_distance",
    "validate_coordinates",
    "cluster_by_location",
    "nearest_neighbor_sort",
    "compute_dwell_minutes",
    "build_timed_itinerary",
]


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

    coords: list[tuple[float, float]] = []
    for idx, row in enumerate(rows):
        try:
            lat = float(row["latitude"])  # type: ignore[arg-type]
            lng = float(row["longitude"])  # type: ignore[arg-type]
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError(
                f"Invalid coordinate at row index {idx}: "
                "requires numeric 'latitude' and 'longitude'"
            ) from exc
        coords.append((lat, lng))

    for i in range(n):
        for j in range(i + 1, n):
            if (
                haversine_distance(
                    coords[i][0], coords[i][1], coords[j][0], coords[j][1]
                )
                < threshold_m
            ):
                _union(parent, rank, i, j)

    groups: dict[int, list[int]] = {}
    for i in range(n):
        root = _find(parent, i)
        groups.setdefault(root, []).append(i)

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

    clusters.sort(key=lambda c: c.cluster_id)
    return clusters


# ── Nearest-neighbor sort ───────────────────────────────────────────


def nearest_neighbor_sort(
    clusters: list[LocationCluster],
    origin: tuple[float, float] | None = None,
) -> list[LocationCluster]:
    """Sort *clusters* using greedy nearest-neighbor on cluster centres.

    * If *origin* is given, start from the cluster nearest to it.
    * Otherwise start from the cluster with the alphabetically first ``cluster_id``.
    * Tiebreaker: when two distances are within 0.01 m, pick by ``cluster_id``.
    """
    if len(clusters) <= 1:
        return list(clusters)

    remaining = list(clusters)
    result: list[LocationCluster] = []

    if origin is not None:
        remaining.sort(
            key=lambda c: (
                haversine_distance(origin[0], origin[1], c.center_lat, c.center_lng),
                c.cluster_id,
            )
        )
    else:
        remaining.sort(key=lambda c: c.cluster_id)

    current = remaining.pop(0)
    result.append(current)

    while remaining:
        cur_lat, cur_lng = current.center_lat, current.center_lng
        remaining.sort(
            key=lambda c: (
                round(
                    haversine_distance(cur_lat, cur_lng, c.center_lat, c.center_lng), 2
                ),
                c.cluster_id,
            )
        )
        best = remaining[0]
        best_dist = haversine_distance(
            cur_lat, cur_lng, best.center_lat, best.center_lng
        )
        tied = [
            c
            for c in remaining
            if abs(
                haversine_distance(cur_lat, cur_lng, c.center_lat, c.center_lng)
                - best_dist
            )
            < 0.01
        ]
        if len(tied) > 1:
            tied.sort(key=lambda c: c.cluster_id)
            current = tied[0]
        else:
            current = best
        remaining.remove(current)
        result.append(current)

    return result


# ── Dwell time ──────────────────────────────────────────────────────

_DWELL_MULTIPLIERS: dict[str, float] = {
    "chill": 1.5,
    "normal": 1.0,
    "packed": 0.6,
}


def compute_dwell_minutes(photo_count: int, pacing: str) -> int:
    """Return estimated dwell time in minutes for a location cluster.

    ``base = max(photo_count * 3, 8)``; multiplied by a pacing factor.
    Unknown pacing values fall back to ``"normal"``.
    """
    base = max(photo_count * 3, 8)
    multiplier = _DWELL_MULTIPLIERS.get(pacing, 1.0)
    raw = base * multiplier
    return int(raw + 0.5)


# ── Timed itinerary builder ─────────────────────────────────────────

_TRANSIT_BUFFERS: dict[str, float] = {
    "chill": 1.2,
    "normal": 1.0,
    "packed": 0.8,
}

_WALKING_SPEED_M_PER_MIN = 80.0


def _add_minutes(time_str: str, minutes: int) -> str:
    """Add *minutes* to an ``"HH:MM"`` string and return the new time."""
    h, m = map(int, time_str.split(":"))
    total = h * 60 + m + minutes
    return f"{total // 60:02d}:{total % 60:02d}"


def build_timed_itinerary(
    clusters: list[LocationCluster],
    start_time: str = "09:00",
    pacing: str = "normal",
    origin: tuple[float, float] | None = None,
) -> TimedItinerary:
    """Build a :class:`TimedItinerary` from *clusters*.

    Raises :class:`ValueError` when more than 50 clusters are provided.
    """
    if len(clusters) > 50:
        msg = "Too many locations to route (max 50)"
        raise ValueError(msg)

    _VALID_PACING: dict[str, Literal["chill", "normal", "packed"]] = {
        "chill": "chill",
        "normal": "normal",
        "packed": "packed",
    }
    safe_pacing = _VALID_PACING.get(pacing, "normal")

    if not clusters:
        return TimedItinerary(pacing=safe_pacing, start_time=start_time)

    sorted_clusters = nearest_neighbor_sort(clusters, origin=origin)
    transit_buffer = _TRANSIT_BUFFERS.get(safe_pacing, 1.0)

    stops: list[TimedStop] = []
    legs: list[TransitLeg] = []
    total_distance = 0.0
    current_time = start_time

    for idx, cluster in enumerate(sorted_clusters):
        dwell = compute_dwell_minutes(cluster.photo_count, safe_pacing)
        arrive = current_time
        depart = _add_minutes(arrive, dwell)

        name = cluster.cluster_id
        if cluster.points:
            first_point = cluster.points[0]
            point_name = first_point.get("name")
            if isinstance(point_name, str) and point_name:
                name = point_name

        stops.append(
            TimedStop(
                cluster_id=cluster.cluster_id,
                name=name,
                arrive=arrive,
                depart=depart,
                dwell_minutes=dwell,
                lat=cluster.center_lat,
                lng=cluster.center_lng,
                photo_count=cluster.photo_count,
                points=cluster.points,
            )
        )

        if idx < len(sorted_clusters) - 1:
            next_cluster = sorted_clusters[idx + 1]
            dist = haversine_distance(
                cluster.center_lat,
                cluster.center_lng,
                next_cluster.center_lat,
                next_cluster.center_lng,
            )
            total_distance += dist
            walk_minutes = max(
                1, round(dist / _WALKING_SPEED_M_PER_MIN * transit_buffer)
            )
            legs.append(
                TransitLeg(
                    from_id=cluster.cluster_id,
                    to_id=next_cluster.cluster_id,
                    mode="walk",
                    duration_minutes=walk_minutes,
                    distance_m=round(dist, 1),
                )
            )
            current_time = _add_minutes(depart, walk_minutes)

    first_h, first_m = map(int, stops[0].arrive.split(":"))
    last_h, last_m = map(int, stops[-1].depart.split(":"))
    total_minutes = (last_h * 60 + last_m) - (first_h * 60 + first_m)

    return TimedItinerary(
        stops=stops,
        legs=legs,
        total_minutes=total_minutes,
        total_distance_m=round(total_distance, 1),
        spot_count=len(stops),
        pacing=safe_pacing,
        start_time=start_time,
    )
