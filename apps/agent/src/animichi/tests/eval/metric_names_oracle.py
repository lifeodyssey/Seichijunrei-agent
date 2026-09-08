"""The metric-name parity section of the evaluator oracle (#1301, #1496).

`evaluator_oracle.py` owns the fixture file and the per-scenario scores;
this owns the one section that is about no scenario at all — Python's own
`metric_names` answer with each conditional column in turn unavailable. It is a
sibling of that module for the reason `gate_oracle.py` is a sibling of
`stats_oracle.py`: one file per thing the oracle publishes.

The last two rows are the per-RUN toggles (#1381, #1439, #1496). Publishing
Python's answer for them is what stops `packages/eval/test/metric-names.test.ts`
re-deriving the drop rule instead of comparing against it.
"""

from __future__ import annotations

from pydantic import BaseModel

from animichi.tests.eval.metric_names import metric_names


class MetricNamesSection(BaseModel):
    """`metric_names` with each conditional column in turn unavailable."""

    withNonemptyCases: list[str]
    withoutNonemptyCases: list[str]
    withoutParamsRecorded: list[str]
    withoutMeasuredSteps: list[str]


def metric_names_section() -> MetricNamesSection:
    return MetricNamesSection(
        withNonemptyCases=_named_metrics(),
        withoutNonemptyCases=_named_metrics(has_nonempty_cases=False),
        withoutParamsRecorded=_named_metrics(has_params_recorded=False),
        withoutMeasuredSteps=_named_metrics(has_measured_steps=False),
    )


def _named_metrics(
    *,
    has_nonempty_cases: bool = True,
    has_params_recorded: bool = True,
    has_measured_steps: bool = True,
) -> list[str]:
    """Every column available but the one this oracle row takes away."""
    return metric_names(
        has_nonempty_cases=has_nonempty_cases,
        has_params_recorded=has_params_recorded,
        has_measured_steps=has_measured_steps,
        l3_enabled=False,
    )
