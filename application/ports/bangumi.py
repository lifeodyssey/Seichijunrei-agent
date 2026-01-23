"""Ports for Bangumi-related data access."""

from __future__ import annotations

from typing import Protocol


class BangumiGateway(Protocol):
    async def search_subject(
        self, *, keyword: str, subject_type: int, max_results: int
    ) -> list[dict]:
        """Search Bangumi subjects and return raw API dicts."""

    async def get_subject(self, subject_id: int) -> dict:
        """Get Bangumi subject details and return raw API dict."""
