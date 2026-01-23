"""Ports for Anitabi-related data access."""

from __future__ import annotations

from typing import Protocol

from domain.entities import Bangumi, Point, Station


class AnitabiGateway(Protocol):
    async def get_bangumi_points(self, bangumi_id: str) -> list[Point]:
        """Return all pilgrimage points for a Bangumi id."""

    async def get_station_info(self, station_name: str) -> Station:
        """Resolve a station name to station info."""

    async def search_bangumi(
        self, *, station: Station, radius_km: float
    ) -> list[Bangumi]:
        """Search Anitabi for bangumi near a station."""
