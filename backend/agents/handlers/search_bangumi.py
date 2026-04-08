"""Handler: search_bangumi — search pilgrimage points for a specific bangumi."""

from __future__ import annotations

from typing import cast

from backend.agents.handlers._helpers import build_query_payload
from backend.agents.models import PlanStep, RetrievalRequest, ToolName
from backend.agents.retriever import Retriever


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    """Search pilgrimage points for a specific bangumi.

    Returns a dict with keys: tool, success, data?, error?
    """
    params = step.params or {}
    bangumi_id = params.get("bangumi_id")
    if not isinstance(bangumi_id, str) or not bangumi_id:
        resolved = context.get(ToolName.RESOLVE_ANIME.value)
        if isinstance(resolved, dict):
            resolved_id = resolved.get("bangumi_id")
            if isinstance(resolved_id, str) and resolved_id:
                bangumi_id = resolved_id
    if not isinstance(bangumi_id, str) or not bangumi_id:
        return {
            "tool": "search_bangumi",
            "success": False,
            "error": "No bangumi_id available",
        }

    episode = params.get("episode")
    episode_value = episode if isinstance(episode, int) else None
    origin = params.get("origin")
    origin_value = origin if isinstance(origin, str) else None
    req = RetrievalRequest(
        tool="search_bangumi",
        bangumi_id=bangumi_id,
        episode=episode_value,
        origin=origin_value,
        force_refresh=bool(params.get("force_refresh", False)),
    )
    typed_retriever = cast(Retriever, retriever)
    retrieval = await typed_retriever.execute(req)
    return {
        "tool": "search_bangumi",
        "success": retrieval.success,
        "data": build_query_payload(retrieval),
        "error": retrieval.error,
    }
