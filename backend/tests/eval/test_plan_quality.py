"""Plan quality eval for ReActPlannerAgent.

Runs plan_quality_v1 dataset through run_pipeline and checks:
- planned steps match expected_steps
- final intent matches expected_intent

Usage:
    # Local LM Studio (default)
    uv run python tests/eval/test_plan_quality.py

    # Any OpenAI-compatible endpoint
    EVAL_MODEL=openai:gpt-4o-mini uv run python tests/eval/test_plan_quality.py

    # pytest
    uv run python -m pytest tests/eval/test_plan_quality.py -v -m integration --no-cov
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

# ── Pluggable model ──────────────────────────────────────────────────

_DEFAULT_MODEL = "openai:qwen3.5-9b@http://localhost:1234/v1"
_EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", _DEFAULT_MODEL)


def make_model(model_id: str | None = None) -> object:
    """Build a Pydantic AI model from a model string."""
    from pydantic_ai.models.openai import OpenAIModel
    from pydantic_ai.providers.openai import OpenAIProvider

    mid = model_id or _EVAL_MODEL_ID
    # Gemini models are resolved natively by pydantic-ai
    if mid.startswith("gemini"):
        return mid
    if "@" in mid:
        name, base_url = mid.split("@", 1)
        name = name.removeprefix("openai:")
        return OpenAIModel(name, provider=OpenAIProvider(base_url=base_url))
    # pydantic-ai resolves "openai:gpt-4o-mini" natively
    return mid


EVAL_MODEL = make_model()

# ── Case types ───────────────────────────────────────────────────────


@dataclass
class PlanInput:
    query: str
    locale: str


@dataclass
class PlanOutput:
    steps: list[str]  # successful tool names in execution order
    total_steps: int = 0  # all steps including failures (for efficiency)
    intent: str | None = None  # response.intent
    row_count: int = 0  # search result count (for outcome eval)


@dataclass
class ExpectedPlan:
    expected_steps: list[str]
    expected_intent: str


# ── Task under test ──────────────────────────────────────────────────


async def evaluate_plan(inp: PlanInput) -> PlanOutput:
    """Run run_pipeline with a mock DB and capture the plan steps + intent."""
    from unittest.mock import AsyncMock, MagicMock

    from backend.agents.pipeline import run_pipeline

    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])

    # Future-compat stubs for Iter 1+.
    db.query_bangumi_points = AsyncMock(return_value=[])
    db.query_nearby_points = AsyncMock(return_value=[])
    # Seed mock DB so resolve_anime succeeds (returns a known bangumi_id).
    # This lets the pipeline progress past resolve_anime to search_bangumi.
    # search_bangumi still returns empty rows (need real DB for outcome eval).
    db.find_bangumi_by_title = AsyncMock(return_value="262243")
    db.upsert_bangumi_title = AsyncMock(return_value=None)
    db.save_route = AsyncMock(return_value=None)
    db.load_route = AsyncMock(return_value=None)

    result = await run_pipeline(inp.query, db, model=EVAL_MODEL, locale=inp.locale)

    # Collect ALL executed steps (including failures) for efficiency accounting.
    all_steps: list[str] = []
    successful_steps: list[str] = []
    for sr in getattr(result, "step_results", []) or []:
        tool = getattr(sr, "tool", None)
        if tool is not None:
            step_name = tool if isinstance(tool, str) else str(tool)
            all_steps.append(step_name)
            if sr.success:
                successful_steps.append(step_name)
    # steps = successful only (for StepsMatchEvaluator ordering check)
    steps = successful_steps

    # Extract row_count from final_output for outcome evaluation.
    row_count = 0
    final_output = getattr(result, "final_output", None) or {}
    if isinstance(final_output, dict):
        results = final_output.get("results")
        if isinstance(results, dict):
            row_count = int(results.get("row_count", 0) or 0)

    return PlanOutput(
        steps=steps,
        total_steps=len(all_steps),
        intent=getattr(result, "intent", None),
        row_count=row_count,
    )


# ── Evaluators ───────────────────────────────────────────────────────


class StepsMatchEvaluator(Evaluator[PlanInput, PlanOutput]):
    """Score 1.0 if actual steps == expected_steps, else 0.0."""

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected = ctx.expected_output.expected_steps
        actual = ctx.output.steps if ctx.output else []
        return 1.0 if actual == expected else 0.0


class IntentMatchEvaluator(Evaluator[PlanInput, PlanOutput]):
    """Score 1.0 if actual intent == expected_intent."""

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected = ctx.expected_output.expected_intent
        actual = ctx.output.intent if ctx.output else None
        return 1.0 if actual == expected else 0.0


_SEARCH_TOOLS = {"search_bangumi", "search_nearby"}


class OutcomeEvaluator(Evaluator[PlanInput, PlanOutput]):
    """Score 1.0 if non-search query, or search returned rows; 0.0 if search returned 0.

    NOTE: With mock DB (default), search queries always return 0 rows.
    This evaluator is most useful with real DB (testcontainers) or seeded mocks.
    When row_count is 0 for a search query, this scores 0.0 — which is expected
    with empty mocks. The score becomes meaningful with real data.
    """

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected_steps = ctx.expected_output.expected_steps
        is_search = bool(_SEARCH_TOOLS & set(expected_steps))
        if not is_search:
            return 1.0
        row_count = ctx.output.row_count if ctx.output else 0
        return 1.0 if row_count > 0 else 0.0


class EfficiencyEvaluator(Evaluator[PlanInput, PlanOutput]):
    """Score based on how close total step count (including failures) is to expected.

    Uses abs() so both too-few and too-many steps are penalized.
    Counts ALL steps (including failed retries) via total_steps.
    """

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected_len = len(ctx.expected_output.expected_steps)
        # Use total_steps (all attempts) not just successful ones
        actual_len = ctx.output.total_steps if ctx.output else 0
        diff = abs(actual_len - expected_len)
        if diff <= 1:
            return 1.0
        if diff <= 3:
            return 0.5
        return 0.0


# ── Load dataset ─────────────────────────────────────────────────────


_DATASET_PATH = Path(__file__).parent / "datasets" / "plan_quality_v1.json"

CASES = [
    Case(
        name=row["id"],
        inputs=PlanInput(query=row["query"], locale=row["locale"]),
        expected_output=ExpectedPlan(
            expected_steps=row["expected_steps"],
            expected_intent=row["expected_intent"],
        ),
    )
    for row in json.loads(_DATASET_PATH.read_text())
]

plan_dataset = Dataset(
    name="plan_quality_v1",
    cases=CASES,
    evaluators=[
        StepsMatchEvaluator(),
        IntentMatchEvaluator(),
        OutcomeEvaluator(),
        EfficiencyEvaluator(),
    ],
)


# ── Pytest integration ───────────────────────────────────────────────


@pytest.mark.integration
def test_plan_quality_eval():
    """Run plan quality eval. Baseline pass rate is recorded for Iter 1 comparison."""
    report = plan_dataset.evaluate_sync(
        evaluate_plan,
        name=f"plan_eval_{_EVAL_MODEL_ID}",
        max_concurrency=1,
    )
    report.print(include_input=True, include_output=True)

    avg = report.averages()
    steps_score = avg.scores.get("StepsMatchEvaluator", 0)
    intent_score = avg.scores.get("IntentMatchEvaluator", 0)

    print(f"\n{'=' * 60}")
    print(f"  Model:          {_EVAL_MODEL_ID}")
    print(f"  Steps accuracy: {steps_score:.1%}   ← record as Iter 1 baseline")
    print(f"  Intent accuracy:{intent_score:.1%}")
    print(f"  Total cases:    {len(CASES)}")
    print(f"{'=' * 60}")
    # No assertion — this is a baseline measurement run, not a gate


# ── Standalone runner ────────────────────────────────────────────────


if __name__ == "__main__":
    model_arg = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--eval-model" and i < len(sys.argv):
            model_arg = sys.argv[i + 1]
            break
        if arg.startswith("--eval-model="):
            model_arg = arg.split("=", 1)[1]
            break

    async def main() -> None:
        mid = model_arg or _EVAL_MODEL_ID
        model = make_model(model_arg) if model_arg else EVAL_MODEL

        async def _task(inp: PlanInput) -> PlanOutput:
            # Keep evaluate_plan signature unchanged for Dataset.evaluate_sync.
            global EVAL_MODEL
            EVAL_MODEL = model
            return await evaluate_plan(inp)

        report = await plan_dataset.evaluate(
            _task,
            name=f"plan_eval_{mid}",
            max_concurrency=1,
        )
        report.print(include_input=True, include_output=True)
        avg = report.averages()
        print(f"\n  Model: {mid}")
        print(
            f"  Steps: {avg.scores.get('StepsMatchEvaluator', 0):.1%}  "
            f"Intent: {avg.scores.get('IntentMatchEvaluator', 0):.1%}  "
            f"Cases: {len(CASES)}"
        )

    asyncio.run(main())
