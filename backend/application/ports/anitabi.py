"""Ports for Anitabi-related data access."""

from __future__ import annotations

from typing import Protocol

from backend.domain.entities import Point, Station


class AnitabiGateway(Protocol):
    async def get_bangumi_points(self, bangumi_id: str) -> list[Point]:
        """Return all pilgrimage points for a Bangumi id."""

    async def get_bangumi_lite(self, bangumi_id: str) -> dict[str, object]:
        """Return lightweight bangumi info (title, cn, city, cover)."""

    async def get_station_info(self, station_name: str) -> Station:
        """Resolve a station name to station info."""
