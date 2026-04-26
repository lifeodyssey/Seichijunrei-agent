"""Handler: greet_user — ephemeral greeting/identity response."""

from __future__ import annotations

from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Return an ephemeral greeting/identity response (no retrieval)."""
    params = step.params or {}
    return HandlerResult.ok(
        "greet_user",
        {
            "message": params.get("message", ""),
            "status": "info",
        },
    )
