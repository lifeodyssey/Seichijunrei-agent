"""Eval tests for frontend flow scenarios -- TDD RED phase.

Tests planner's ability to handle clarify, nearby, greet, and QA intents
triggered by the new frontend flows.

Run: make test-eval (or pytest backend/tests/eval/test_frontend_flows.py -v)
Requires: LLM API key (GEMINI_API_KEY or OPENAI_API_KEY)
"""

from __future__ import annotations

from pathlib import Path

import pytest

from backend.tests.eval.eval_common import EvalCase, load_dataset

DATASET_PATH = Path(__file__).parent / "datasets" / "frontend_flows_v1.json"
INTENT_GATE = 0.9  # 90% intent accuracy
STEP_GATE = 0.8  # 80% step sequence accuracy


@pytest.fixture(scope="module")
def cases() -> list[EvalCase]:
    return load_dataset(DATASET_PATH)


@pytest.fixture(scope="module")
def results(cases: list[EvalCase]) -> list[object]:
    """Run all cases through the planner and collect results."""
    try:
        from backend.agents.pipeline import ReActPipeline  # noqa: F401
    except ImportError:
        pytest.skip("Backend not available")

    # RED phase: return empty results until wired to real planner
    return []


def test_dataset_loads(cases: list[EvalCase]) -> None:
    """Verify the dataset file is valid and has expected structure."""
    assert len(cases) >= 10
    for case in cases:
        assert case.id
        assert case.query
        assert case.locale in ("ja", "zh", "en")
        assert len(case.expected_steps) > 0
        assert case.expected_intent


def test_intent_gate() -> None:
    """Intent accuracy gate -- must pass >= 90%."""
    pytest.skip("RED phase -- run with real planner to measure intent accuracy")


def test_step_gate() -> None:
    """Step sequence accuracy gate -- must pass >= 80%."""
    pytest.skip("RED phase -- run with real planner to measure step accuracy")


def test_clarify_precision() -> None:
    """Ambiguous input must trigger clarify, not search_bangumi."""
    pytest.skip("RED phase -- run with real planner to verify clarify precision")
