"""Use case: get Bangumi subject details."""

from __future__ import annotations

from dataclasses import dataclass

from ..ports.bangumi import BangumiGateway


@dataclass(frozen=True, slots=True)
class GetBangumiSubject:
    bangumi: BangumiGateway

    async def __call__(self, subject_id: int) -> dict:
        return await self.bangumi.get_subject(subject_id)
