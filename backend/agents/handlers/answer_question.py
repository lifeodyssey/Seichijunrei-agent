"""Handler: answer_question + clarify — QA and clarification responses."""

from __future__ import annotations

from backend.agents.handlers.result import HandlerResult
from backend.agents.models import PlanStep


def _build_candidates(options: list[str]) -> list[dict[str, object]]:
    """Build minimal clarify candidates from plain-text options."""
    return [
        {
            "title": option,
            "cover_url": None,
            "spot_count": 0,
            "city": "",
        }
        for option in options
    ]


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Return a plain QA answer (no retrieval)."""
    params = step.params or {}
    return HandlerResult.ok(
        "answer_question",
        {
            "message": params.get("answer", ""),
            "status": "info",
        },
    )


async def execute_clarify(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> HandlerResult:
    """Return a clarification question to the user (no retrieval)."""
    params = step.params or {}
    question = params.get("question")
    if not isinstance(question, str):
        question = ""
    raw_options = params.get("options")
    options: list[str] = (
        [str(o) for o in raw_options if isinstance(o, str)]
        if isinstance(raw_options, list)
        else []
    )
    raw_candidates = params.get("candidates")
    candidates = (
        [candidate for candidate in raw_candidates if isinstance(candidate, dict)]
        if isinstance(raw_candidates, list)
        else _build_candidates(options)
    )
    return HandlerResult.ok(
        "clarify",
        {
            "question": question,
            "options": options,
            "candidates": candidates,
            "status": "needs_clarification",
        },
    )
