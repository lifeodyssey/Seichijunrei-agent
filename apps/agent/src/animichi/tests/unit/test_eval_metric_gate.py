"""Too few paired cases: a small sample, or a run the provider starved (#1499).

``_paired_scores`` drops every shared case that does not carry the metric, so a
starved run reaches the gate as a metric with almost no pairs. Warning about it
— the one answer the gate used to give — lets an outage past the door #1496
shut, because a run under ``BASELINE_LANE_CEILING`` is judgeable and still
carries enough starved cases to empty a column.
"""

from __future__ import annotations

import logging

from animichi.tests.eval.baseline_record import BaselineRecord
from animichi.tests.eval.gate import bootstrap_gate

_METRIC = "argument_correctness"
#: A column every turn scores, a boundary answer included — what a starved case
#: carries instead of the one the baseline is pairing on.
_SURVIVING_METRIC = "tool_correctness"


def make_baseline(count: int) -> BaselineRecord:
    return BaselineRecord(
        model="m",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=count,
        evaluated_count=count,
        scores={_METRIC: 1.0},
        cases={_case_id(index): {_METRIC: 1.0} for index in range(count)},
    )


def make_run(count: int, starved: int) -> dict[str, dict[str, float]]:
    """The first ``starved`` cases came back as the boundary's payload."""
    return {
        _case_id(index): {_SURVIVING_METRIC: 1.0} if index < starved else {_METRIC: 1.0}
        for index in range(count)
    }


def make_starved_ids(starved: int) -> frozenset[str]:
    return frozenset(_case_id(index) for index in range(starved))


def _case_id(index: int) -> str:
    return f"case-{index:03d}"


def test_starvation_fails_the_metric_it_emptied() -> None:
    failures = bootstrap_gate(
        make_run(20, 12), make_baseline(20), starved=make_starved_ids(12)
    )

    assert failures == [
        f"{_METRIC}: only 8 paired cases, need 10 — 12 of the missing pairs "
        "came back as the agent's error payload. Starvation, not a small "
        "sample: this metric is unproven, not skipped."
    ]


def test_a_genuinely_small_sample_is_still_only_a_warning(
    caplog: logging.LogCaptureFixture,
) -> None:
    """The other branch, and the control for the one above: fail on starvation
    alone, and a five-case run is skipped with a logged line as before."""
    with caplog.at_level(logging.WARNING, logger="animichi.tests.eval.metric_gate"):
        failures = bootstrap_gate(make_run(5, 0), make_baseline(5))

    assert failures == []
    assert "only 5 paired cases" in caplog.text


def test_a_starved_case_the_baseline_never_knew_is_not_a_shortfall() -> None:
    """It could not have paired anyway, so it says nothing about the sample."""
    run = {**make_run(5, 0), "unseen": {_SURVIVING_METRIC: 1.0}}

    failures = bootstrap_gate(run, make_baseline(5), starved=frozenset({"unseen"}))

    assert failures == []
