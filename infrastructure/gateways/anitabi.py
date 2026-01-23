"""Infrastructure adapter for the Anitabi gateway port."""

from __future__ import annotations

from application.errors import ExternalServiceError
from application.ports import AnitabiGateway
from clients.anitabi import AnitabiClient
from clients.errors import APIError
from domain.entities import Bangumi, Point, Station


class AnitabiClientGateway(AnitabiGateway):
    def __init__(self, *, client: AnitabiClient | None = None) -> None:
        self._client = client

    async def get_bangumi_points(self, bangumi_id: str) -> list[Point]:
        try:
            if self._client is not None:
                return await self._client.get_bangumi_points(bangumi_id)

            async with AnitabiClient() as client:
                return await client.get_bangumi_points(bangumi_id)
        except APIError as exc:
            raise ExternalServiceError("anitabi", str(exc)) from exc

    async def get_station_info(self, station_name: str) -> Station:
        try:
            if self._client is not None:
                return await self._client.get_station_info(station_name)

            async with AnitabiClient() as client:
                return await client.get_station_info(station_name)
        except APIError as exc:
            raise ExternalServiceError("anitabi", str(exc)) from exc

    async def search_bangumi(
        self, *, station: Station, radius_km: float
    ) -> list[Bangumi]:
        try:
            if self._client is not None:
                return await self._client.search_bangumi(
                    station=station, radius_km=radius_km
                )

            async with AnitabiClient() as client:
                return await client.search_bangumi(station=station, radius_km=radius_km)
        except APIError as exc:
            raise ExternalServiceError("anitabi", str(exc)) from exc
