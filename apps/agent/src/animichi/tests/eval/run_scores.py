"""The score map one finished eval run reports, and what comes before it.

Extracted from ``eval_gate_flow`` (#1496) because the order of the three steps
is the fix: a run is refused as a provider outage FIRST, then refused for having
evaluated nothing, and only then are the columns this run actually computed
pulled out of the aggregate. The old order asked for a fixed list of columns and
let the first missing one speak for the run, which is how a starved nightly
reported itself as ``Missing metric(s): argument_correctness``.

``is_capped`` reaches the outage gate from here rather than from
``eval_harness``: the run mode picks which of ``provider_outage``'s two ceilings
the run is judged against, and this is the one place that already knows it
(#1499).
"""

from __future__ import annotations

from typing import TypeAlias

from animichi.tests.eval.eval_harness import EVAL_L3, HAS_NONEMPTY_CASES, AgentReport
from animichi.tests.eval.eval_report import collect_scores
from animichi.tests.eval.provider_outage import refuse_starved_run
from animichi.tests.eval.run_metric_names import run_metric_names

ScoreMap: TypeAlias = dict[str, float]


class NoEvaluatedCases(RuntimeError):
    """Raised when every eval case failed during task execution."""


def scores_for_run(report: AgentReport, model_id: str, *, is_capped: bool) -> ScoreMap:
    """A capped run may evaluate nothing; an uncapped one that does is broken."""
    try:
        return reported_scores(report, model_id, is_capped=is_capped)
    except NoEvaluatedCases:
        if is_capped:
            return {}
        raise


def reported_scores(report: AgentReport, model_id: str, *, is_capped: bool) -> ScoreMap:
    """This run's averages, under the columns this run could compute."""
    refuse_starved_run(report, model_id=model_id, is_capped=is_capped)
    avg = report.averages()
    if avg is None:
        raise NoEvaluatedCases("All cases errored — check model endpoint and DB.")
    return collect_scores(avg, _run_metrics(report))


def _run_metrics(report: AgentReport) -> list[str]:
    return run_metric_names(
        report, has_nonempty_cases=HAS_NONEMPTY_CASES, l3_enabled=EVAL_L3
    )
