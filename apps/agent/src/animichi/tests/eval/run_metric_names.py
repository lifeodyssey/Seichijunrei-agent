"""The metric columns ONE finished eval run can report (#1496).

Twin of ``packages/eval/src/gate-run/run-metric-names.ts``. ``metric_names`` is
the shared decision — the list and its three toggles, pinned against the TS port
by ``evaluator-oracle.json`` — and this is where the facts behind the two
per-RUN toggles are read.

Python had no equivalent until now, and reached the state the toggles exist for
on 2026-09-08: the zen/go gateway contract changed under the nightly (#1477),
``error_boundary._on_run_error`` turned every unclassified failure into a clean
``ErrorResponseModel`` result, and so not one of the 662 cases recorded a
successful model-initiated step. ``OfficialArgumentCorrectness`` scored nobody,
the aggregate simply lacked the key, and ``collect_scores`` reported a total
provider outage as ``Missing metric(s): argument_correctness``.

The emitted SCORE is read rather than the rule re-derived, as the TS twin does
for ``step_efficiency``: each evaluator owns when its own metric applies, and a
second copy of that decision here would be a second place for it to be wrong.
That is also why this reads the report rather than ``StepRecord.params_recorded``
the way the TS side reads ``TranscriptResult.paramsRecorded`` — in process the
score IS the record of whether the metric was computed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from animichi.tests.eval.metric_names import metric_names

if TYPE_CHECKING:
    from animichi.tests.eval.eval_harness import AgentReport


def run_metric_names(
    report: AgentReport, *, has_nonempty_cases: bool, l3_enabled: bool
) -> list[str]:
    """This run's own columns: the dataset's list minus what nobody scored."""
    return metric_names(
        has_nonempty_cases=has_nonempty_cases,
        has_params_recorded=_any_case_scored(report, "argument_correctness"),
        has_measured_steps=_any_case_scored(report, "step_efficiency"),
        l3_enabled=l3_enabled,
    )


def _any_case_scored(report: AgentReport, metric: str) -> bool:
    """One case is enough: the column is then a real measurement of that case."""
    return any(metric in case.scores for case in report.cases)
