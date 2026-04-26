"""Handler: search_nearby — search pilgrimage points near a location."""

from __future__ import annotations

from backend.agents.handlers._base_search import execute_retrieval
from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep, RetrievalRequest


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Search pilgrimage points near a location."""
    params = step.params or {}
    location = params.get("location")
    req = RetrievalRequest(
        tool="search_nearby",
        location=location if isinstance(location, str) else "",
        radius=params.get("radius"),
    )
    return await execute_retrieval(req, retriever)
