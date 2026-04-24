"""Retriever abstraction for executor-facing data access.

Strategy dispatch and caching facade:

- sql: structured SQL retrieval
- geo: direct PostGIS proximity search
- hybrid: combine SQL-constrained rows with geo proximity results
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import cast

import structlog

from backend.agents.models import RetrievalRequest
from backend.agents.retrievers.enrichment import (
    write_through_bangumi_points,  # noqa: F401
)
from backend.agents.retrievers.geo import fetch_geo_rows, get_area_suggestions
from backend.agents.retrievers.hybrid import merge_rows_preserving_order
from backend.agents.retrievers.sql import execute_sql_with_fallback
from backend.agents.sql_agent import SQLAgent, SQLResult  # noqa: F401
from backend.application.use_cases.fetch_bangumi_points import FetchBangumiPoints
from backend.application.use_cases.get_bangumi_subject import GetBangumiSubject
from backend.domain.entities import Point
from backend.infrastructure.gateways.anitabi import AnitabiClientGateway
from backend.infrastructure.gateways.bangumi import BangumiClientGateway
from backend.infrastructure.supabase.client import SupabaseClient
from backend.services.cache import _CACHE_MISS, ResponseCache

logger = structlog.get_logger(__name__)

_DEFAULT_CACHE_TTL_SECONDS = 900
_SHARED_RETRIEVAL_CACHE = ResponseCache(default_ttl_seconds=_DEFAULT_CACHE_TTL_SECONDS)

# Backward-compatible alias used in tests
_merge_rows_preserving_order = merge_rows_preserving_order


class RetrievalStrategy(str, Enum):
    """Supported retrieval strategies."""

    SQL = "sql"
    GEO = "geo"
    HYBRID = "hybrid"


@dataclass
class RetrievalResult:
    """Normalized retrieval result across strategies."""

    strategy: RetrievalStrategy
    rows: list[dict] = field(default_factory=list)
    row_count: int = 0
    error: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return self.error is None


class Retriever:
    """Executor-facing retrieval facade with deterministic policy selection."""

    def __init__(
        self,
        db: object,
        *,
        sql_agent: SQLAgent | None = None,
        cache: ResponseCache | None = None,
        fetch_bangumi_points: Callable[[str], Awaitable[list[Point]]] | None = None,
        get_bangumi_subject: Callable[[int], Awaitable[dict[str, object]]]
        | None = None,
    ) -> None:
        self._db = db
        self._sql_agent = sql_agent or SQLAgent(cast(SupabaseClient, db))
        self._cache = cache or _SHARED_RETRIEVAL_CACHE
        self._fetch_bangumi_points = fetch_bangumi_points
        self._get_bangumi_subject = get_bangumi_subject
        if isinstance(db, SupabaseClient):
            self._fetch_bangumi_points = (
                self._fetch_bangumi_points
                or FetchBangumiPoints(anitabi=AnitabiClientGateway())
            )
            self._get_bangumi_subject = self._get_bangumi_subject or GetBangumiSubject(
                bangumi=BangumiClientGateway()
            )

    def choose_strategy(self, request: RetrievalRequest) -> RetrievalStrategy:
        """Choose a retrieval strategy without an LLM."""
        if request.tool == "search_nearby":
            return RetrievalStrategy.GEO
        if request.tool == "search_bangumi":
            if request.bangumi_id and (request.location or request.origin):
                return RetrievalStrategy.HYBRID
            return RetrievalStrategy.SQL
        return RetrievalStrategy.SQL

    async def execute(self, request: RetrievalRequest) -> RetrievalResult:
        """Execute the selected retrieval strategy."""
        strategy = self.choose_strategy(request)
        cache_key = self._cache.generate_key(
            "retrieval",
            {
                "db_scope": id(self._db),
                "request": request.model_dump(mode="json"),
                "strategy": strategy.value,
            },
        )
        logger.info(
            "retrieval_strategy_selected", tool=request.tool, strategy=strategy.value
        )
        cached = await self._cache.get(cache_key)
        if cached is not _CACHE_MISS and isinstance(cached, RetrievalResult):
            logger.info(
                "retrieval_cache_hit", tool=request.tool, strategy=strategy.value
            )
            return _clone_result(cached, metadata_updates={"cache": "hit"})
        handler = {
            RetrievalStrategy.SQL: self._execute_sql,
            RetrievalStrategy.GEO: self._execute_geo,
            RetrievalStrategy.HYBRID: self._execute_hybrid,
        }[strategy]
        result = await handler(request)
        if result.success and result.row_count > 0:
            await self._cache.set(cache_key, result)
            return _clone_result(result, metadata_updates={"cache": "write"})
        return _clone_result(result, metadata_updates={"cache": "miss"})

    async def _execute_sql_with_fallback(
        self, request: RetrievalRequest
    ) -> tuple[SQLResult, dict[str, object]]:
        return await execute_sql_with_fallback(
            request,
            self._sql_agent,
            self._db,
            self._fetch_bangumi_points,
            self._get_bangumi_subject,
        )

    async def _execute_sql(self, request: RetrievalRequest) -> RetrievalResult:
        sql_result, metadata = await self._execute_sql_with_fallback(request)
        return RetrievalResult(
            strategy=RetrievalStrategy.SQL,
            rows=sql_result.rows,
            row_count=sql_result.row_count,
            error=sql_result.error,
            metadata={"source": "sql", **metadata},
        )

    async def _execute_geo(self, request: RetrievalRequest) -> RetrievalResult:
        anchor = request.location or request.origin or ""
        radius_m = request.radius or 5000
        rows, error = await fetch_geo_rows(self._db, anchor, radius_m=radius_m)
        metadata: dict[str, object] = {
            "source": "geo",
            "anchor": anchor,
            "radius_m": radius_m,
        }
        if not error and len(rows) < 5:
            suggestions = await get_area_suggestions(self._db, anchor)
            if suggestions:
                metadata["sparse"] = True
                metadata["suggestions"] = suggestions
        return RetrievalResult(
            strategy=RetrievalStrategy.GEO,
            rows=rows,
            row_count=len(rows),
            error=error,
            metadata=metadata,
        )

    async def _execute_hybrid(self, request: RetrievalRequest) -> RetrievalResult:
        anchor = request.location or request.origin or ""
        (sql_result, sql_metadata), (geo_rows, geo_error) = await asyncio.gather(
            self._execute_sql_with_fallback(request),
            fetch_geo_rows(self._db, anchor, radius_m=request.radius or 5000),
        )
        if not sql_result.success:
            return RetrievalResult(
                strategy=RetrievalStrategy.HYBRID,
                error=sql_result.error,
                metadata={"source": "hybrid", "mode": "sql_error", **sql_metadata},
            )
        if geo_error:
            return RetrievalResult(
                strategy=RetrievalStrategy.HYBRID,
                rows=sql_result.rows,
                row_count=sql_result.row_count,
                metadata={
                    "source": "hybrid",
                    "mode": "sql_fallback",
                    "geo_error": geo_error,
                    "anchor": anchor,
                    **sql_metadata,
                },
            )
        if request.bangumi_id:
            geo_rows = [
                r
                for r in geo_rows
                if str(r.get("bangumi_id", "")) == request.bangumi_id
            ]
        merged = merge_rows_preserving_order(sql_result.rows, geo_rows)
        mode = "hybrid" if geo_rows else "sql_fallback"
        return RetrievalResult(
            strategy=RetrievalStrategy.HYBRID,
            rows=merged,
            row_count=len(merged),
            metadata={
                "source": "hybrid",
                "mode": mode,
                "anchor": anchor,
                "sql_row_count": sql_result.row_count,
                "geo_row_count": len(geo_rows),
                **sql_metadata,
            },
        )


def _clone_result(
    result: RetrievalResult,
    *,
    metadata_updates: dict[str, object] | None = None,
) -> RetrievalResult:
    return RetrievalResult(
        strategy=result.strategy,
        rows=[dict(row) for row in result.rows],
        row_count=result.row_count,
        error=result.error,
        metadata={**result.metadata, **(metadata_updates or {})},
    )
