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
    """Build a Pydantic AI model from a model string.

    Model construction uses trust_env=False httpx clients internally,
    so proxy env vars are safely ignored without mutating os.environ.
    """
    from backend.agents.base import parse_model_spec

    mid = model_id or _EVAL_MODEL_ID
    return parse_model_spec(mid, use_settings_fallbacks=False)


# Lazy-init: avoid running LLM provider setup during pytest collection.
# EVAL_MODEL is initialized on first use via _get_eval_model().
_EVAL_MODEL: object | None = None


def _get_eval_model() -> object:
    """Get or lazily initialize the eval model."""
    global _EVAL_MODEL  # noqa: PLW0603
    if _EVAL_MODEL is None:
        _EVAL_MODEL = make_model()
    return _EVAL_MODEL


# ── Case types ───────────────────────────────────────────────────────


@dataclass
class PlanInput:
    query: str
    locale: str
    context: dict[str, object] | None = None


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
    db.find_bangumi_by_title = AsyncMock(return_value="262243")
    db.upsert_bangumi_title = AsyncMock(return_value=None)
    db.save_route = AsyncMock(return_value=None)
    db.load_route = AsyncMock(return_value=None)
    return db


# Module-level DB override: set by fixtures for testcontainer path.
_DB_OVERRIDE: object | None = None


async def evaluate_plan(inp: PlanInput) -> PlanOutput:
    """Run run_pipeline and capture the plan steps + intent.

    Uses real DB from testcontainer when ``_DB_OVERRIDE`` is set,
    otherwise falls back to MagicMock (standalone / no-Docker).
    """
    from backend.agents.pipeline import run_pipeline

    db = _DB_OVERRIDE if _DB_OVERRIDE is not None else _make_mock_db()

    result = await run_pipeline(
        inp.query,
        db,
        model=_get_eval_model(),
        locale=inp.locale,
        context=inp.context,
    )

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
        inputs=PlanInput(
            query=row["query"],
            locale=row["locale"],
            context=row.get("context"),
        ),
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


def _use_mock_db() -> bool:
    """Return True when we should fall back to mock DB (no Docker)."""
    if os.environ.get("USE_MOCK_DB", "").strip() in ("1", "true", "yes"):
        return True
    return False


def _baseline_path_for(model_id: str) -> Path:
    safe = model_id.replace(":", "-").replace("@", "-").replace("/", "-")
    return Path(__file__).parent / "baselines" / f"{safe}.json"


def _read_baseline_scores(
    model_id: str, *, expected_case_count: int | None = None
) -> dict[str, float]:
    path = _baseline_path_for(model_id)
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    # Reject stale baselines when dataset changes
    if expected_case_count is not None:
        stored_count = data.get("case_count")
        if stored_count is not None and stored_count != expected_case_count:
            print(
                f"  WARNING: baseline has {stored_count} cases but dataset has "
                f"{expected_case_count}. Treating as new baseline."
            )
            return {}
    scores = data.get("scores")
    return scores if isinstance(scores, dict) else {}


def _write_baseline_scores(
    model_id: str, scores: dict[str, float], *, case_count: int
) -> None:
    path = _baseline_path_for(model_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": model_id,
        "case_count": case_count,
        "scores": scores,
    }
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


@pytest.mark.integration
def test_plan_quality_with_db(request: pytest.FixtureRequest) -> None:
    """Run plan quality with real PostgreSQL testcontainer.

    OutcomeEvaluator scores become meaningful (row_count > 0 for known anime).
    Falls back to mock DB when USE_MOCK_DB=1 or real_db fixture unavailable.
    """
    global _DB_OVERRIDE  # noqa: PLW0603

    if not _use_mock_db():
        try:
            real_db = request.getfixturevalue("real_db")
            _DB_OVERRIDE = real_db
        except pytest.FixtureLookupError:
            pass  # testcontainer fixtures not available — use mock

    try:
        report = plan_dataset.evaluate_sync(
            evaluate_plan,
            name=f"plan_eval_db_{_EVAL_MODEL_ID}",
            max_concurrency=1,
        )
    finally:
        _DB_OVERRIDE = None

    report.print(include_input=True, include_output=True)

    avg = report.averages()
    steps_score = avg.scores.get("StepsMatchEvaluator", 0)
    intent_score = avg.scores.get("IntentMatchEvaluator", 0)
    outcome_score = avg.scores.get("OutcomeEvaluator", 0)
    efficiency_score = avg.scores.get("EfficiencyEvaluator", 0)

    db_mode = "testcontainer" if not _use_mock_db() else "mock"
    current_scores = {
        "StepsMatchEvaluator": steps_score,
        "IntentMatchEvaluator": intent_score,
        "OutcomeEvaluator": outcome_score,
        "EfficiencyEvaluator": efficiency_score,
    }
    baseline_scores = _read_baseline_scores(
        _EVAL_MODEL_ID, expected_case_count=len(CASES)
    )
    print(f"\n{'=' * 60}")
    print(f"  Model:          {_EVAL_MODEL_ID}")
    print(f"  DB mode:        {db_mode}")
    print(f"  Steps accuracy: {steps_score:.1%}")
    print(f"  Intent accuracy:{intent_score:.1%}")
    print(f"  Outcome score:  {outcome_score:.1%}")
    print(f"  Efficiency:     {efficiency_score:.1%}")
    print(f"  Total cases:    {len(CASES)}")
    print(f"{'=' * 60}")

    if not baseline_scores:
        _write_baseline_scores(_EVAL_MODEL_ID, current_scores, case_count=len(CASES))
        pytest.skip(f"Baseline created for {_EVAL_MODEL_ID}; re-run to enforce gate.")

    failures: list[str] = []
    for name, score in current_scores.items():
        baseline = float(baseline_scores.get(name, 0.0))
        minimum = baseline - 0.10
        if score < minimum:
            failures.append(
                f"{name}: {score:.1%} < baseline-10pp ({minimum:.1%}, baseline {baseline:.1%})"
            )

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
        global _EVAL_MODEL  # noqa: PLW0603
        mid = model_arg or _EVAL_MODEL_ID
        _EVAL_MODEL = make_model(model_arg) if model_arg else _get_eval_model()

        async def _task(inp: PlanInput) -> PlanOutput:
            return await evaluate_plan(inp)

        report = await plan_dataset.evaluate(
            _task,
            name=f"plan_eval_{mid}",
            max_concurrency=1,
        )
        report.print(include_input=True, include_output=True)
        avg = report.averages()
        current_scores = {
            "StepsMatchEvaluator": avg.scores.get("StepsMatchEvaluator", 0),
            "IntentMatchEvaluator": avg.scores.get("IntentMatchEvaluator", 0),
            "OutcomeEvaluator": avg.scores.get("OutcomeEvaluator", 0),
            "EfficiencyEvaluator": avg.scores.get("EfficiencyEvaluator", 0),
        }
        print(f"\n  Model: {mid}")
        print(
            f"  Steps: {current_scores['StepsMatchEvaluator']:.1%}  "
            f"Intent: {current_scores['IntentMatchEvaluator']:.1%}  "
            f"Outcome: {current_scores['OutcomeEvaluator']:.1%}  "
            f"Efficiency: {current_scores['EfficiencyEvaluator']:.1%}  "
            f"Cases: {len(CASES)}"
        )
        baseline_scores = _read_baseline_scores(mid)
        if not baseline_scores:
            _write_baseline_scores(mid, current_scores, case_count=len(CASES))
            print("  Baseline created. Re-run to enforce gate.")
            return
        failures: list[str] = []
        for name, score in current_scores.items():
            baseline = float(baseline_scores.get(name, 0.0))
            minimum = baseline - 0.10
            if score < minimum:
                failures.append(
                    f"{name}: {score:.1%} < baseline-10pp ({minimum:.1%}, baseline {baseline:.1%})"
                )
        if failures:
            raise SystemExit("Eval regression:\n" + "\n".join(failures))

    asyncio.run(main())
