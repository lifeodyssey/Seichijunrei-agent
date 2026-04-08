"""Handler: greet_user — ephemeral greeting/identity response."""

from __future__ import annotations

from backend.agents.models import PlanStep


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    """Return an ephemeral greeting/identity response (no retrieval).

    Returns a dict with keys: tool, success, data?, error?
    """
    params = step.params or {}
    return {
        "tool": "greet_user",
        "success": True,
        "data": {
            "message": params.get("message", ""),
            "status": "info",
        },
    }
