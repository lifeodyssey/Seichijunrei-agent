"""Statistical baseline gate for eval reports.

The record itself is ``baseline_record.py`` and one metric's comparison against
it is ``metric_gate.py`` (#1499); what stays here is the record's lifecycle —
where it lives, whether it is still usable, what it looks like on disk — plus
the two gates a caller runs over a finished report.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from pathlib import Path

from pydantic import ValidationError

from animichi.tests.eval.baseline_record import BaselineRecord
from animichi.tests.eval.evaluator_version import EVALUATOR_VERSION
from animichi.tests.eval.metric_gate import (
    CaseScores,
    GateContext,
    GateOptions,
    comparison_failure,
    metric_failures,
)
from animichi.tests.eval.stats import proportion_comparison

logger = logging.getLogger(__name__)

__all__ = [
    "BaselineRecord",
    "CaseScores",
    "baseline_path",
    "bootstrap_gate",
    "error_rate_gate",
    "read_baseline_record",
    "write_baseline_record",
]


def baseline_path(layer: str, model_id: str, baselines_dir: Path) -> Path:
    safe_model = model_id.replace(":", "-").replace("@", "-").replace("/", "-")
    return baselines_dir / f"{layer}_{safe_model}.json"


def read_baseline_record(
    layer: str,
    model_id: str,
    *,
    baselines_dir: Path,
    expected_case_count: int | None = None,
    expected_metrics: Sequence[str] | None = None,
) -> BaselineRecord | None:
    path = baseline_path(layer, model_id, baselines_dir)
    if not path.exists():
        _warn_missing(layer, model_id, path)
        return None
    record = _load_record(path, layer, model_id)
    if record is None or _scored_by_another_evaluator(record, path, layer, model_id):
        return None
    if _is_stale(record, expected_case_count, expected_metrics, layer, model_id):
        return None
    return record


def write_baseline_record(
    record: BaselineRecord,
    *,
    layer: str,
    model_id: str,
    baselines_dir: Path,
) -> Path:
    baselines_dir.mkdir(parents=True, exist_ok=True)
    path = baseline_path(layer, model_id, baselines_dir)
    path.write_text(record.model_dump_json(indent=2) + "\n")
    return path


def bootstrap_gate(
    current_cases: CaseScores,
    baseline: BaselineRecord,
    *,
    iterations: int = 2000,
    confidence: float = 0.95,
    seed: int = 309,
    min_effect: float = 0.01,
    min_paired: int = 10,
    strata: Mapping[str, str] | None = None,
    starved: frozenset[str] = frozenset(),
) -> list[str]:
    options = GateOptions(iterations, confidence, min_effect, min_paired, seed)
    return metric_failures(
        GateContext(current_cases, baseline, strata or {}, starved, options)
    )


def error_rate_gate(
    current_errored: int,
    current_total: int,
    baseline: BaselineRecord | None,
    *,
    iterations: int = 2000,
    confidence: float = 0.95,
    seed: int = 309,
    min_effect: float = 0.02,
) -> list[str]:
    ceiling_failure = _absolute_error_rate_failure(current_errored, current_total)
    if ceiling_failure is not None:
        return [ceiling_failure]
    if baseline is None:
        return []
    if _has_zero_error_total(current_total, baseline):
        logger.warning("Skipping error_rate: zero total cases")
        return []
    baseline_total = baseline.evaluated_count + baseline.errored_count
    comparison = proportion_comparison(
        current_errored,
        current_total,
        baseline.errored_count,
        baseline_total,
        confidence=confidence,
        min_effect=min_effect,
    )
    failure = comparison_failure("error_rate", comparison)
    return [] if failure is None else [failure]


def _absolute_error_rate_failure(errored: int, total: int) -> str | None:
    """Fail uncapped runs when more than 20% of cases error, baseline-independent."""
    error_rate = errored / total if total > 0 else 1.0
    if error_rate <= 0.20:
        return None
    return (
        f"{errored}/{total} cases errored ({error_rate:.0%}). "
        "Check API key and model endpoint."
    )


def _load_record(path: Path, layer: str, model_id: str) -> BaselineRecord | None:
    try:
        return BaselineRecord.model_validate_json(path.read_text())
    except ValidationError as exc:
        _warn_invalid_baseline(path, layer, model_id, exc)
        return None


def _warn_invalid_baseline(
    path: Path, layer: str, model_id: str, exc: ValidationError
) -> None:
    logger.warning("Invalid baseline for %s/%s at %s: %s", layer, model_id, path, exc)


def _scored_by_another_evaluator(
    record: BaselineRecord, path: Path, layer: str, model_id: str
) -> bool:
    """Refuse a record scored by a vocabulary this runner does not implement.

    Damage, not staleness: comparing ``official-v1`` numbers against
    ``official-v2`` ones manufactures regressions on exactly the metrics whose
    semantics moved. A record carrying no version is not judged — that is the
    shape of every record committed before the field existed, and of the
    translation tier's (#1303). ``baseline-store.ts`` decides the same and
    fails the run; this side warns and drops the record, its own convention
    for a baseline it cannot use.

    What the drop costs is one ungated run: a dropped record leaves
    ``_run_uncapped_gate`` with no baseline, so it compares nothing and offers
    the run it just finished to ``baseline_mint.mint_baseline``, stamped with
    this vocabulary. A version bump is therefore paid for once, by the next
    successful uncapped run — and only by a run with no starved case in it.
    """
    found = record.evaluator_version
    if found is None or found == EVALUATOR_VERSION:
        return False
    _warn_foreign_evaluator(path, layer, model_id, found)
    return True


def _warn_foreign_evaluator(path: Path, layer: str, model_id: str, found: str) -> None:
    logger.warning(
        "Invalid baseline for %s/%s at %s: scored by evaluator %s, "
        "this runner scores %s",
        layer,
        model_id,
        path,
        found,
        EVALUATOR_VERSION,
    )


def _warn_missing(layer: str, model_id: str, path: Path) -> None:
    logger.warning("Missing baseline for %s/%s at %s", layer, model_id, path)


def _is_stale(
    record: BaselineRecord,
    expected: int | None,
    expected_metrics: Sequence[str] | None,
    layer: str,
    model_id: str,
) -> bool:
    if expected is not None and _case_count_stale(record, expected, layer, model_id):
        return True
    if expected is not None and _evaluated_count_low(record, expected, layer, model_id):
        return True
    return _metric_vocabulary_stale(record, expected_metrics, layer, model_id)


def _metric_vocabulary_stale(
    record: BaselineRecord,
    expected: Sequence[str] | None,
    layer: str,
    model: str,
) -> bool:
    if expected is None:
        return False
    expected_set = set(expected)
    aggregate_current = set(record.scores) == expected_set
    cases_current = record.case_metrics == expected_set
    if aggregate_current and cases_current:
        return False
    logger.warning("Stale baseline for %s/%s: metric vocabulary changed", layer, model)
    return True


def _case_count_stale(
    record: BaselineRecord, expected: int, layer: str, model: str
) -> bool:
    if record.case_count == expected:
        return False
    _warn_stale_case_count(layer, model, expected, record.case_count)
    return True


def _evaluated_count_low(
    record: BaselineRecord, expected: int, layer: str, model: str
) -> bool:
    if record.evaluated_count >= expected * 0.80:
        return False
    _warn_low_evaluated(layer, model, record.evaluated_count, expected)
    return True


def _warn_stale_case_count(layer: str, model: str, expected: int, actual: int) -> None:
    logger.warning(
        "Stale baseline for %s/%s: expected %d cases, found %d",
        layer,
        model,
        expected,
        actual,
    )


def _warn_low_evaluated(layer: str, model: str, actual: int, expected: int) -> None:
    logger.warning(
        "Baseline for %s/%s has too few evaluated cases: %d < 80%% of %d",
        layer,
        model,
        actual,
        expected,
    )


def _has_zero_error_total(current_total: int, baseline: BaselineRecord) -> bool:
    baseline_total = baseline.evaluated_count + baseline.errored_count
    return current_total <= 0 or baseline_total <= 0
