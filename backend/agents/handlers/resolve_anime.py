"""Handler: resolve_anime — DB-first title->bangumi_id; API fallback; write-through."""

from __future__ import annotations

import structlog

from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep
from backend.infrastructure.gateways.bangumi import BangumiClientGateway

logger = structlog.get_logger(__name__)

_TOOL = "resolve_anime"


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Resolve anime title to bangumi_id. DB first, API on miss (write-through)."""
    params = step.params or {}
    title = params.get("title")
    if not isinstance(title, str):
        title = ""
    if not title:
        return HandlerResult.fail(_TOOL, "No title provided")

    repo = getattr(db, "bangumi", None)
    find_bangumi_by_title = getattr(repo, "find_bangumi_by_title", None)
    find_all_by_title = getattr(repo, "find_all_by_title", None)
    upsert_bangumi_title = getattr(repo, "upsert_bangumi_title", None)
    if not callable(find_bangumi_by_title) or not callable(upsert_bangumi_title):
        return HandlerResult.fail(_TOOL, "DB not available")

    # 1. DB lookup — check for ambiguity first
    if callable(find_all_by_title):
        all_matches = await find_all_by_title(title)
        if len(all_matches) > 1:
            logger.info(
                "resolve_anime_ambiguous",
                title=title,
                match_count=len(all_matches),
            )
            return HandlerResult.ok(
                _TOOL,
                {
                    "ambiguous": True,
                    "candidates": [
                        {
                            "title": str(m.get("title", "")),
                            "bangumi_id": str(m.get("id", "")),
                            "cover_url": m.get("cover_url"),
                            "city": str(m.get("city", "")),
                            "points_count": int(m.get("points_count", 0) or 0),
                        }
                        for m in all_matches
                    ],
                },
            )

    bangumi_id = await find_bangumi_by_title(title)
    if bangumi_id:
        logger.info("resolve_anime_db_hit", title=title, bangumi_id=bangumi_id)
        return HandlerResult.ok(_TOOL, {"bangumi_id": bangumi_id, "title": title})

    # 2. Bangumi.tv API fallback — reuse shared gateway if available
    from backend.agents.retriever import Retriever

    gateway = (
        retriever.bangumi_gateway
        if isinstance(retriever, Retriever)
        else BangumiClientGateway()
    )
    bangumi_id = await gateway.search_by_title(title)
    if bangumi_id:
        await upsert_bangumi_title(title, bangumi_id)
        logger.info("resolve_anime_api_hit", title=title, bangumi_id=bangumi_id)
        return HandlerResult.ok(_TOOL, {"bangumi_id": bangumi_id, "title": title})

    return HandlerResult.fail(_TOOL, f"Could not resolve anime: '{title}'")
