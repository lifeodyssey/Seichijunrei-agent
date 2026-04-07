"""Handler: answer_question + clarify — QA and clarification responses."""

from __future__ import annotations

from backend.agents.models import PlanStep


async def execute(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    """Return a plain QA answer (no retrieval).

    Returns a dict with keys: tool, success, data?, error?
    """
    params = step.params or {}
    return {
        "tool": "answer_question",
        "success": True,
        "data": {
            "message": params.get("answer", ""),
            "status": "info",
        },
    }


async def execute_clarify(
    step: PlanStep,
    context: dict[str, object],
    db: object,
    retriever: object,
) -> dict[str, object]:
    """Return a clarification question to the user (no retrieval).

    Returns a dict with keys: tool, success, data?, error?
    """
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
    return {
        "tool": "clarify",
        "success": True,
        "data": {
            "question": question,
            "options": options,
            "status": "needs_clarification",
        },
    }
