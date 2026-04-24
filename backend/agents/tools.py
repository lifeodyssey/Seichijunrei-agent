"""Deterministic runtime helper tools (no LLM calls).

These helpers are used by the main pilgrimage runtime agent to enrich and
shape payloads for the frontend journey contract.
"""

from __future__ import annotations

from backend.agents.runtime_deps import RuntimeDeps


async def enrich_clarify_candidates(
    deps: RuntimeDeps, titles: list[str]
) -> list[dict[str, object]]:
    """Enrich clarify candidate titles with cover/city/spot_count.

    DB-first → gateway fallback → write-through (best-effort).

    When no enrichment data is available, returns safe minimal candidates.
    """
    if not titles:
        return []

    repo = getattr(deps.db, "bangumi", None)
    find_fn = getattr(repo, "find_candidate_details_by_titles", None)

    rows: list[dict[str, object]] = []
    if callable(find_fn):
        try:
            rows_obj: object = await find_fn(titles)
            if isinstance(rows_obj, list):
                rows = [r for r in rows_obj if isinstance(r, dict)]
        except Exception:
            rows = []

    by_title: dict[str, dict[str, object]] = {}
    for row in rows:
        title = row.get("title")
        if isinstance(title, str) and title:
            by_title[title] = row

    candidates: list[dict[str, object]] = []
    for title in titles:
        row = by_title.get(title, {})
        bangumi_id = row.get("bangumi_id")
        cover_url = row.get("cover_url")
        points_count = row.get("points_count")
        city = row.get("city")

        # DB hit: return enriched candidate directly.
        if isinstance(bangumi_id, str) and bangumi_id:
            candidates.append(
                {
                    "title": title,
                    "cover_url": cover_url
                    if isinstance(cover_url, str) and cover_url
                    else None,
                    "spot_count": int(points_count or 0)
                    if isinstance(points_count, int | float)
                    else 0,
                    "city": str(city or "") if isinstance(city, str | None) else "",
                }
            )
            continue

        # Gateway fallback: best-effort cover lookup + write-through.
        fallback_cover_url: str | None = None
        resolved_id: str | None = None
        try:
            resolved_id = await deps.gateway.search_by_title(title)
        except Exception:
            resolved_id = None

        if resolved_id is not None:
            try:
                subject_id = int(resolved_id) if resolved_id.isdigit() else None
                if subject_id is None:
                    raise ValueError(f"Non-integer bangumi ID: {resolved_id}")
                raw = await deps.gateway.get_subject(subject_id)
                images = raw.get("images")
                if isinstance(images, dict):
                    url = images.get("large") or images.get("common")
                    if isinstance(url, str) and url:
                        fallback_cover_url = url
            except Exception:
                fallback_cover_url = None

            upsert_title = getattr(repo, "upsert_bangumi_title", None)
            upsert_bangumi = getattr(repo, "upsert_bangumi", None)
            if callable(upsert_title):
                try:
                    await upsert_title(title, resolved_id)
                except Exception:
                    pass
            if callable(upsert_bangumi) and fallback_cover_url is not None:
                try:
                    await upsert_bangumi(
                        resolved_id,
                        title=title,
                        cover_url=fallback_cover_url,
                        points_count=0,
                    )
                except Exception:
                    pass

        candidates.append(
            {
                "title": title,
                "cover_url": fallback_cover_url,
                "spot_count": 0,
                "city": "",
            }
        )

    return candidates
