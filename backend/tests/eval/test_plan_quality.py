"""Plan quality eval for ReActPlannerAgent.

Runs plan_quality_v1 dataset through run_pipeline and checks:
- planned steps match expected_steps
- final intent matches expected_intent

Usage:
    # Local LM Studio (default)
    uv run python tests/eval/test_plan_quality.py

    # Any OpenAI-compatible endpoint
    EVAL_MODEL=openai:gpt-4o-mini uv run python tests/eval/test_plan_quality.py

    # pytest (with testcontainer — needs Docker)
    uv run pytest backend/tests/eval/test_plan_quality.py -v -m integration --no-cov

    # pytest (mock fallback — no Docker)
    USE_MOCK_DB=1 uv run pytest backend/tests/eval/test_plan_quality.py -v -m integration --no-cov
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path

import pytest
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from backend.tests.eval.eval_common import (
    enforce_gate,
    load_dataset,
    read_baseline,
    write_baseline,
)

# ── Pluggable model ──────────────────────────────────────────────────

_DEFAULT_MODEL = "openai:qwen3.5-9b@http://localhost:1234/v1"
_EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", _DEFAULT_MODEL)

_cached_model: object | None = None


def make_model(model_id: str | None = None) -> object:
    """Build a Pydantic AI model from a model string."""
    from backend.agents.base import parse_model_spec

    mid = model_id or _EVAL_MODEL_ID
    return parse_model_spec(mid, use_settings_fallbacks=False)


def _get_eval_model() -> object:
    """Get or lazily initialize the eval model."""
    global _cached_model  # noqa: PLW0603
    if _cached_model is None:
        _cached_model = make_model()
    return _cached_model


# ── Case types ───────────────────────────────────────────────────────


@dataclass
class PlanInput:
    query: str
    locale: str
    context: dict[str, object] | None = None


@dataclass
class PlanOutput:
    steps: list[str]
    total_steps: int = 0
    intent: str | None = None
    row_count: int = 0


@dataclass
class ExpectedPlan:
    expected_steps: list[str]
    expected_intent: str


# ── Task factory (closure replaces _STATE global) ────────────────────

TaskFn = Callable[[PlanInput], Coroutine[object, object, PlanOutput]]


def _make_mock_db() -> object:
    """Build a MagicMock DB for standalone / no-Docker fallback."""
    from unittest.mock import AsyncMock, MagicMock

    db = MagicMock()
    pool = AsyncMock()
    pool.fetch = AsyncMock(return_value=[])
    db.pool = pool
    db.search_points_by_location = AsyncMock(return_value=[])
    db.query_bangumi_points = AsyncMock(return_value=[])
    db.query_nearby_points = AsyncMock(return_value=[])
    db.bangumi.find_bangumi_by_title = AsyncMock(return_value="262243")
    db.bangumi.upsert_bangumi_title = AsyncMock(return_value=None)
    db.save_route = AsyncMock(return_value=None)
    db.load_route = AsyncMock(return_value=None)
    return db


def _extract_plan_output(result: object) -> PlanOutput:
    """Extract PlanOutput from a pipeline result."""
    all_steps: list[str] = []
    successful_steps: list[str] = []
    for sr in getattr(result, "step_results", []) or []:
        tool = getattr(sr, "tool", None)
        if tool is None:
            continue
        step_name = tool if isinstance(tool, str) else str(tool)
        all_steps.append(step_name)
        if sr.success:
            successful_steps.append(step_name)

    row_count = 0
    final_output = getattr(result, "final_output", None) or {}
    if isinstance(final_output, dict):
        results = final_output.get("results")
        if isinstance(results, dict):
            row_count = int(results.get("row_count", 0) or 0)

    return PlanOutput(
        steps=successful_steps,
        total_steps=len(all_steps),
        intent=getattr(result, "intent", None),
        row_count=row_count,
    )


def make_plan_task(db: object | None = None, model: object | None = None) -> TaskFn:
    """Create a plan eval task with db and model bound via closure."""
    resolved_model = model or _get_eval_model()

    async def task(inp: PlanInput) -> PlanOutput:
        from backend.agents.pipeline import run_pipeline

        resolved_db = db if db is not None else _make_mock_db()
        result = await run_pipeline(
            inp.query,
            resolved_db,
            model=resolved_model,
            locale=inp.locale,
            context=inp.context,
        )
        return _extract_plan_output(result)

    return task


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
    """Score 1.0 if non-search query, or search returned rows."""

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected_steps = ctx.expected_output.expected_steps
        is_search = bool(_SEARCH_TOOLS & set(expected_steps))
        if not is_search:
            return 1.0
        row_count = ctx.output.row_count if ctx.output else 0
        return 1.0 if row_count > 0 else 0.0


class EfficiencyEvaluator(Evaluator[PlanInput, PlanOutput]):
    """Score based on step count proximity to expected."""

    def evaluate(self, ctx: EvaluatorContext[PlanInput, PlanOutput]) -> float:
        expected_len = len(ctx.expected_output.expected_steps)
        actual_len = ctx.output.total_steps if ctx.output else 0
        diff = abs(actual_len - expected_len)
        if diff <= 1:
            return 1.0
        if diff <= 3:
            return 0.5
        return 0.0


# ── Load dataset ─────────────────────────────────────────────────────


_DATASET_PATH = Path(__file__).parent / "datasets" / "plan_quality_v1.json"
_EVAL_CASES = load_dataset(_DATASET_PATH)

CASES = [
    Case(
        name=ec.id,
        inputs=PlanInput(
            query=ec.query,
            locale=ec.locale,
        ),
        expected_output=ExpectedPlan(
            expected_steps=ec.expected_steps,
            expected_intent=ec.expected_intent,
        ),
    )
    for ec in _EVAL_CASES
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


def _use_mock_db() -> bool:
    """Return True when we should fall back to mock DB (no Docker)."""
    return os.environ.get("USE_MOCK_DB", "").strip() in ("1", "true", "yes")


_LAYER = "plan_quality"


def _collect_plan_scores(avg: object) -> dict[str, float]:
    """Extract evaluator scores from a report averages object."""
    scores_attr = getattr(avg, "scores", {})
    names = [
        "StepsMatchEvaluator",
        "IntentMatchEvaluator",
        "OutcomeEvaluator",
        "EfficiencyEvaluator",
    ]
    return {n: scores_attr.get(n, 0) for n in names}


@pytest.mark.integration
def test_plan_quality_with_db(request: pytest.FixtureRequest) -> None:
    """Run plan quality with real PostgreSQL testcontainer."""
    db: object | None = None
    if not _use_mock_db():
        try:
            db = request.getfixturevalue("real_db")
        except pytest.FixtureLookupError:
            pass

    task = make_plan_task(db=db)
    report = plan_dataset.evaluate_sync(
        task,
        name=f"plan_eval_db_{_EVAL_MODEL_ID}",
        max_concurrency=1,
    )
    report.print(include_input=True, include_output=True)

    avg = report.averages()
    current_scores = _collect_plan_scores(avg)
    db_mode = "testcontainer" if db is not None else "mock"

    baseline_scores = read_baseline(
        _LAYER, _EVAL_MODEL_ID, expected_case_count=len(CASES)
    )
    print(f"\n{'=' * 60}")
    print(f"  Model:          {_EVAL_MODEL_ID}")
    print(f"  DB mode:        {db_mode}")
    for name, score in current_scores.items():
        label = name.replace("Evaluator", "")
        print(f"  {label:<16}{score:.1%}")
    print(f"  Total cases:    {len(CASES)}")
    print(f"{'=' * 60}")

    if not baseline_scores:
        write_baseline(_LAYER, _EVAL_MODEL_ID, current_scores, case_count=len(CASES))
        pytest.skip(f"Baseline created for {_EVAL_MODEL_ID}; re-run to enforce gate.")

    failures = enforce_gate(current_scores, baseline_scores)
    assert not failures, "Eval regression:\n" + "\n".join(failures)


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
        model = make_model(model_arg) if model_arg else _get_eval_model()
        task = make_plan_task(db=None, model=model)

        report = await plan_dataset.evaluate(
            task,
            name=f"plan_eval_{mid}",
            max_concurrency=1,
        )
        report.print(include_input=True, include_output=True)
        avg = report.averages()
        current_scores = _collect_plan_scores(avg)
        print(f"\n  Model: {mid}")
        for name, score in current_scores.items():
            print(f"  {name}: {score:.1%}", end="  ")
        print(f"Cases: {len(CASES)}")
        baseline_scores = read_baseline(_LAYER, mid)
        if not baseline_scores:
            write_baseline(_LAYER, mid, current_scores, case_count=len(CASES))
            print("  Baseline created. Re-run to enforce gate.")
            return
        failures = enforce_gate(current_scores, baseline_scores)
        if failures:
            raise SystemExit("Eval regression:\n" + "\n".join(failures))

    asyncio.run(main())
