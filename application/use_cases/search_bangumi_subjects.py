"""Use case: search Bangumi subjects for a keyword."""

from __future__ import annotations

from dataclasses import dataclass

from ..ports.bangumi import BangumiGateway


@dataclass(frozen=True, slots=True)
class SearchBangumiSubjects:
    bangumi: BangumiGateway

    async def __call__(
        self, *, keyword: str, subject_type: int = 2, max_results: int = 10
    ) -> list[dict]:
        return await self.bangumi.search_subject(
            keyword=keyword,
            subject_type=subject_type,
            max_results=max_results,
        )
