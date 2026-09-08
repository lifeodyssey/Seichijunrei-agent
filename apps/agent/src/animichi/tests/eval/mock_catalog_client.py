"""Deterministic in-memory MockCatalogClient for offline agent evals."""

from __future__ import annotations

from typing import Literal

from animichi.agents.geo_utils import haversine_distance
from animichi.agents.models import TimedItinerary, TimedStop, TransitLeg
from animichi.agents.title_matching import best_alias_match
from animichi.clients.catalog_client import (
    AnimeCandidate,
    Itinerary,
    Point,
    ResolveNotFound,
    ResolveResolved,
    SearchResult,
)
from animichi.clients.geocode import GeocodeCandidate, GeocodeKind, GeocodeSource
from animichi.tests.eval.mock_catalog_fixtures import (
    FIXTURE_POINTS,
    LOCATION_CENTERS,
    TITLE_ALIASES,
    TITLE_NAMES,
)
from animichi.tests.eval.mock_geocode_fixtures import GEOCODE_FIXTURES

__all__ = [
    "FIXTURE_POINTS",
    "LOCATION_CENTERS",
    "MockCatalogClient",
    "TITLE_ALIASES",
    "TITLE_NAMES",
    "_LOCATION_CENTERS",
    "_TITLE_ALIASES",
]

_TITLE_ALIASES = TITLE_ALIASES
_LOCATION_CENTERS = LOCATION_CENTERS
_POINT_INDEX: dict[str, Point] = {
    point.id: point for points in FIXTURE_POINTS.values() for point in points
}


class MockCatalogClient:
    """In-memory stand-in for :class:`CatalogClient` with fixture data."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[object, ...]]] = []

    async def resolve(self, query: str) -> ResolveResolved | ResolveNotFound:
        self.calls.append(("resolve", (query,)))
        bangumi_id = self._match_title(query)
        if bangumi_id is None:
            return ResolveNotFound(outcome="not_found", reason="anime_not_found")
        names = TITLE_NAMES[bangumi_id]
        return ResolveResolved(
            outcome="resolved",
            match=AnimeCandidate(
                bangumi_id=bangumi_id,
                title=names.ja,
                title_cn=names.zh,
                points_count=len(FIXTURE_POINTS.get(bangumi_id, [])),
            ),
        )

    async def points_by_bangumi_id(self, bangumi_id: str) -> SearchResult:
        self.calls.append(("points_by_bangumi_id", (bangumi_id,)))
        rows = [
            point.model_copy(deep=True) for point in FIXTURE_POINTS.get(bangumi_id, [])
        ]
        return SearchResult(rows=rows, synced_at="fixture")

    async def nearby(
        self, lat: float, lng: float, *, radius_m: int = 2000
    ) -> list[Point]:
        self.calls.append(("nearby", (lat, lng, radius_m)))
        scored = self._within_radius(lat, lng, radius_m)
        return [point for _, point in sorted(scored, key=lambda item: item[0])]

    async def geocode(self, query: str, *, limit: int = 5) -> list[GeocodeCandidate]:
        self.calls.append(("geocode", (query, limit)))
        return [candidate.model_copy() for candidate in _geocode_fixture(query)[:limit]]

    async def plan_itinerary(
        self,
        point_ids: list[str],
        *,
        origin: tuple[float, float] | None = None,
        pacing: Literal["chill", "normal", "packed"] | None = None,
    ) -> Itinerary:
        self.calls.append(("plan_itinerary", (tuple(point_ids), origin, pacing)))
        ordered = [
            _POINT_INDEX[pid].model_copy(deep=True)
            for pid in point_ids
            if pid in _POINT_INDEX
        ]
        return _build_route(ordered)

    async def near_location(self, name: str) -> list[Point]:
        center = self._match_location(name)
        if center is None:
            return []
        lat, lng, _ = center
        scored = self._within_radius(lat, lng, radius_m=5000)
        return [point for _, point in sorted(scored, key=lambda item: item[0])]

    @staticmethod
    def _match_title(query: str) -> str | None:
        return best_alias_match(query, _TITLE_ALIASES)

    @staticmethod
    def _match_location(name: str) -> tuple[float, float, str] | None:
        q = name.lower()
        for alias, center in _LOCATION_CENTERS.items():
            if alias in q:
                return center
        return None

    @staticmethod
    def _within_radius(
        lat: float, lng: float, radius_m: int
    ) -> list[tuple[float, Point]]:
        scored: list[tuple[float, Point]] = []
        for point in _POINT_INDEX.values():
            dist = haversine_distance(lat, lng, point.latitude, point.longitude)
            if dist <= radius_m:
                clone = point.model_copy(deep=True)
                clone.distance_m = round(dist, 1)
                scored.append((dist, clone))
        return scored


def _build_route(ordered: list[Point]) -> Itinerary:
    if not ordered:
        return Itinerary()
    return Itinerary(
        ordered_points=ordered,
        point_count=len(ordered),
        cover_url=ordered[0].cover_url,
        anime_title=ordered[0].title,
        anime_title_cn=ordered[0].title_cn,
        timed_itinerary=_build_itinerary(ordered),
    )


def _candidate(
    id_: str,
    label: str,
    name: str,
    lat: float,
    lng: float,
    kind: GeocodeKind,
) -> GeocodeCandidate:
    return GeocodeCandidate(
        id=id_,
        label=label,
        name=name,
        lat=lat,
        lng=lng,
        kind=kind,
        source=GeocodeSource.SEED,
    )


def _geocode_fixture(query: str) -> list[GeocodeCandidate]:
    return [
        _candidate(seed.id, seed.label, seed.name, seed.lat, seed.lng, seed.kind)
        for seed in GEOCODE_FIXTURES.get(query.lower(), ())
    ]


def _build_itinerary(ordered: list[Point]) -> TimedItinerary:
    stops = [_stop(point, index) for index, point in enumerate(ordered)]
    legs = [_leg(ordered[i], ordered[i + 1]) for i in range(len(ordered) - 1)]
    return TimedItinerary(
        stops=stops,
        legs=legs,
        total_minutes=sum(leg.duration_minutes for leg in legs) + 30 * len(stops),
        total_distance_m=round(sum(leg.distance_m for leg in legs), 1),
        spot_count=len(stops),
    )


def _stop(point: Point, index: int) -> TimedStop:
    arrive_hour = 9 + index
    return TimedStop(
        cluster_id=point.id,
        name=point.name,
        arrive=f"{arrive_hour:02d}:00",
        depart=f"{arrive_hour:02d}:30",
        dwell_minutes=30,
        lat=point.latitude,
        lng=point.longitude,
        photo_count=1,
    )


def _leg(src: Point, dst: Point) -> TransitLeg:
    distance = haversine_distance(
        src.latitude, src.longitude, dst.latitude, dst.longitude
    )
    return TransitLeg(
        from_id=src.id,
        to_id=dst.id,
        mode="walk",
        duration_minutes=max(1, round(distance / 80)),
        distance_m=round(distance, 1),
    )
