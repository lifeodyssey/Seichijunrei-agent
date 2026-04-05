"""Unit tests for route_optimizer — haversine, validation, clustering, sorting, itinerary."""

from __future__ import annotations

import pytest

from backend.agents.models import LocationCluster
from backend.agents.route_optimizer import (
    build_timed_itinerary,
    cluster_by_location,
    compute_dwell_minutes,
    haversine_distance,
    nearest_neighbor_sort,
    validate_coordinates,
)

# ── Haversine tests ──────────────────────────────────────────────────


def test_haversine_tokyo_osaka() -> None:
    """Tokyo (35.6762, 139.6503) to Osaka (34.6937, 135.5023) ≈ 396km."""
    d = haversine_distance(35.6762, 139.6503, 34.6937, 135.5023)
    assert 390_000 < d < 405_000


def test_haversine_same_point() -> None:
    d = haversine_distance(35.0, 139.0, 35.0, 139.0)
    assert d == 0.0


def test_haversine_antipodal() -> None:
    """North pole to south pole ≈ half the earth's circumference."""
    d = haversine_distance(90.0, 0.0, -90.0, 0.0)
    assert 19_900_000 < d < 20_100_000


def test_haversine_short_distance() -> None:
    """Two points ~111m apart (0.001° lat at equator)."""
    d = haversine_distance(0.0, 0.0, 0.001, 0.0)
    assert 100 < d < 120


# ── Validation tests ─────────────────────────────────────────────────


def test_validate_rejects_null_island() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "latitude": 0.0, "longitude": 0.0}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 0
    assert len(invalid) == 1


def test_validate_keeps_valid() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "latitude": 35.0, "longitude": 139.0}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 1
    assert len(invalid) == 0


def test_validate_rejects_missing_lat() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "longitude": 139.0}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 0
    assert len(invalid) == 1


def test_validate_rejects_missing_lng() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "latitude": 35.0}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 0
    assert len(invalid) == 1


def test_validate_rejects_out_of_range_lat() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "latitude": 100.0, "longitude": 139.0}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 0
    assert len(invalid) == 1


def test_validate_rejects_out_of_range_lng() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "latitude": 35.0, "longitude": 200.0}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 0
    assert len(invalid) == 1


def test_validate_rejects_non_numeric() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "latitude": "bad", "longitude": 139.0}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 0
    assert len(invalid) == 1


def test_validate_accepts_int_coords() -> None:
    rows: list[dict[str, object]] = [{"id": "a", "latitude": 35, "longitude": 139}]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 1
    assert len(invalid) == 0


def test_validate_empty_input() -> None:
    valid, invalid = validate_coordinates([])
    assert valid == []
    assert invalid == []


def test_validate_mixed_rows() -> None:
    rows: list[dict[str, object]] = [
        {"id": "good", "latitude": 35.0, "longitude": 139.0},
        {"id": "bad", "latitude": 0.0, "longitude": 0.0},
        {"id": "missing", "longitude": 139.0},
    ]
    valid, invalid = validate_coordinates(rows)
    assert len(valid) == 1
    assert len(invalid) == 2


# ── Clustering tests ─────────────────────────────────────────────────


def test_cluster_groups_nearby() -> None:
    """5 points all within 30m of each other → 1 cluster."""
    rows: list[dict[str, object]] = [
        {
            "id": f"p{i}",
            "latitude": 34.890 + i * 0.0001,
            "longitude": 135.800,
            "name": f"spot{i}",
        }
        for i in range(5)
    ]
    clusters = cluster_by_location(rows, threshold_m=50.0)
    assert len(clusters) == 1
    assert clusters[0].photo_count == 5


def test_cluster_separates_distant() -> None:
    rows: list[dict[str, object]] = [
        {"id": "a", "latitude": 34.890, "longitude": 135.800, "name": "spot_a"},
        {"id": "b", "latitude": 35.890, "longitude": 136.800, "name": "spot_b"},
    ]
    clusters = cluster_by_location(rows, threshold_m=50.0)
    assert len(clusters) == 2


def test_cluster_empty_input() -> None:
    assert cluster_by_location([]) == []


def test_cluster_single_point() -> None:
    rows: list[dict[str, object]] = [
        {"id": "a", "latitude": 34.890, "longitude": 135.800, "name": "spot_a"},
    ]
    clusters = cluster_by_location(rows)
    assert len(clusters) == 1
    assert clusters[0].photo_count == 1


def test_cluster_id_is_alphabetically_first() -> None:
    """cluster_id should be the alphabetically first point ID in the cluster."""
    rows: list[dict[str, object]] = [
        {"id": "charlie", "latitude": 34.890, "longitude": 135.800, "name": "c"},
        {"id": "alpha", "latitude": 34.8901, "longitude": 135.800, "name": "a"},
        {"id": "bravo", "latitude": 34.8902, "longitude": 135.800, "name": "b"},
    ]
    clusters = cluster_by_location(rows, threshold_m=50.0)
    assert len(clusters) == 1
    assert clusters[0].cluster_id == "alpha"


def test_cluster_center_is_average() -> None:
    rows: list[dict[str, object]] = [
        {"id": "a", "latitude": 34.0, "longitude": 136.0, "name": "a"},
        {"id": "b", "latitude": 34.0, "longitude": 136.0, "name": "b"},
    ]
    clusters = cluster_by_location(rows, threshold_m=50.0)
    assert len(clusters) == 1
    assert clusters[0].center_lat == 34.0
    assert clusters[0].center_lng == 136.0


def test_cluster_contains_all_points() -> None:
    rows: list[dict[str, object]] = [
        {"id": "a", "latitude": 34.890, "longitude": 135.800, "name": "spot_a"},
        {"id": "b", "latitude": 34.8901, "longitude": 135.800, "name": "spot_b"},
    ]
    clusters = cluster_by_location(rows, threshold_m=50.0)
    assert len(clusters) == 1
    assert len(clusters[0].points) == 2


# ── Nearest-neighbor sort tests ─────────────────────────────────────


def test_nearest_neighbor_reduces_backtracking() -> None:
    # 3 clusters in a line: A(0), B(100m away), C(50m from A)
    # Naive order: A,B,C backtracks. NN from A: A→C→B
    clusters = [
        LocationCluster(center_lat=34.890, center_lng=135.800, cluster_id="a", photo_count=1),
        LocationCluster(center_lat=34.891, center_lng=135.800, cluster_id="b", photo_count=1),
        LocationCluster(center_lat=34.8905, center_lng=135.800, cluster_id="c", photo_count=1),
    ]
    result = nearest_neighbor_sort(clusters)
    ids = [c.cluster_id for c in result]
    assert ids == ["a", "c", "b"]  # nearest-neighbor avoids backtrack


def test_nearest_neighbor_with_origin() -> None:
    clusters = [
        LocationCluster(center_lat=34.890, center_lng=135.800, cluster_id="a", photo_count=1),
        LocationCluster(center_lat=34.900, center_lng=135.800, cluster_id="b", photo_count=1),
    ]
    # Origin near b
    result = nearest_neighbor_sort(clusters, origin=(34.899, 135.800))
    assert result[0].cluster_id == "b"


def test_nearest_neighbor_empty() -> None:
    assert nearest_neighbor_sort([]) == []


def test_nearest_neighbor_deterministic() -> None:
    clusters = [
        LocationCluster(center_lat=34.890, center_lng=135.800, cluster_id="x", photo_count=1),
        LocationCluster(center_lat=34.891, center_lng=135.801, cluster_id="y", photo_count=1),
    ]
    results = [tuple(c.cluster_id for c in nearest_neighbor_sort(clusters)) for _ in range(10)]
    assert len(set(results)) == 1  # always same order


# ── Dwell time tests ────────────────────────────────────────────────


def test_dwell_chill_5photos() -> None:
    assert compute_dwell_minutes(5, "chill") == 23  # round(15 * 1.5)


def test_dwell_normal_5photos() -> None:
    assert compute_dwell_minutes(5, "normal") == 15  # round(15 * 1.0)


def test_dwell_packed_5photos() -> None:
    assert compute_dwell_minutes(5, "packed") == 9  # round(15 * 0.6)


def test_dwell_zero_photos() -> None:
    assert compute_dwell_minutes(0, "normal") == 8  # default base


# ── Timed itinerary tests ──────────────────────────────────────────


def test_itinerary_monotonic_times() -> None:
    clusters = [
        LocationCluster(center_lat=34.890, center_lng=135.800, cluster_id="a", photo_count=3, points=[{"id": "1"}, {"id": "2"}, {"id": "3"}]),
        LocationCluster(center_lat=34.891, center_lng=135.801, cluster_id="b", photo_count=2, points=[{"id": "4"}, {"id": "5"}]),
        LocationCluster(center_lat=34.892, center_lng=135.802, cluster_id="c", photo_count=1, points=[{"id": "6"}]),
    ]
    itinerary = build_timed_itinerary(clusters, start_time="09:00", pacing="normal")
    for i in range(1, len(itinerary.stops)):
        assert itinerary.stops[i].arrive >= itinerary.stops[i - 1].depart


def test_itinerary_exceeds_50_clusters() -> None:
    clusters = [LocationCluster(center_lat=34.0 + i * 0.01, center_lng=135.0, cluster_id=f"c{i}", photo_count=1) for i in range(51)]
    with pytest.raises(ValueError, match="Too many"):
        build_timed_itinerary(clusters)


def test_itinerary_single_cluster() -> None:
    clusters = [LocationCluster(center_lat=34.890, center_lng=135.800, cluster_id="a", photo_count=2, points=[{"id": "1"}, {"id": "2"}])]
    itinerary = build_timed_itinerary(clusters, start_time="10:00", pacing="normal")
    assert len(itinerary.stops) == 1
    assert len(itinerary.legs) == 0
    assert itinerary.stops[0].arrive == "10:00"
