"""Unit tests for route_optimizer — haversine, validation, clustering."""

from __future__ import annotations

from backend.agents.route_optimizer import (
    cluster_by_location,
    haversine_distance,
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
