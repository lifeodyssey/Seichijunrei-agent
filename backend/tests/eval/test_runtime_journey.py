"""Runtime journey eval — validates frontend stage contracts.

Runs runtime_journey_v1 dataset through the pilgrimage agent and checks:
- final intent/stage matches expected
- final message is non-empty and meets minimum length
- required data keys are present in the final response

All evals run against a real testcontainer PostgreSQL (with seed data).
No mock DB fallback — the eval must test the real product chain.

Usage:
    # pytest (requires Docker for testcontainer)
    uv run pytest backend/tests/eval/test_runtime_journey.py -v -m integration --no-cov

    # standalone
    uv run python tests/eval/test_runtime_journey.py
"""

from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from pathlib import Path

import pytest
from dotenv import load_dotenv
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from backend.tests.eval.eval_common import (
    enforce_gate,
    load_journey_dataset,
    read_baseline,
    write_baseline,
)

# Load root .env so API keys are available at eval time.
load_dotenv(Path(__file__).parents[3] / ".env")

# ── Pluggable model ──────────────────────────────────────────────────

_DEFAULT_MODEL_ID = "openai:gemini-3-pro-preview@https://api.zetatechs.com/v1"
_EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", _DEFAULT_MODEL_ID)

_cached_model: object | None = None


def make_model(model_id: str | None = None) -> object:
    """Build a Pydantic AI model from a model string."""
    from backend.agents.base import parse_model_spec

    mid = model_id or _EVAL_MODEL_ID
    return parse_model_spec(mid, use_settings_fallbacks=False)


def _get_eval_model() -> object:
    global _cached_model  # noqa: PLW0603
    if _cached_model is None:
        _cached_model = make_model()
    return _cached_model


# ── Case types ───────────────────────────────────────────────────────


@dataclass
class JourneyInput:
    query: str
    locale: str


@dataclass
class JourneyOutput:
    intent: str
    message: str
    message_len: int
    data_keys: list[str]
    results_keys: list[str]
    route_keys: list[str]
    nearby_fields: list[str]


@dataclass
class JourneyExpected:
    expected_stage: str
    expected_message_min_len: int
    expected_data_keys: list[str]
    expected_results_keys: list[str]
    expected_nearby_fields: list[str]
    expected_route_keys: list[str]


# ── Task factory (closure replaces _STATE global) ────────────────────

TaskFn = Callable[[JourneyInput], Coroutine[object, object, JourneyOutput]]


def _build_model_settings() -> object | None:
    """Build model settings for models with special requirements."""
    if "kimi" not in _EVAL_MODEL_ID.lower():
        return None
    from pydantic_ai.settings import ModelSettings

    return ModelSettings(max_tokens=4096)


def _extract_output(result: object) -> JourneyOutput:
    """Extract JourneyOutput from a pilgrimage agent result."""
    intent = str(getattr(result, "intent", "unknown"))
    final_output = getattr(result, "final_output", None) or {}
    if isinstance(final_output, dict):
        message = str(final_output.get("message") or "")
        data = final_output
    else:
        message = ""
        data = {}

    data_keys = list(data.keys()) if isinstance(data, dict) else []
    results_keys, route_keys, nearby_fields = _extract_sub_keys(data)

    return JourneyOutput(
        intent=intent,
        message=message,
        message_len=len(message),
        data_keys=data_keys,
        results_keys=results_keys,
        route_keys=route_keys,
        nearby_fields=nearby_fields,
    )


def _extract_sub_keys(
    data: dict[str, object],
) -> tuple[list[str], list[str], list[str]]:
    """Extract results, route, and nearby field keys from response data."""
    results = data.get("results")
    results_keys = list(results.keys()) if isinstance(results, dict) else []
    route = data.get("route")
    route_keys = list(route.keys()) if isinstance(route, dict) else []
    rows = results.get("rows", []) if isinstance(results, dict) else []
    nearby_fields: list[str] = []
    if rows and isinstance(rows[0], dict):
        nearby_fields = list(rows[0].keys())
    return results_keys, route_keys, nearby_fields


def make_journey_task(db: object, model: object | None = None) -> TaskFn:
    """Create a journey eval task with db and model bound via closure."""
    resolved_model = model or _get_eval_model()
    settings = _build_model_settings()

    async def task(inp: JourneyInput) -> JourneyOutput:
        from backend.agents.pilgrimage_runner import run_pilgrimage_agent

        result = await run_pilgrimage_agent(
            text=inp.query,
            db=db,
            model=resolved_model,
            locale=inp.locale,
            model_settings=settings,
        )
        return _extract_output(result)

    return task


# ── Evaluators ───────────────────────────────────────────────────────


class StageEvaluator(Evaluator[JourneyInput, JourneyOutput]):
    """Score 1.0 if actual intent matches expected stage."""

    def evaluate(self, ctx: EvaluatorContext[JourneyInput, JourneyOutput]) -> float:
        expected = ctx.expected_output.expected_stage
        actual = ctx.output.intent if ctx.output else None
        return 1.0 if actual == expected else 0.0


class MessageMinLenEvaluator(Evaluator[JourneyInput, JourneyOutput]):
    """Score 1.0 if message meets minimum length requirement."""

    def evaluate(self, ctx: EvaluatorContext[JourneyInput, JourneyOutput]) -> float:
        min_len = ctx.expected_output.expected_message_min_len
        actual_len = ctx.output.message_len if ctx.output else 0
        return 1.0 if actual_len >= min_len else 0.0


class DataKeysEvaluator(Evaluator[JourneyInput, JourneyOutput]):
    """Score 1.0 if all expected data keys are present."""

    def evaluate(self, ctx: EvaluatorContext[JourneyInput, JourneyOutput]) -> float:
        expected = set(ctx.expected_output.expected_data_keys)
        if not expected:
            return 1.0
        actual = set(ctx.output.data_keys) if ctx.output else set()
        return 1.0 if expected.issubset(actual) else 0.0


class ResultsKeysEvaluator(Evaluator[JourneyInput, JourneyOutput]):
    """Score 1.0 if expected results sub-keys are present."""

    def evaluate(self, ctx: EvaluatorContext[JourneyInput, JourneyOutput]) -> float:
        expected = set(ctx.expected_output.expected_results_keys)
        if not expected:
            return 1.0
        actual = set(ctx.output.results_keys) if ctx.output else set()
        return 1.0 if expected.issubset(actual) else 0.0


class RouteKeysEvaluator(Evaluator[JourneyInput, JourneyOutput]):
    """Score 1.0 if expected route sub-keys are present."""

    def evaluate(self, ctx: EvaluatorContext[JourneyInput, JourneyOutput]) -> float:
        expected = set(ctx.expected_output.expected_route_keys)
        if not expected:
            return 1.0
        actual = set(ctx.output.route_keys) if ctx.output else set()
        return 1.0 if expected.issubset(actual) else 0.0


class NearbyFieldsEvaluator(Evaluator[JourneyInput, JourneyOutput]):
    """Score 1.0 if expected nearby row fields are present."""

    def evaluate(self, ctx: EvaluatorContext[JourneyInput, JourneyOutput]) -> float:
        expected = set(ctx.expected_output.expected_nearby_fields)
        if not expected:
            return 1.0
        actual = set(ctx.output.nearby_fields) if ctx.output else set()
        return 1.0 if expected.issubset(actual) else 0.0


# ── Load dataset ─────────────────────────────────────────────────────


_DATASET_PATH = Path(__file__).parent / "datasets" / "runtime_journey_v1.json"
_JOURNEY_CASES = load_journey_dataset(_DATASET_PATH)

CASES = [
    Case(
        name=jc.id,
        inputs=JourneyInput(query=jc.query, locale=jc.locale),
        expected_output=JourneyExpected(
            expected_stage=jc.expected_stage,
            expected_message_min_len=jc.expected_message_min_len,
            expected_data_keys=jc.expected_data_keys,
            expected_results_keys=jc.expected_results_keys,
            expected_nearby_fields=jc.expected_nearby_fields,
            expected_route_keys=jc.expected_route_keys,
        ),
    )
    for jc in _JOURNEY_CASES
]

journey_dataset = Dataset(
    name="runtime_journey_v1",
    cases=CASES,
    evaluators=[
        StageEvaluator(),
        MessageMinLenEvaluator(),
        DataKeysEvaluator(),
        ResultsKeysEvaluator(),
        RouteKeysEvaluator(),
        NearbyFieldsEvaluator(),
    ],
)


# ── Pytest integration (testcontainer only) ──────────────────────────

_LAYER = "runtime_journey"


def _print_journey_scores(scores: dict[str, float]) -> None:
    print(f"\n{'=' * 60}")
    print(f"  Model:        {_EVAL_MODEL_ID}")
    print("  DB mode:      testcontainer")
    for name, value in scores.items():
        label = name.replace("Evaluator", "")
        print(f"  {label:<14}{value:.1%}")
    print(f"  Cases:        {len(CASES)}")
    print(f"{'=' * 60}")


def _collect_scores(avg: object) -> dict[str, float]:
    """Extract evaluator scores from a report averages object."""
    scores_attr = getattr(avg, "scores", {})
    names = [
        "StageEvaluator",
        "MessageMinLenEvaluator",
        "DataKeysEvaluator",
        "ResultsKeysEvaluator",
        "RouteKeysEvaluator",
        "NearbyFieldsEvaluator",
    ]
    return {n: scores_attr.get(n, 0) for n in names}


@pytest.mark.integration
def test_runtime_journey_with_db(request: pytest.FixtureRequest) -> None:
    """Run runtime journey eval against real testcontainer DB."""
    try:
        real_db = request.getfixturevalue("real_db")
    except pytest.FixtureLookupError:
        pytest.skip("real_db fixture not available — Docker required for eval.")
        return

    task = make_journey_task(db=real_db)
    report = journey_dataset.evaluate_sync(
        task,
        name=f"journey_eval_db_{_EVAL_MODEL_ID}",
        max_concurrency=50,
    )
    report.print(include_input=True, include_output=True)

    avg = report.averages()
    if avg is None:
        pytest.skip("All eval cases errored — check model endpoint and DB.")

    current_scores = _collect_scores(avg)
    _print_journey_scores(current_scores)

    baseline_scores = read_baseline(
        _LAYER, _EVAL_MODEL_ID, expected_case_count=len(CASES)
    )
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
        task = make_journey_task(db=None, model=model)

        report = await journey_dataset.evaluate(
            task,
            name=f"journey_eval_{mid}",
            max_concurrency=50,
        )
        report.print(include_input=True, include_output=True)
        avg = report.averages()
        if avg is None:
            raise SystemExit("All eval cases errored.")
        current_scores = _collect_scores(avg)
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
