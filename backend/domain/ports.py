"""Domain port protocols for infrastructure dependencies.

These protocols define the interface that the agent/handler layer requires
from the database. The concrete ``SupabaseClient`` satisfies these protocols
structurally (PEP 544) — no inheritance needed.

Only methods actually *used* by the agent layer are declared here.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable


class BangumiRepo(Protocol):
    """Bangumi-related DB operations used by handlers."""

    async def find_bangumi_by_title(self, title: str) -> str | None: ...

    async def find_all_by_title(self, title: str) -> list[dict[str, object]]: ...

    async def upsert_bangumi_title(self, title: str, bangumi_id: str) -> None: ...

    async def upsert_bangumi(
        self,
        bangumi_id: str,
        *,
        title: str | None = None,
        cover_url: str | None = None,
        points_count: int | None = None,
    ) -> None: ...

    async def find_candidate_details_by_titles(
        self, titles: list[str]
    ) -> list[dict[str, object]]: ...


class PointsRepo(Protocol):
    """Pilgrimage point DB operations used by handlers."""

    async def search_points_by_location(
        self,
        latitude: float,
        longitude: float,
        radius_m: int,
        *,
        limit: int = 50,
    ) -> list[dict[str, object]]: ...

    async def get_points_by_ids(
        self, point_ids: list[str]
    ) -> list[dict[str, object]]: ...

    async def upsert_points_batch(self, rows: list[dict[str, object]]) -> None: ...


@runtime_checkable
class DatabasePort(Protocol):
    """Structural protocol for the DB dependency used by the agent layer.

    The concrete ``SupabaseClient`` satisfies this protocol automatically.
    Test doubles only need to implement the repositories they test against.
    """

    @property
    def bangumi(self) -> BangumiRepo: ...

    @property
    def points(self) -> PointsRepo: ...
