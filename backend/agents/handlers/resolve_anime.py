"""Handler: resolve_anime — DB-first title->bangumi_id; API fallback; write-through."""

from __future__ import annotations

import structlog

from backend.agents.models import PlanStep
from backend.infrastructure.gateways.bangumi import BangumiClientGateway

logger = structlog.get_logger(__name__)


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    """Resolve anime title to bangumi_id. DB first, API on miss (write-through).

    Returns a dict with keys: tool, success, data?, error?
    """
    params = step.params or {}
    title = params.get("title")
    if not isinstance(title, str):
        title = ""
    if not title:
        return {"tool": "resolve_anime", "success": False, "error": "No title provided"}

    repo = getattr(db, "bangumi", None)
    find_bangumi_by_title = getattr(repo, "find_bangumi_by_title", None)
    upsert_bangumi_title = getattr(repo, "upsert_bangumi_title", None)
    if not callable(find_bangumi_by_title) or not callable(upsert_bangumi_title):
        return {"tool": "resolve_anime", "success": False, "error": "DB not available"}

    # 1. DB lookup
    bangumi_id = await find_bangumi_by_title(title)
    if bangumi_id:
        logger.info("resolve_anime_db_hit", title=title, bangumi_id=bangumi_id)
        return {
            "tool": "resolve_anime",
            "success": True,
            "data": {"bangumi_id": bangumi_id, "title": title},
        }

    # 2. Bangumi.tv API fallback
    gateway = BangumiClientGateway()
    bangumi_id = await gateway.search_by_title(title)
    if bangumi_id:
        await upsert_bangumi_title(title, bangumi_id)
        logger.info("resolve_anime_api_hit", title=title, bangumi_id=bangumi_id)
        return {
            "tool": "resolve_anime",
            "success": True,
            "data": {"bangumi_id": bangumi_id, "title": title},
        }

    return {
        "tool": "resolve_anime",
        "success": False,
        "error": f"Could not resolve anime: '{title}'",
    }
