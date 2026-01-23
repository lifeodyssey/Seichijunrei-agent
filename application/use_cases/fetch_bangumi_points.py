"""Use case: fetch all Anitabi points for a bangumi."""

from __future__ import annotations

from dataclasses import dataclass

from domain.entities import Point

from ..ports.anitabi import AnitabiGateway


@dataclass(frozen=True, slots=True)
class FetchBangumiPoints:
    anitabi: AnitabiGateway

    async def __call__(self, bangumi_id: str) -> list[Point]:
        return await self.anitabi.get_bangumi_points(bangumi_id)
