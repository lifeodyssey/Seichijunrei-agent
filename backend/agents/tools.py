"""Deterministic runtime helper tools (no LLM calls).

These helpers are used by the main pilgrimage runtime agent to enrich and
shape payloads for the frontend journey contract.
"""

from __future__ import annotations

import structlog

from backend.agents.runtime_deps import RuntimeDeps

logger = structlog.get_logger(__name__)

# Gateway/DB calls can raise these on transient failures.
_IO_ERRORS = (OSError, RuntimeError, ValueError)


async def enrich_clarify_candidates(
    deps: RuntimeDeps, titles: list[str]
) -> list[dict[str, object]]:
    """Enrich clarify candidate titles with cover/city/spot_count.

    DB-first → gateway fallback → write-through (best-effort).

    When no enrichment data is available, returns safe minimal candidates.
    """
    if not titles:
        return []

    by_title = await _db_lookup(deps, titles)

    candidates: list[dict[str, object]] = []
    for title in titles:
        row = by_title.get(title, {})
        bangumi_id = row.get("bangumi_id")

        if isinstance(bangumi_id, str) and bangumi_id:
            candidates.append(_candidate_from_row(title, row))
            continue

        fallback = await _gateway_fallback(deps, title)
        candidates.append(fallback)

    return candidates


async def _db_lookup(
    deps: RuntimeDeps, titles: list[str]
) -> dict[str, dict[str, object]]:
    """Look up candidate details from the DB, keyed by title."""
    repo = getattr(deps.db, "bangumi", None)
    find_fn = getattr(repo, "find_candidate_details_by_titles", None)
    if not callable(find_fn):
        return {}
    try:
        rows_obj: object = await find_fn(titles)
    except _IO_ERRORS:
        logger.warning("clarify_db_lookup_failed")
        return {}
    if not isinstance(rows_obj, list):
        return {}
    result: dict[str, dict[str, object]] = {}
    for r in rows_obj:
        if isinstance(r, dict):
            t = r.get("title")
            if isinstance(t, str) and t:
                result[t] = r
    return result


def _candidate_from_row(title: str, row: dict[str, object]) -> dict[str, object]:
    """Build a candidate dict from a DB row."""
    cover_url = row.get("cover_url")
    points_count = row.get("points_count")
    city = row.get("city")
    return {
        "title": title,
        "cover_url": cover_url if isinstance(cover_url, str) and cover_url else None,
        "spot_count": int(points_count or 0)
        if isinstance(points_count, int | float)
        else 0,
        "city": str(city or "") if isinstance(city, str | None) else "",
    }


async def _gateway_fallback(deps: RuntimeDeps, title: str) -> dict[str, object]:
    """Resolve via Bangumi gateway and write-through (best-effort)."""
    fallback_cover_url: str | None = None
    resolved_id: str | None = None
    try:
        resolved_id = await deps.gateway.search_by_title(title)
    except _IO_ERRORS:
        logger.warning("clarify_gateway_search_failed", title=title)

    if resolved_id is not None:
        fallback_cover_url = await _fetch_cover(deps, resolved_id)
        await _write_through(deps, title, resolved_id, fallback_cover_url)

    return {
        "title": title,
        "cover_url": fallback_cover_url,
        "spot_count": 0,
        "city": "",
    }


async def _fetch_cover(deps: RuntimeDeps, bangumi_id: str) -> str | None:
    """Fetch cover URL from the gateway subject endpoint."""
    try:
        subject_id = int(bangumi_id) if bangumi_id.isdigit() else None
        if subject_id is None:
            return None
        raw = await deps.gateway.get_subject(subject_id)
        images = raw.get("images")
        if isinstance(images, dict):
            url = images.get("large") or images.get("common")
            if isinstance(url, str) and url:
                return url
    except (ValueError, OSError, RuntimeError):
        logger.warning("clarify_cover_fetch_failed", bangumi_id=bangumi_id)
    return None


async def _write_through(
    deps: RuntimeDeps,
    title: str,
    bangumi_id: str,
    cover_url: str | None,
) -> None:
    """Write-through title and cover to DB (best-effort)."""
    repo = getattr(deps.db, "bangumi", None)
    upsert_title = getattr(repo, "upsert_bangumi_title", None)
    upsert_bangumi = getattr(repo, "upsert_bangumi", None)
    if callable(upsert_title):
        try:
            await upsert_title(title, bangumi_id)
        except _IO_ERRORS:
            logger.warning("clarify_upsert_title_failed", title=title)
    if callable(upsert_bangumi) and cover_url is not None:
        try:
            await upsert_bangumi(bangumi_id, title=title, cover_url=cover_url)
        except _IO_ERRORS:
            logger.warning("clarify_upsert_bangumi_failed", bangumi_id=bangumi_id)
