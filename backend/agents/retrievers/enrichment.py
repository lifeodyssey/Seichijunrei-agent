"""Bangumi write-through enrichment: fetch from Anitabi/Bangumi API, persist to DB."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Mapping

import structlog

from backend.clients.anitabi import AnitabiClient
from backend.domain.entities import Point

logger = structlog.get_logger(__name__)


def point_to_db_row(point: Point) -> dict[str, object]:
    return {
        "id": point.id,
        "bangumi_id": point.bangumi_id,
        "name": point.name,
        "name_cn": point.cn_name,
        "latitude": point.coordinates.latitude,
        "longitude": point.coordinates.longitude,
        "episode": point.episode,
        "time_seconds": point.time_seconds,
        "image": str(point.screenshot_url),
        "origin": point.origin,
        "origin_url": point.origin_url,
        "location": (
            f"POINT({point.coordinates.longitude} {point.coordinates.latitude})"
        ),
    }


def subject_to_bangumi_fields(
    subject: Mapping[str, object],
    *,
    points_count: int,
) -> dict[str, object]:
    images = subject.get("images") or {}
    rating_obj = subject.get("rating") or {}
    if not isinstance(images, Mapping):
        images = {}
    if not isinstance(rating_obj, Mapping):
        rating_obj = {}
    title = subject.get("name") or subject.get("name_cn") or "Unknown"
    return {
        "title": title,
        "title_cn": subject.get("name_cn") or title,
        "cover_url": images.get("large") or images.get("common") or "",
        "air_date": subject.get("date"),
        "summary": str(subject.get("summary") or "")[:2000],
        "eps_count": subject.get("total_episodes") or subject.get("eps") or 0,
        "rating": rating_obj.get("score"),
        "points_count": points_count,
    }


async def fetch_bangumi_lite(bangumi_id: str) -> dict[str, object] | None:
    """Fetch Anitabi /lite info for correct title, city, cover."""
    try:
        async with AnitabiClient() as client:
            return await client.get_bangumi_lite(bangumi_id)
    except (OSError, RuntimeError, ValueError) as exc:
        logger.warning(
            "bangumi_lite_fetch_failed",
            bangumi_id=bangumi_id,
            error=str(exc),
        )
        return None


async def load_bangumi_metadata(
    bangumi_id: str,
    points: list[Point],
    get_bangumi_subject: Callable[[int], Awaitable[dict[str, object]]] | None,
) -> dict[str, object]:
    try:
        if get_bangumi_subject is None:
            raise RuntimeError("Bangumi subject fallback is not configured")
        subject_id = int(bangumi_id)
        subject = await get_bangumi_subject(subject_id)
    except (OSError, RuntimeError, ValueError) as exc:
        logger.warning(
            "bangumi_metadata_fallback_to_minimal",
            bangumi_id=bangumi_id,
            error=str(exc),
        )
        subject = None

    if subject:
        return subject_to_bangumi_fields(subject, points_count=len(points))

    title = points[0].bangumi_title if points else bangumi_id
    return {
        "title": title or bangumi_id,
        "title_cn": title or bangumi_id,
        "points_count": len(points),
    }


async def persist_points(db: object, points: list[Point]) -> None:
    from backend.infrastructure.supabase.client import SupabaseClient

    if not isinstance(db, SupabaseClient):
        return
    rows = [point_to_db_row(point) for point in points]
    await db.points.upsert_points_batch(rows)


async def update_bangumi_points_count(
    db: object,
    bangumi_id: str,
    points_count: int,
) -> None:
    pool = getattr(db, "pool", None)
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


async def ensure_bangumi_record(
    db: object,
    bangumi_id: str,
    points: list[Point],
    get_bangumi_subject: Callable[[int], Awaitable[dict[str, object]]] | None,
) -> None:
    from backend.infrastructure.supabase.client import SupabaseClient

    if not isinstance(db, SupabaseClient):
        return

    metadata = await load_bangumi_metadata(bangumi_id, points, get_bangumi_subject)

    lite = await fetch_bangumi_lite(bangumi_id)
    if lite:
        lite_title = lite.get("title")
        if isinstance(lite_title, str) and lite_title:
            metadata["title"] = lite_title
        lite_cn = lite.get("cn")
        if isinstance(lite_cn, str) and lite_cn:
            metadata["title_cn"] = lite_cn
        lite_city = lite.get("city")
        if isinstance(lite_city, str) and lite_city:
            metadata["city"] = lite_city
        lite_cover = lite.get("cover")
        if isinstance(lite_cover, str) and lite_cover:
            metadata["cover_url"] = lite_cover

    await db.bangumi.upsert_bangumi(bangumi_id, **metadata)


async def write_through_bangumi_points(
    db: object,
    bangumi_id: str,
    fetch_bangumi_points: Callable[[str], Awaitable[list[Point]]] | None,
    get_bangumi_subject: Callable[[int], Awaitable[dict[str, object]]] | None,
) -> dict[str, object]:
    try:
        if fetch_bangumi_points is None:
            return {
                "data_origin": "db_miss",
                "fallback_status": "disabled",
            }
        points = await fetch_bangumi_points(bangumi_id)
    except (OSError, RuntimeError, ValueError) as exc:
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
        ensure_bangumi_record(db, bangumi_id, points, get_bangumi_subject),
        persist_points(db, points),
    )
    await update_bangumi_points_count(db, bangumi_id, len(points))

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
