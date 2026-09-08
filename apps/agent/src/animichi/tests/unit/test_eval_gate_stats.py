"""Unit tests for eval bootstrap gate statistics."""

from __future__ import annotations

import logging

from animichi.tests.eval.gate import BaselineRecord, bootstrap_gate, error_rate_gate


def _cases(count: int, score: float) -> dict[str, dict[str, float]]:
    return {f"case-{idx:03d}": {"Accuracy": score} for idx in range(count)}


def _record(cases: dict[str, dict[str, float]]) -> BaselineRecord:
    return BaselineRecord(
        model="m",
        dataset="agent_eval_v3",
        tier="fullstack",
        case_count=len(cases),
        evaluated_count=len(cases),
        scores={"Accuracy": 1.0},
        cases=cases,
    )


def _error_record(errored_count: int, evaluated_count: int) -> BaselineRecord:
    return BaselineRecord(
        model="m",
        dataset="agent_eval_v3",
        tier="fullstack",
        case_count=evaluated_count + errored_count,
        evaluated_count=evaluated_count,
        errored_count=errored_count,
        scores={"Accuracy": 1.0},
        cases={},
    )


def test_flags_clear_regression() -> None:
    failures = bootstrap_gate(_cases(50, 0.0), _record(_cases(50, 1.0)))

    assert len(failures) == 1
    assert "Accuracy" in failures[0]
    assert "n=50" in failures[0]


def test_identical_scores_pass() -> None:
    failures = bootstrap_gate(_cases(50, 1.0), _record(_cases(50, 1.0)))

    assert failures == []


def test_current_only_metric_is_ignored_by_baseline_comparison() -> None:
    current = _cases(50, 1.0)
    for scores in current.values():
        scores["argument_correctness"] = 0.0

    assert bootstrap_gate(current, _record(_cases(50, 1.0))) == []


def test_single_flip_among_many_is_not_significant() -> None:
    current = _cases(200, 1.0)
    current["case-000"] = {"Accuracy": 0.0}

    failures = bootstrap_gate(current, _record(_cases(200, 1.0)))

    assert failures == []


def test_skips_metric_with_too_few_shared_cases(
    caplog: logging.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="animichi.tests.eval.metric_gate"):
        failures = bootstrap_gate(_cases(5, 0.0), _record(_cases(5, 1.0)))

    assert failures == []
    assert "Accuracy" in caplog.text


def test_bootstrap_gate_is_deterministic() -> None:
    current = _cases(80, 0.9)
    baseline = _record(_cases(80, 1.0))

    first = bootstrap_gate(current, baseline)
    second = bootstrap_gate(current, baseline)

    assert first == second


def test_error_rate_gate_flags_review_regression_scenario() -> None:
    failures = error_rate_gate(108, 600, _error_record(12, 588))

    assert len(failures) == 1
    assert "error_rate" in failures[0]


def test_error_rate_gate_tolerates_small_error_rate_change() -> None:
    failures = error_rate_gate(18, 600, _error_record(12, 588))

    assert failures == []


def test_error_rate_gate_tolerates_identical_rates() -> None:
    failures = error_rate_gate(12, 600, _error_record(12, 588))

    assert failures == []


def test_error_rate_gate_is_deterministic() -> None:
    baseline = _error_record(12, 588)

    first = error_rate_gate(108, 600, baseline)
    second = error_rate_gate(108, 600, baseline)

    assert first == second


def test_error_rate_gate_skips_zero_total_baseline(
    caplog: logging.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="animichi.tests.eval.gate"):
        failures = error_rate_gate(1, 10, _error_record(0, 0))

    assert failures == []
    assert "zero total" in caplog.text


def test_bootstrap_gate_skips_aggregate_only_baseline(
    caplog: logging.LogCaptureFixture,
) -> None:
    baseline = _error_record(0, 50)

    with caplog.at_level(logging.WARNING, logger="animichi.tests.eval.metric_gate"):
        failures = bootstrap_gate(_cases(50, 0.0), baseline)

    assert failures == []
    assert "only 0 paired cases" in caplog.text
