"""Use case: search Anitabi bangumi near a station."""

from __future__ import annotations

from dataclasses import dataclass

from domain.entities import Bangumi, Station

from ..ports.anitabi import AnitabiGateway


@dataclass(frozen=True, slots=True)
class SearchAnitabiBangumiNearStation:
    anitabi: AnitabiGateway

    async def __call__(
        self, *, station_name: str, radius_km: float = 5.0
    ) -> tuple[Station, list[Bangumi]]:
        station = await self.anitabi.get_station_info(station_name)
        bangumi_list = await self.anitabi.search_bangumi(
            station=station, radius_km=radius_km
        )
        return station, bangumi_list
