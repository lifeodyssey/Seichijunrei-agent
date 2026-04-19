"""Shared helpers for executor handlers."""

from __future__ import annotations

from dataclasses import dataclass

from backend.agents.retriever import RetrievalResult
from backend.agents.route_export import build_google_maps_url, build_ics_calendar
from backend.agents.route_optimizer import (
    build_timed_itinerary,
    cluster_by_location,
    validate_coordinates,
)


@dataclass(frozen=True)
class RoutePlanParams:
    """Typed parameters for route optimization, replacing raw dict extraction."""

    origin: str | None
    pacing: str  # "normal" | "chill" | "packed"
    start_time: str

    @classmethod
    def from_raw(cls, params: dict[str, object], origin: str | None) -> RoutePlanParams:
        pacing_raw = params.get("pacing")
        pacing = (
            pacing_raw
            if isinstance(pacing_raw, str)
            and pacing_raw in ("chill", "normal", "packed")
            else "normal"
        )
        start_raw = params.get("start_time")
        start_time = start_raw if isinstance(start_raw, str) else "09:00"
        return cls(origin=origin, pacing=pacing, start_time=start_time)


def rewrite_image_urls(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Rewrite Anitabi image URLs to go through our CF proxy."""
    for row in rows:
        url = row.get("screenshot_url")
        if not isinstance(url, str) or not url:
            continue
        if "image.anitabi.cn/" in url:
            row["screenshot_url"] = url.replace("https://image.anitabi.cn/", "/img/")
        elif url.startswith("screenshot/"):
            row["screenshot_url"] = f"/img/{url}"
    return rows


def build_query_payload(retrieval: RetrievalResult) -> dict[str, object]:
    """Build a query result payload from a RetrievalResult."""
    metadata = dict(retrieval.metadata)
    empty = retrieval.row_count == 0
    rows = rewrite_image_urls(retrieval.rows)
    return {
        "rows": rows,
        "items": rows,
        "row_count": retrieval.row_count,
        "strategy": retrieval.strategy.value,
        "metadata": metadata,
        "status": "empty" if empty else "ok",
        "empty": empty,
        "summary": {
            "count": retrieval.row_count,
            "source": metadata.get("data_origin", metadata.get("source", "db")),
            "cache": metadata.get("cache", "miss"),
        },
    }


def _parse_coordinate_origin(origin: str | None) -> tuple[float, float] | None:
    """Parse a coordinate origin encoded as "lat,lng"."""
    if origin is None:
        return None

    parts = [part.strip() for part in origin.split(",")]
    if len(parts) != 2:
        return None

    try:
        lat = float(parts[0])
        lng = float(parts[1])
    except ValueError:
        return None

    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lng <= 180.0):
        return None

    return lat, lng


def optimize_route(
    rows: list[dict[str, object]],
    params: dict[str, object],
    origin: str | None,
    tool_name: str = "plan_route",
) -> dict[str, object]:
    """Shared route optimization logic for plan_route and plan_selected."""
    # 1. Validate coordinates
    valid_rows, _invalid = validate_coordinates(rows)
    if not valid_rows:
        return {"tool": tool_name, "success": False, "error": "No valid coordinates"}

    # 2. Cluster by location
    clusters = cluster_by_location(valid_rows, threshold_m=50.0)

    # 3. Extract typed route params
    rp = RoutePlanParams.from_raw(params, origin)
    pacing = rp.pacing
    start_time = rp.start_time

    route_origin = _parse_coordinate_origin(rp.origin)

    # 4. Build timed itinerary (includes nearest-neighbor sort internally)
    try:
        itinerary = build_timed_itinerary(
            clusters,
            start_time=start_time,
            pacing=pacing,
            origin=route_origin,
        )
    except ValueError as e:
        return {"tool": tool_name, "success": False, "error": str(e)}

    # 5. Build exports
    gmaps_url = build_google_maps_url(itinerary.stops)
    ics = build_ics_calendar(itinerary)
    itinerary.export_google_maps_url = gmaps_url
    itinerary.export_ics = ics

    # 6. Build backward-compat ordered_points (flat list from all cluster points)
    ordered_points: list[dict[str, object]] = []
    for stop in itinerary.stops:
        ordered_points.extend(stop.points)
    rewrite_image_urls(ordered_points)

    with_coords = [r for r in rows if r.get("latitude") and r.get("longitude")]

    return {
        "tool": tool_name,
        "success": True,
        "data": {
            "ordered_points": ordered_points,
            "timed_itinerary": itinerary.model_dump(mode="json"),
            "point_count": len(ordered_points),
            "status": "ok",
            "summary": {
                "point_count": len(ordered_points),
                "with_coordinates": len(with_coords),
                "without_coordinates": len(rows) - len(with_coords),
                "clusters": len(clusters),
                "total_minutes": itinerary.total_minutes,
                "total_distance_m": itinerary.total_distance_m,
            },
        },
    }
