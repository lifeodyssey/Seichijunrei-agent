"""Translation eval — validates anime title and place name translation quality.

Tests translate_title against a dataset of known correct translations.
Checks both exact match and fuzzy match (for minor variations).

Usage:
    uv run pytest backend/tests/eval/test_translation.py -v -m integration --no-cov
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import pytest
from dotenv import load_dotenv
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from backend.tests.eval.eval_common import (
    enforce_gate,
    read_baseline,
    write_baseline,
)

load_dotenv(Path(__file__).parents[3] / ".env")

# ── Case types ───────────────────────────────────────────────────────


@dataclass
class TranslationInput:
    title: str
    target_locale: str


@dataclass
class TranslationOutput:
    translated: str
    source: str
    confidence: float


@dataclass
class TranslationExpected:
    expected: str


# ── Task under test ──────────────────────────────────────────────────

_STATE: dict[str, object] = {"db": None}


async def evaluate_translation(inp: TranslationInput) -> TranslationOutput:
    """Run translate_title and capture the result."""
    from backend.agents.translation import translate_title

    result = await translate_title(
        inp.title,
        target_locale=inp.target_locale,
        db=_STATE["db"],
    )
    return TranslationOutput(
        translated=result.translated,
        source=result.source,
        confidence=result.confidence,
    )


# ── Evaluators ───────────────────────────────────────────────────────


class ExactMatchEvaluator(Evaluator[TranslationInput, TranslationOutput]):
    """Score 1.0 if translation exactly matches expected."""

    def evaluate(
        self, ctx: EvaluatorContext[TranslationInput, TranslationOutput]
    ) -> float:
        exp = ctx.expected_output
        expected = getattr(exp, "expected", "") if exp else ""
        actual = ctx.output.translated.strip() if ctx.output else ""
        return 1.0 if actual == str(expected).strip() else 0.0


class FuzzyMatchEvaluator(Evaluator[TranslationInput, TranslationOutput]):
    """Score 1.0 if translation contains or is contained by expected."""

    def evaluate(
        self, ctx: EvaluatorContext[TranslationInput, TranslationOutput]
    ) -> float:
        exp = ctx.expected_output
        expected = str(getattr(exp, "expected", "") if exp else "").strip().lower()
        actual = ctx.output.translated.strip().lower() if ctx.output else ""
        if actual == expected:
            return 1.0
        if expected in actual or actual in expected:
            return 0.8
        return 0.0


class NotOriginalEvaluator(Evaluator[TranslationInput, TranslationOutput]):
    """Score 1.0 if translation is different from the original input."""

    def evaluate(
        self, ctx: EvaluatorContext[TranslationInput, TranslationOutput]
    ) -> float:
        original = ctx.inputs.title.strip()
        translated = ctx.output.translated.strip() if ctx.output else ""
        exp = ctx.expected_output
        expected_str = str(getattr(exp, "expected", "") if exp else "").strip()
        if expected_str == original:
            return 1.0
        return 1.0 if translated != original else 0.0


# ── Load dataset ─────────────────────────────────────────────────────

_DATASET_PATH = Path(__file__).parent / "datasets" / "translation_v1.json"


def _load_cases() -> list[
    Case[TranslationInput, TranslationOutput, TranslationExpected]
]:
    raw = json.loads(_DATASET_PATH.read_text())
    return [
        Case(
            name=item["id"],
            inputs=TranslationInput(title=item["title"], target_locale=item["target"]),
            expected_output=TranslationExpected(expected=item["expected"]),
        )
        for item in raw
    ]


CASES = _load_cases()

translation_dataset = Dataset(
    name="translation_v1",
    cases=CASES,
    evaluators=[
        ExactMatchEvaluator(),
        FuzzyMatchEvaluator(),
        NotOriginalEvaluator(),
    ],
)

# ── Pytest integration ───────────────────────────────────────────────

_LAYER = "translation"


@pytest.mark.integration
def test_translation_quality(request: pytest.FixtureRequest) -> None:
    """Run translation eval against real testcontainer DB."""
    try:
        real_db = request.getfixturevalue("real_db")
        _STATE["db"] = real_db
    except pytest.FixtureLookupError:
        pytest.skip("real_db fixture not available — Docker required.")
        return

    try:
        report = translation_dataset.evaluate_sync(
            evaluate_translation,
            name="translation_eval",
            max_concurrency=20,
        )
    finally:
        _STATE["db"] = None

    report.print(include_input=True, include_output=True)

    avg = report.averages()
    if avg is None:
        pytest.skip("All translation cases errored.")

    exact = avg.scores.get("ExactMatchEvaluator", 0)
    fuzzy = avg.scores.get("FuzzyMatchEvaluator", 0)
    not_original = avg.scores.get("NotOriginalEvaluator", 0)

    current_scores = {
        "ExactMatchEvaluator": exact,
        "FuzzyMatchEvaluator": fuzzy,
        "NotOriginalEvaluator": not_original,
    }

    print(f"\n{'=' * 50}")
    print(f"  Exact match:    {exact:.1%}")
    print(f"  Fuzzy match:    {fuzzy:.1%}")
    print(f"  Not original:   {not_original:.1%}")
    print(f"  Cases:          {len(CASES)}")
    print(f"{'=' * 50}")

    baseline_scores = read_baseline(
        _LAYER, "translation", expected_case_count=len(CASES)
    )
    if not baseline_scores:
        write_baseline(_LAYER, "translation", current_scores, case_count=len(CASES))
        pytest.skip("Baseline created; re-run to enforce gate.")

    failures = enforce_gate(current_scores, baseline_scores)
    assert not failures, "Translation eval regression:\n" + "\n".join(failures)
