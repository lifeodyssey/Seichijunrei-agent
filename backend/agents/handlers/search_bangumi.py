"""Handler: search_bangumi — search pilgrimage points for a specific bangumi."""

from __future__ import annotations

from backend.agents.handlers._base_search import (
    build_bangumi_request,
    execute_retrieval,
    resolve_bangumi_id,
)
from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Search pilgrimage points for a specific bangumi."""
    params = step.params or {}
    bangumi_id = resolve_bangumi_id(params, context)
    if not bangumi_id:
        return HandlerResult.fail("search_bangumi", "No bangumi_id available")
    return await execute_retrieval(build_bangumi_request(bangumi_id, params), retriever)
