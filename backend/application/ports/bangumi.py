"""Ports for Bangumi-related data access."""

from __future__ import annotations

from abc import abstractmethod
from typing import Protocol, TypeAlias

RawPayload: TypeAlias = dict[str, object]


class BangumiGateway(Protocol):
    async def search_subject(
        self, *, keyword: str, subject_type: int, max_results: int
    ) -> list[RawPayload]:
        """Search Bangumi subjects and return raw API dicts."""

    async def get_subject(self, subject_id: int) -> RawPayload:
        """Get Bangumi subject details and return raw API dict."""

    @abstractmethod
    async def search_by_title(self, title: str) -> str | None:
        """Search for an anime by title. Returns bangumi_id string or None."""
