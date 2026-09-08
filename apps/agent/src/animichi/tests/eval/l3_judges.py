"""The L3 outcome judges, opt-in behind ``EVAL_L3=1``.

Split out of ``evaluators.py`` (#1493): that module holds the deterministic,
free metrics this eval always computes; these two are model-backed graders that
cost a judge call per case and are off by default.
"""

from __future__ import annotations

from pydantic_ai.models import Model
from pydantic_ai.settings import ModelSettings
from pydantic_evals.evaluators import Evaluator, LLMJudge

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval.evaluators import AgentExpected, AgentInput

_TASK_COMPLETION_RUBRIC = """\
You are grading a Japanese-anime pilgrimage assistant's response. It PASSES
(pass=true) only when EVERY applicable point holds:
1. Any locations returned belong to the anime the user asked about.
2. The reply language matches the user's query language (ja / zh / en).
3. It fabricates no bangumi_id, coordinates, or place names.
4. If the user asked for a route / itinerary / walking plan, an ordered route
   is present.
When a point does not apply to the query, ignore it. Return pass=false with a
short reason if any applicable point fails."""

_HALLUCINATION_RUBRIC = """\
You are checking a Japanese-anime pilgrimage assistant's response for
fabrication. It PASSES (pass=true) when it invents NO concrete facts — no
made-up bangumi_id, no invented latitude/longitude, and no real-world place
names presented as pilgrimage spots without grounding. General etiquette or
planning advice with no concrete invented locations passes. If any concrete
location, ID, or coordinate looks fabricated, return pass=false with the
offending detail."""


def build_l3_evaluators(
    model: Model,
) -> list[Evaluator[AgentInput, AgentResult, AgentExpected]]:
    """L3 outcome judges. Judge model runs at temperature 0 for determinism.

    Each judge emits a numeric score (1.0 pass / 0.0 fail) under a distinct name
    so both flow through the existing baseline + gate machinery independently.
    """
    settings = ModelSettings(temperature=0.0)
    return [
        LLMJudge(
            rubric=_TASK_COMPLETION_RUBRIC,
            model=model,
            include_input=True,
            model_settings=settings,
            assertion=False,
            score={"evaluation_name": "task_completion", "include_reason": True},
        ),
        LLMJudge(
            rubric=_HALLUCINATION_RUBRIC,
            model=model,
            include_input=True,
            model_settings=settings,
            assertion=False,
            score={"evaluation_name": "hallucination_check", "include_reason": True},
        ),
    ]
