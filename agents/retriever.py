"""Retriever abstraction for executor-facing data access.

This module provides a deterministic strategy layer above SQLAgent:

- sql: structured SQL retrieval
- geo: direct PostGIS proximity search
- hybrid: combine SQL-constrained rows with geo proximity results
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import structlog

from agents.intent_agent import IntentOutput
from agents.sql_agent import KNOWN_LOCATIONS, SQLAgent, SQLResult
from application.use_cases.fetch_bangumi_points import FetchBangumiPoints
from application.use_cases.get_bangumi_subject import GetBangumiSubject
from domain.entities import Point
from infrastructure.gateways.anitabi import AnitabiClientGateway
from infrastructure.gateways.bangumi import BangumiClientGateway
from infrastructure.supabase.client import SupabaseClient
from services.cache import _CACHE_MISS, ResponseCache

logger = structlog.get_logger(__name__)

_DEFAULT_GEO_LIMIT = 50
_DEFAULT_CACHE_TTL_SECONDS = 900
_SHARED_RETRIEVAL_CACHE = ResponseCache(
    default_ttl_seconds=_DEFAULT_CACHE_TTL_SECONDS,
)


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
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return self.error is None


class Retriever:
    """Executor-facing retrieval facade with deterministic policy selection."""

    def __init__(
        self,
        db: Any,
        *,
        sql_agent: SQLAgent | None = None,
        cache: ResponseCache | None = None,
        fetch_bangumi_points: Callable[[str], Awaitable[list[Point]]] | None = None,
        get_bangumi_subject: Callable[[int], Awaitable[dict[str, Any]]] | None = None,
    ) -> None:
        self._db = db
        self._sql_agent = sql_agent or SQLAgent(db)
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

    def choose_strategy(self, intent: IntentOutput) -> RetrievalStrategy:
        """Choose a retrieval strategy without an LLM."""
        params = intent.extracted_params

        if intent.intent == "search_by_location":
            return RetrievalStrategy.GEO

        if intent.intent in {"search_by_bangumi", "plan_route"}:
            if params.bangumi and (params.location or params.origin):
                return RetrievalStrategy.HYBRID
            return RetrievalStrategy.SQL

        return RetrievalStrategy.SQL

    async def execute(self, intent: IntentOutput) -> RetrievalResult:
        """Execute the selected retrieval strategy."""
        strategy = self.choose_strategy(intent)
        cache_key = self._cache.generate_key(
            "retrieval",
            {
                "db_scope": id(self._db),
                "intent": intent.intent,
                "strategy": strategy.value,
                "params": intent.extracted_params.model_dump(mode="json"),
            },
        )

        logger.info(
            "retrieval_strategy_selected",
            intent=intent.intent,
            strategy=strategy.value,
        )

        cached = await self._cache.get(cache_key)
        if cached is not _CACHE_MISS and isinstance(cached, RetrievalResult):
            logger.info(
                "retrieval_cache_hit",
                intent=intent.intent,
                strategy=strategy.value,
            )
            return _clone_result(cached, metadata_updates={"cache": "hit"})

        handler = {
            RetrievalStrategy.SQL: self._execute_sql,
            RetrievalStrategy.GEO: self._execute_geo,
            RetrievalStrategy.HYBRID: self._execute_hybrid,
        }[strategy]
        result = await handler(intent)

        if result.success and result.row_count > 0:
            await self._cache.set(cache_key, result)
            return _clone_result(result, metadata_updates={"cache": "write"})

        return _clone_result(result, metadata_updates={"cache": "miss"})

    async def _execute_sql(self, intent: IntentOutput) -> RetrievalResult:
        sql_result, metadata = await self._execute_sql_with_fallback(intent)
        return RetrievalResult(
            strategy=RetrievalStrategy.SQL,
            rows=sql_result.rows,
            row_count=sql_result.row_count,
            error=sql_result.error,
            metadata={"source": "sql", **metadata},
        )

    async def _execute_geo(self, intent: IntentOutput) -> RetrievalResult:
        anchor = (
            intent.extracted_params.location or intent.extracted_params.origin or ""
        )
        rows, error = await self._fetch_geo_rows(
            anchor,
            radius_m=intent.extracted_params.radius or 5000,
        )
        return RetrievalResult(
            strategy=RetrievalStrategy.GEO,
            rows=rows,
            row_count=len(rows),
            error=error,
            metadata={"source": "geo", "anchor": anchor},
        )

    async def _execute_hybrid(self, intent: IntentOutput) -> RetrievalResult:
        params = intent.extracted_params
        anchor = params.location or params.origin or ""

        (sql_result, sql_metadata), (geo_rows, geo_error) = await asyncio.gather(
            self._execute_sql_with_fallback(intent),
            self._fetch_geo_rows(anchor, radius_m=params.radius or 5000),
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

        if params.bangumi:
            geo_rows = [
                row
                for row in geo_rows
                if str(row.get("bangumi_id", "")) == params.bangumi
            ]

        merged_rows = _merge_rows_preserving_order(sql_result.rows, geo_rows)

        mode = "hybrid" if geo_rows else "sql_fallback"
        return RetrievalResult(
            strategy=RetrievalStrategy.HYBRID,
            rows=merged_rows,
            row_count=len(merged_rows),
            metadata={
                "source": "hybrid",
                "mode": mode,
                "anchor": anchor,
                "sql_row_count": sql_result.row_count,
                "geo_row_count": len(geo_rows),
                **sql_metadata,
            },
        )

    async def _execute_sql_with_fallback(
        self,
        intent: IntentOutput,
    ) -> tuple[SQLResult, dict[str, Any]]:
        sql_result = await self._sql_agent.execute(intent)
        metadata: dict[str, Any] = {"data_origin": "db"}

        if not sql_result.success:
            return sql_result, metadata

        if sql_result.row_count > 0 or not _should_try_db_miss_fallback(intent):
            return sql_result, metadata

        bangumi_id = intent.extracted_params.bangumi
        assert bangumi_id is not None

        fallback_meta = await self._write_through_bangumi_points(bangumi_id)
        metadata.update(fallback_meta)

        if fallback_meta.get("write_through"):
            rerun_result = await self._sql_agent.execute(intent)
            if rerun_result.success:
                return rerun_result, metadata

        return sql_result, metadata

    async def _write_through_bangumi_points(
        self,
        bangumi_id: str,
    ) -> dict[str, Any]:
        try:
            if self._fetch_bangumi_points is None:
                return {
                    "data_origin": "db_miss",
                    "fallback_status": "disabled",
                }
            points = await self._fetch_bangumi_points(bangumi_id)
        except Exception as exc:
            logger.warning(
                "bangumi_fallback_fetch_failed",
                bangumi_id=bangumi_id,
                error=str(exc),
            )
            return {
                "data_origin": "db_miss",
                "fallback_source": "anitabi",
                "fallback_error": str(exc),
            }

        if not points:
            return {
                "data_origin": "db_miss",
                "fallback_source": "anitabi",
                "fallback_status": "empty",
            }

        await asyncio.gather(
            self._ensure_bangumi_record(bangumi_id, points),
            self._persist_points(points),
        )
        await self._update_bangumi_points_count(bangumi_id, len(points))

        logger.info(
            "bangumi_fallback_write_through_complete",
            bangumi_id=bangumi_id,
            point_count=len(points),
        )
        return {
            "data_origin": "fallback",
            "fallback_source": "anitabi",
            "fallback_status": "written",
            "write_through": True,
            "fetched_points": len(points),
        }

    async def _ensure_bangumi_record(
        self,
        bangumi_id: str,
        points: list[Point],
    ) -> None:
        upsert_bangumi = getattr(self._db, "upsert_bangumi", None)
        if upsert_bangumi is None:
            return

        metadata = await self._load_bangumi_metadata(bangumi_id, points)
        await upsert_bangumi(bangumi_id, **metadata)

    async def _load_bangumi_metadata(
        self,
        bangumi_id: str,
        points: list[Point],
    ) -> dict[str, Any]:
        try:
            if self._get_bangumi_subject is None:
                raise RuntimeError("Bangumi subject fallback is not configured")
            subject_id = int(bangumi_id)
            subject = await self._get_bangumi_subject(subject_id)
        except Exception as exc:
            logger.warning(
                "bangumi_metadata_fallback_to_minimal",
                bangumi_id=bangumi_id,
                error=str(exc),
            )
            subject = None

        if subject:
            return _subject_to_bangumi_fields(subject, points_count=len(points))

        title = points[0].bangumi_title if points else bangumi_id
        return {
            "title": title or bangumi_id,
            "title_cn": title or bangumi_id,
            "points_count": len(points),
        }

    async def _persist_points(self, points: list[Point]) -> None:
        upsert_points_batch = getattr(self._db, "upsert_points_batch", None)
        if upsert_points_batch is None:
            return

        rows = [_point_to_db_row(point) for point in points]
        await upsert_points_batch(rows)

    async def _update_bangumi_points_count(
        self, bangumi_id: str, points_count: int
    ) -> None:
        pool = getattr(self._db, "pool", None)
        if pool is None:
            return

        execute = getattr(pool, "execute", None)
        if execute is None:
            return

        await execute(
            "UPDATE bangumi SET points_count = $1 WHERE id = $2",
            points_count,
            bangumi_id,
        )

    async def _fetch_geo_rows(
        self,
        anchor: str,
        *,
        radius_m: int,
    ) -> tuple[list[dict], str | None]:
        if not anchor:
            return [], "Missing location/origin for geo retrieval"

        coords = KNOWN_LOCATIONS.get(anchor)
        if coords is None:
            return [], f"Unknown location: {anchor}. Geocoding not yet implemented."

        search_points = getattr(self._db, "search_points_by_location", None)
        if search_points is None:
            return [], "Database client does not support geo retrieval"

        lat, lon = coords
        records = await search_points(lat, lon, radius_m, limit=_DEFAULT_GEO_LIMIT)
        return _records_to_dicts(records), None


def _records_to_dicts(records: list[Any]) -> list[dict]:
    """Convert asyncpg records or plain dicts into dicts."""
    return [dict(record) for record in records]


def _point_to_db_row(point: Point) -> dict[str, Any]:
    return {
        "id": point.id,
        "bangumi_id": point.bangumi_id,
        "name": point.name,
        "cn_name": point.cn_name,
        "address": point.address,
        "episode": point.episode,
        "time_seconds": point.time_seconds,
        "screenshot_url": str(point.screenshot_url),
        "origin": point.origin,
        "origin_url": point.origin_url,
        "opening_hours": point.opening_hours,
        "admission_fee": point.admission_fee,
        "location": (
            f"POINT({point.coordinates.longitude} {point.coordinates.latitude})"
        ),
    }


def _subject_to_bangumi_fields(
    subject: dict[str, Any],
    *,
    points_count: int,
) -> dict[str, Any]:
    images = subject.get("images") or {}
    rating_obj = subject.get("rating") or {}
    title = subject.get("name") or subject.get("name_cn") or "Unknown"
    return {
        "title": title,
        "title_cn": subject.get("name_cn") or title,
        "cover_url": images.get("large") or images.get("common") or "",
        "air_date": subject.get("date"),
        "summary": (subject.get("summary") or "")[:2000],
        "eps_count": subject.get("total_episodes") or subject.get("eps") or 0,
        "rating": rating_obj.get("score"),
        "points_count": points_count,
    }


def _should_try_db_miss_fallback(intent: IntentOutput) -> bool:
    return intent.intent in {"search_by_bangumi", "plan_route"} and bool(
        intent.extracted_params.bangumi
    )


def _clone_result(
    result: RetrievalResult,
    *,
    metadata_updates: dict[str, Any] | None = None,
) -> RetrievalResult:
    return RetrievalResult(
        strategy=result.strategy,
        rows=[dict(row) for row in result.rows],
        row_count=result.row_count,
        error=result.error,
        metadata={**result.metadata, **(metadata_updates or {})},
    )


def _merge_rows_preserving_order(
    sql_rows: list[dict], geo_rows: list[dict]
) -> list[dict]:
    """Merge SQL rows with geo rows, keeping SQL order as the primary ranking."""
    geo_by_id = {
        str(row.get("id")): row for row in geo_rows if row.get("id") is not None
    }

    merged: list[dict] = []
    for sql_row in sql_rows:
        row_id = str(sql_row.get("id")) if sql_row.get("id") is not None else None
        if row_id is None:
            merged.append(dict(sql_row))
            continue

        geo_row = geo_by_id.get(row_id)
        if geo_row is None:
            merged.append(dict(sql_row))
            continue

        combined = dict(geo_row)
        combined.update(sql_row)
        merged.append(combined)

    return merged
