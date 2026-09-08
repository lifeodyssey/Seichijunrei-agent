"""One baseline metric, compared against this run — and why it might not be.

Split out of ``gate.py`` (#1499), which was over the file cap and owed this
decision more room than a line ordering. ``_paired_scores`` drops every shared
case that does not carry the metric, so a run the provider starved arrives here
as a metric with too few pairs — and "too few pairs" used to have one answer, a
warning about a small sample. It has two. A sample that was always small is
noise and must not block; a sample that STARVATION emptied is a metric this run
cannot prove, and warning about it walks the outage straight past the door
#1496 shut. A run under ``provider_outage.BASELINE_LANE_CEILING`` still carries
starved cases — few enough for the run to be judged, more than enough to empty
one column — which is exactly the gap this file closes.

The two are told apart by counting, among the pairs the metric is missing, the
cases ``provider_outage.starved_case_ids`` named: a case that could not pair
because nobody answered it is not evidence about the sample size.

``comparison_failure`` lives here rather than in ``gate.py`` because both of its
callers are on this side of the import — the metric loop below, and
``error_rate_gate`` reading it back out.

Twin of ``packages/eval/src/gate/metric-gate.ts``; every sentence below is
pinned against it through ``stats-oracle.json``'s ``bootstrap_gates`` rows.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass

from animichi.tests.eval.baseline_record import BaselineRecord
from animichi.tests.eval.case_strata import UNSTRATIFIED
from animichi.tests.eval.stats import (
    Comparison,
    PairedScore,
    stratified_paired_comparison,
)

logger = logging.getLogger(__name__)
CaseScores = Mapping[str, Mapping[str, float]]


@dataclass(frozen=True)
class GateOptions:
    """The statistics one gate run is settled with."""

    iterations: int
    confidence: float
    min_effect: float
    min_paired: int
    seed: int


@dataclass(frozen=True)
class GateContext:
    """Everything a metric's verdict is drawn from."""

    current_cases: CaseScores
    baseline: BaselineRecord
    strata: Mapping[str, str]
    #: This run's starved cases (``provider_outage.starved_case_ids``): the ones
    #: whose absence from a metric's pairs is an outage, not a sample size.
    starved: frozenset[str]
    options: GateOptions


def metric_failures(ctx: GateContext) -> list[str]:
    """Every metric the baseline knows about, failures only."""
    verdicts = (_metric_failure(metric, ctx) for metric in _baseline_metrics(ctx))
    return [verdict for verdict in verdicts if verdict is not None]


def comparison_failure(metric: str, comparison: Comparison) -> str | None:
    """A losing verdict is the gate's sentence; the other two are logged."""
    message = _format_comparison(metric, comparison)
    if comparison.verdict == "pass":
        return None
    if comparison.verdict == "indeterminate":
        logger.warning("INDETERMINATE %s", message)
        return None
    return message


def starved_pairs_failure(
    metric: str, paired: int, min_paired: int, starved: int
) -> str:
    """Too few pairs, because the provider answered none of the missing ones."""
    return (
        f"{metric}: only {paired} paired cases, need {min_paired} — "
        f"{starved} of the missing pairs came back as the agent's error payload. "
        "Starvation, not a small sample: this metric is unproven, not skipped."
    )


def _baseline_metrics(ctx: GateContext) -> list[str]:
    return sorted(ctx.baseline.case_metrics.union(ctx.baseline.scores))


def _metric_failure(metric: str, ctx: GateContext) -> str | None:
    pairs = _paired_scores(ctx, metric)
    if len(pairs) < ctx.options.min_paired:
        return _few_pairs(metric, len(pairs), ctx)
    return comparison_failure(metric, _paired_comparison(pairs, ctx.options))


def _few_pairs(metric: str, paired: int, ctx: GateContext) -> str | None:
    """A small sample is skipped with a warning; a starved one is failed."""
    starved = _starved_missing_pairs(ctx, metric)
    if starved == 0:
        _warn_few_pairs(metric, paired, ctx.options.min_paired)
        return None
    return starved_pairs_failure(metric, paired, ctx.options.min_paired, starved)


def _starved_missing_pairs(ctx: GateContext, metric: str) -> int:
    """The shared cases this metric lost that the provider never answered."""
    return sum(
        1
        for case_id in ctx.starved.intersection(_shared_cases(ctx))
        if not _has_metric(ctx, metric, case_id)
    )


def _shared_cases(ctx: GateContext) -> list[str]:
    return sorted(set(ctx.baseline.cases).intersection(ctx.current_cases))


def _paired_scores(ctx: GateContext, metric: str) -> list[PairedScore]:
    return [
        _paired_score(ctx, metric, case_id)
        for case_id in _shared_cases(ctx)
        if _has_metric(ctx, metric, case_id)
    ]


def _paired_score(ctx: GateContext, metric: str, case_id: str) -> PairedScore:
    return PairedScore(
        ctx.baseline.cases[case_id][metric],
        ctx.current_cases[case_id][metric],
        ctx.strata.get(case_id, UNSTRATIFIED),
    )


def _paired_comparison(pairs: list[PairedScore], options: GateOptions) -> Comparison:
    return stratified_paired_comparison(
        pairs,
        iterations=options.iterations,
        confidence=options.confidence,
        seed=options.seed,
        min_effect=options.min_effect,
    )


def _has_metric(ctx: GateContext, metric: str, case_id: str) -> bool:
    return (
        metric in ctx.baseline.cases[case_id] and metric in ctx.current_cases[case_id]
    )


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
