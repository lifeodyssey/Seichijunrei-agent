"""The metric names a run reports, in the order the report tables carry them.

Twin of ``packages/eval/src/metric-names.ts``. Order matters: the baseline
files, the gate and the printed table are all keyed positionally off this list,
so the two ports have to agree name for name and slot for slot. The committed
dump in ``packages/eval/fixtures/evaluator-oracle.json`` — written from this
function by ``evaluator_oracle.py`` — is what proves they do.

Three columns are conditional, and the condition is not the same kind of thing
in all three:

``nonempty_results`` is a per-DATASET toggle. Without an ``expect_nonempty``
case the evaluator returns ``{}`` for every case, so the column would be
permanently empty rather than zero.

``argument_correctness`` and ``step_efficiency`` are per-RUN toggles, and
nothing in the cases decides them. ``OfficialArgumentCorrectness`` scores
nothing for a turn with no successful model-initiated step, and
``StepEfficiency`` scores nothing for a turn that took no step on a case whose
every acceptable ideal is at least one (#1439) — a ratio with no denominator.
A run in which that is true of EVERY case computed the metric for nobody, and
keeping the column then makes ``collect_scores`` raise ``Missing metric(s)``
and take the other seven down with it. ``run_metric_names`` reads the two facts
off the finished report; this module only takes the decisions.
"""

from __future__ import annotations

from dataclasses import dataclass

_OFFICIAL_METRIC_NAMES = [
    "argument_correctness",
    "tool_correctness",
    "trajectory_match",
    "max_tool_calls",
]
_KEPT_METRIC_NAMES = [
    "data_keys_present",
    "locale_match",
    "nonempty_results",
    "step_efficiency",
]
_RUN_METRIC_NAMES = [*_OFFICIAL_METRIC_NAMES, *_KEPT_METRIC_NAMES]
#: The L3 outcome judges, appended only when ``EVAL_L3`` opts them in.
_L3_METRIC_NAMES = ["task_completion", "hallucination_check"]


@dataclass(frozen=True)
class ReportableColumns:
    """Which of the three conditional columns this run can report at all."""

    has_nonempty_cases: bool
    has_params_recorded: bool
    has_measured_steps: bool

    def keeps(self, name: str) -> bool:
        if name == "nonempty_results":
            return self.has_nonempty_cases
        if name == "argument_correctness":
            return self.has_params_recorded
        if name == "step_efficiency":
            return self.has_measured_steps
        return True


def metric_names(
    *,
    has_nonempty_cases: bool,
    has_params_recorded: bool,
    has_measured_steps: bool,
    l3_enabled: bool,
) -> list[str]:
    """The columns a run with these facts reports, in reporting order."""
    columns = ReportableColumns(
        has_nonempty_cases, has_params_recorded, has_measured_steps
    )
    names = [name for name in _RUN_METRIC_NAMES if columns.keeps(name)]
    return [*names, *_L3_METRIC_NAMES] if l3_enabled else names
