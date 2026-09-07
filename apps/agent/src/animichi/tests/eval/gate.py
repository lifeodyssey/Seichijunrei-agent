"""Statistical baseline gate for eval reports."""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError

from animichi.tests.eval.evaluator_version import EVALUATOR_VERSION
from animichi.tests.eval.stats import (
    UNSTRATIFIED,
    Comparison,
    PairedScore,
    proportion_comparison,
    stratified_paired_comparison,
)

logger = logging.getLogger(__name__)
CaseScores = Mapping[str, Mapping[str, float]]


class BaselineRecord(BaseModel):
    """Schema-v2 baseline with aggregate and per-case scores."""

    model_config = ConfigDict(frozen=True)

    schema_version: Literal[2] = 2
    model: str
    dataset: str
    tier: str
    #: The evaluator vocabulary that produced these numbers. Optional because
    #: the translation tier writes records with evaluators of its own and every
    #: record committed before 2026-09-07 predates the field, so
    #: ``read_baseline_record`` — which refuses a record naming any other
    #: vocabulary, at the cost of one ungated run that re-stamps this field —
    #: reads ``None`` as "this record cannot say" (#1303).
    evaluator_version: str | None = None
    repeat: int = 1
    case_count: int
    evaluated_count: int
    errored_count: int = 0
    scores: dict[str, float]
    cases: dict[str, dict[str, float]]
    note: str | None = None


@dataclass(frozen=True)
class _GateOptions:
    iterations: int
    confidence: float
    min_effect: float
    min_paired: int
    seed: int


@dataclass(frozen=True)
class _GateContext:
    current_cases: CaseScores
    baseline: BaselineRecord
    strata: Mapping[str, str]
    options: _GateOptions


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
) -> list[str]:
    options = _GateOptions(iterations, confidence, min_effect, min_paired, seed)
    ctx = _GateContext(current_cases, baseline, strata or {}, options)
    failures = _metric_failures(ctx)
    return [failure for failure in failures if failure is not None]


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
    failure = _comparison_failure("error_rate", comparison)
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


def _metric_failures(ctx: _GateContext) -> list[str | None]:
    return [_metric_failure(metric, ctx) for metric in _baseline_metrics(ctx.baseline)]


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
    ``_run_uncapped_gate`` with no baseline, so it compares nothing and writes
    the run it just finished back to the same path, stamped with this
    vocabulary (``eval_gate_flow.py::_write_baseline``). A version bump is
    therefore paid for once, by the next successful uncapped run.
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
    cases_current = _case_metrics(record) == expected_set
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


def _baseline_metrics(baseline: BaselineRecord) -> list[str]:
    return sorted(_case_metrics(baseline).union(baseline.scores))


def _case_metrics(baseline: BaselineRecord) -> set[str]:
    return {metric for scores in baseline.cases.values() for metric in scores}


def _metric_failure(metric: str, ctx: _GateContext) -> str | None:
    pairs = _paired_scores(ctx, metric)
    if len(pairs) < ctx.options.min_paired:
        _warn_few_pairs(metric, len(pairs), ctx.options.min_paired)
        return None
    comparison = _paired_comparison(pairs, ctx.options)
    return _comparison_failure(metric, comparison)


def _paired_scores(ctx: _GateContext, metric: str) -> list[PairedScore]:
    case_ids = sorted(set(ctx.baseline.cases).intersection(ctx.current_cases))
    return [
        _paired_score(ctx, metric, case_id)
        for case_id in case_ids
        if _has_metric(ctx, metric, case_id)
    ]


def _paired_score(ctx: _GateContext, metric: str, case_id: str) -> PairedScore:
    return PairedScore(
        ctx.baseline.cases[case_id][metric],
        ctx.current_cases[case_id][metric],
        ctx.strata.get(case_id, UNSTRATIFIED),
    )


def _paired_comparison(pairs: list[PairedScore], options: _GateOptions) -> Comparison:
    return stratified_paired_comparison(
        pairs,
        iterations=options.iterations,
        confidence=options.confidence,
        seed=options.seed,
        min_effect=options.min_effect,
    )


def _has_metric(ctx: _GateContext, metric: str, case_id: str) -> bool:
    return (
        metric in ctx.baseline.cases[case_id] and metric in ctx.current_cases[case_id]
    )


def _has_zero_error_total(current_total: int, baseline: BaselineRecord) -> bool:
    baseline_total = baseline.evaluated_count + baseline.errored_count
    return current_total <= 0 or baseline_total <= 0


def _comparison_failure(metric: str, comparison: Comparison) -> str | None:
    message = _format_comparison(metric, comparison)
    if comparison.verdict == "pass":
        return None
    if comparison.verdict == "indeterminate":
        logger.warning("INDETERMINATE %s", message)
        return None
    return message


def _format_comparison(metric: str, comparison: Comparison) -> str:
    interval = comparison.interval
    return (
        f"{metric}: mean_delta={comparison.estimate:.4f}, "
        f"ci=[{interval.lower:.4f}, {interval.upper:.4f}], "
        f"n={comparison.sample_size}, method={comparison.method}"
    )


def _warn_few_pairs(metric: str, paired: int, min_paired: int) -> None:
    logger.warning(
        "Skipping %s: only %d paired cases, need %d", metric, paired, min_paired
    )
