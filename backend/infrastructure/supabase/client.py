"""Async Supabase client — thin facade over domain repositories.

Usage:
    async with SupabaseClient(dsn="postgresql://...") as db:
        bangumi_id = await db.bangumi.find_bangumi_by_title("Eupho")
"""

from __future__ import annotations

import importlib
from typing import cast

import structlog

from backend.infrastructure.supabase.client_types import AsyncPGModule, AsyncPGPool, Row
from backend.infrastructure.supabase.repositories.bangumi import BangumiRepository
from backend.infrastructure.supabase.repositories.feedback import FeedbackRepository
from backend.infrastructure.supabase.repositories.messages import MessagesRepository
from backend.infrastructure.supabase.repositories.points import PointsRepository
from backend.infrastructure.supabase.repositories.routes import RoutesRepository
from backend.infrastructure.supabase.repositories.session import SessionRepository
from backend.infrastructure.supabase.repositories.user_memory import (
    UserMemoryRepository,
)

logger = structlog.get_logger(__name__)
asyncpg = cast(AsyncPGModule, importlib.import_module("asyncpg"))

__all__ = ["Row", "SupabaseClient"]


class SupabaseClient:
    """Async PostgreSQL client delegating to domain repository instances.

    Access repositories via explicit typed properties:
    ``db.bangumi``, ``db.points``, ``db.session``, ``db.feedback``,
    ``db.routes``, ``db.messages``, ``db.user_memory``.
    """

    def __init__(
        self, dsn: str, *, min_pool_size: int = 2, max_pool_size: int = 10
    ) -> None:
        self._dsn = dsn
        self._min_pool_size = min_pool_size
        self._max_pool_size = max_pool_size
        self._pool: AsyncPGPool | None = None
        self._bangumi: BangumiRepository | None = None
        self._points: PointsRepository | None = None
        self._session: SessionRepository | None = None
        self._feedback: FeedbackRepository | None = None
        self._user_memory: UserMemoryRepository | None = None
        self._routes: RoutesRepository | None = None
        self._messages: MessagesRepository | None = None

    async def connect(self) -> None:
        """Create the connection pool and initialise repositories."""
        if self._pool is not None:
            return
        self._pool = await asyncpg.create_pool(
            self._dsn, min_size=self._min_pool_size, max_size=self._max_pool_size
        )
        self._init_repos(self._pool)
        logger.info("supabase_connected", pool_size=self._max_pool_size)

    async def close(self) -> None:
        """Close the connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
            logger.info("supabase_disconnected")

    async def __aenter__(self) -> SupabaseClient:
        await self.connect()
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    @property
    def pool(self) -> AsyncPGPool:
        """Get the connection pool (raises if not connected)."""
        if self._pool is None:
            raise RuntimeError("SupabaseClient not connected. Call connect() first.")
        return self._pool

    # --- Repository access ---

    def _init_repos(self, pool: AsyncPGPool) -> None:
        self._bangumi = BangumiRepository(pool)
        self._points = PointsRepository(pool)
        self._session = SessionRepository(pool)
        self._feedback = FeedbackRepository(pool)
        self._user_memory = UserMemoryRepository(pool)
        self._routes = RoutesRepository(pool)
        self._messages = MessagesRepository(pool)

    @property
    def bangumi(self) -> BangumiRepository:
        if self._bangumi is None:
            raise RuntimeError(
                "BangumiRepository not initialized — call connect() first"
            )
        return self._bangumi

    @property
    def points(self) -> PointsRepository:
        if self._points is None:
            raise RuntimeError(
                "PointsRepository not initialized — call connect() first"
            )
        return self._points

    @property
    def session(self) -> SessionRepository:
        if self._session is None:
            raise RuntimeError(
                "SessionRepository not initialized — call connect() first"
            )
        return self._session

    @property
    def feedback(self) -> FeedbackRepository:
        if self._feedback is None:
            raise RuntimeError(
                "FeedbackRepository not initialized — call connect() first"
            )
        return self._feedback

    @property
    def user_memory(self) -> UserMemoryRepository:
        if self._user_memory is None:
            raise RuntimeError(
                "UserMemoryRepository not initialized — call connect() first"
            )
        return self._user_memory

    @property
    def routes(self) -> RoutesRepository:
        if self._routes is None:
            raise RuntimeError(
                "RoutesRepository not initialized — call connect() first"
            )
        return self._routes

    @property
    def messages(self) -> MessagesRepository:
        if self._messages is None:
            raise RuntimeError(
                "MessagesRepository not initialized — call connect() first"
            )
        return self._messages
