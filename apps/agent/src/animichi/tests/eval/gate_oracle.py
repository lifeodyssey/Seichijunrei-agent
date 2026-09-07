"""The gate half of the oracle the TypeScript port is pinned against.

``bootstrap_gate`` and ``error_rate_gate`` run here for real — over a synthetic
record, over a five-case record that trips the ``min_paired`` short circuit, and
over the committed 662-case baseline with its behaviour strata — so the TS gate
is measured against Python's failures and warnings verbatim.

Written through ``stats_oracle.py``, the module that owns the output file.
"""

from __future__ import annotations

from collections.abc import Mapping

from animichi.tests.eval.baseline_oracle import (
    EVAL_DIR,
    collected_warnings,
    error_baseline,
    real_baseline,
    record_json,
    synthetic_record,
)
from animichi.tests.eval.gate import (
    BaselineRecord,
    CaseScores,
    bootstrap_gate,
    error_rate_gate,
)
from animichi.tests.eval.stats import load_case_strata

DATASET_PATH = EVAL_DIR / "datasets" / "agent_eval_v3.json"
SUBSET_SIZE = 40
#: The bootstrap iteration count the whole oracle pins, as ``test_stats.py`` does.
ORACLE_ITERATIONS = 500


def _zeroed_cases(record: BaselineRecord) -> dict[str, dict[str, float]]:
    return {
        case_id: dict.fromkeys(scores, 0.0) for case_id, scores in record.cases.items()
    }


def _gate_case(
    name: str,
    current: CaseScores,
    baseline: BaselineRecord,
    strata: Mapping[str, str],
) -> dict[str, object]:
    with collected_warnings() as warnings:
        failures = bootstrap_gate(
            current, baseline, iterations=ORACLE_ITERATIONS, strata=strata
        )
    return {
        "name": name,
        "current_cases": current,
        "baseline": record_json(baseline),
        "strata": dict(strata),
        "iterations": ORACLE_ITERATIONS,
        "min_paired": 10,
        "failures": failures,
        "warnings": warnings,
    }


def _subset_current(record: BaselineRecord) -> dict[str, dict[str, float]]:
    """The real baseline's first cases, with one metric driven to zero."""
    case_ids = sorted(record.cases)[:SUBSET_SIZE]
    return {
        case_id: {**record.cases[case_id], "tool_correctness": 0.0}
        for case_id in case_ids
    }


def _real_gate_case() -> dict[str, object]:
    record = real_baseline()
    current = _subset_current(record)
    strata = load_case_strata(DATASET_PATH).by_case
    subset = {case_id: strata[case_id] for case_id in current}
    return _gate_case("real_baseline_subset", current, record, subset)


def _gate_cases() -> list[dict[str, object]]:
    overlap = [1.0] * 10 + [-1.0] * 10
    indeterminate = synthetic_record(overlap)
    few = synthetic_record([1.0] * 5)
    return [
        _gate_case(
            "indeterminate",
            _zeroed_cases(indeterminate),
            indeterminate,
            {f"case-{index}": f"path-{index % 2}" for index in range(20)},
        ),
        _gate_case("few_pairs", _zeroed_cases(few), few, {}),
        _real_gate_case(),
    ]


def _error_rate_case(
    name: str, errored: int, total: int, baseline: BaselineRecord | None
) -> dict[str, object]:
    with collected_warnings() as warnings:
        failures = error_rate_gate(errored, total, baseline)
    return {
        "name": name,
        "current_errored": errored,
        "current_total": total,
        "baseline": None if baseline is None else record_json(baseline),
        "min_effect": 0.02,
        "failures": failures,
        "warnings": warnings,
    }


def _error_rate_cases() -> list[dict[str, object]]:
    clean = error_baseline(50, 0)
    return [
        _error_rate_case("over_ceiling", 21, 100, clean),
        _error_rate_case("empty_run", 0, 0, clean),
        _error_rate_case("at_ceiling_regression", 20, 100, clean),
        _error_rate_case("no_baseline", 1, 100, None),
        _error_rate_case("empty_baseline", 1, 100, error_baseline(0, 0)),
        _error_rate_case("steady", 5, 662, real_baseline()),
    ]


def gate_sections() -> dict[str, object]:
    """Every reference value drawn from the two gates."""
    return {
        "bootstrap_gates": _gate_cases(),
        "error_rate_gates": _error_rate_cases(),
    }
