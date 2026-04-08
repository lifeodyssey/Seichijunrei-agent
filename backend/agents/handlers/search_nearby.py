"""Handler: search_nearby — search pilgrimage points near a location."""

from __future__ import annotations

from typing import cast

from backend.agents.handlers._helpers import build_query_payload
from backend.agents.models import PlanStep, RetrievalRequest
from backend.agents.retriever import Retriever


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    """Search pilgrimage points near a location.

    Returns a dict with keys: tool, success, data?, error?
    """
    params = step.params or {}
    location = params.get("location")
    if not isinstance(location, str):
        location = ""
    req = RetrievalRequest(
        tool="search_nearby",
        location=location,
        radius=params.get("radius"),
    )
    typed_retriever = cast(Retriever, retriever)
    retrieval = await typed_retriever.execute(req)
    return {
        "tool": "search_nearby",
        "success": retrieval.success,
        "data": build_query_payload(retrieval),
        "error": retrieval.error,
    }
