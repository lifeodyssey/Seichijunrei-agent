"""Shared retrieval execution template for search handlers."""

from __future__ import annotations

from typing import cast

from backend.agents.handlers._helpers import build_query_payload
from backend.agents.handlers.result import HandlerResult
from backend.agents.models import RetrievalRequest, ToolName
from backend.agents.retriever import Retriever


def resolve_bangumi_id(
    params: dict[str, object],
    context: dict[str, object],
) -> str | None:
    """Return bangumi_id from params, falling back to resolve_anime context."""
    bid = params.get("bangumi_id")
    if isinstance(bid, str) and bid:
        return bid
    resolved = context.get(ToolName.RESOLVE_ANIME.value)
    if isinstance(resolved, dict):
        fallback = resolved.get("bangumi_id")
        if isinstance(fallback, str) and fallback:
            return fallback
    return None


def build_bangumi_request(
    bangumi_id: str,
    params: dict[str, object],
) -> RetrievalRequest:
    """Build a RetrievalRequest for search_bangumi from validated params."""
    episode = params.get("episode")
    origin = params.get("origin")
    return RetrievalRequest(
        tool="search_bangumi",
        bangumi_id=bangumi_id,
        episode=episode if isinstance(episode, int) else None,
        origin=origin if isinstance(origin, str) else None,
        force_refresh=bool(params.get("force_refresh", False)),
    )


async def execute_retrieval(
    req: RetrievalRequest,
    retriever: object,
) -> HandlerResult:
    """Execute a retrieval request and return a HandlerResult."""
    typed = cast(Retriever, retriever)
    result = await typed.execute(req)
    if result.success:
        return HandlerResult.ok(req.tool, build_query_payload(result))
    return HandlerResult.fail(req.tool, result.error or "retrieval failed")
