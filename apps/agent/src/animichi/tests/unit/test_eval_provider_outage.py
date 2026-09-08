"""A starved run is refused as an outage, not reported as a missing metric.

The nightly of 2026-09-08 ran 662 cases against a gateway that had changed its
contract under it (#1477). Every turn came back as `ErrorResponseModel`, so
`OfficialArgumentCorrectness` scored nobody and the run died on
`Missing metric(s): argument_correctness` — naming the column the outage starved
instead of the outage. These cases pin both halves of the fix (#1496).
"""

from __future__ import annotations

from typing import cast

import pytest
from pydantic_evals.evaluators import EvaluationResult, EvaluatorSpec
from pydantic_evals.reporting import EvaluationReport, ReportCase

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_models import ErrorResponseModel, QAResponseModel
from animichi.agents.session_state import SessionState
from animichi.tests.eval.eval_harness import AgentReport
from animichi.tests.eval.evaluators import AgentExpected, AgentInput
from animichi.tests.eval.provider_outage import ProviderOutage, refuse_starved_run
from animichi.tests.eval.run_metric_names import run_metric_names
from animichi.tests.eval.run_scores import reported_scores

_MODEL = "openai:mimo-v2.5@https://opencode.ai/zen/go/v1"
_SCORED_BY_EVERY_TURN = {
    "tool_correctness": 1.0,
    "trajectory_match": 1.0,
    "max_tool_calls": 1.0,
    "data_keys_present": 1.0,
    "locale_match": 1.0,
    "nonempty_results": 1.0,
    "step_efficiency": 1.0,
}


def make_starved_result() -> AgentResult:
    """A turn the error boundary answered for: no model reply, no steps."""
    return AgentResult(
        output=ErrorResponseModel(message="Something went wrong on our side."),
        intent="error",
        session_state=SessionState(),
    )


def make_answered_result() -> AgentResult:
    return AgentResult(
        output=QAResponseModel(message="Kyoto has three filming locations."),
        intent="general_qa",
        session_state=SessionState(),
    )


def make_case(
    name: str, output: AgentResult, scores: dict[str, float]
) -> ReportCase[AgentInput, AgentResult, AgentExpected]:
    return ReportCase(
        name=name,
        inputs=AgentInput(query=name, locale="en"),
        metadata=None,
        expected_output=None,
        output=output,
        metrics={},
        attributes={},
        scores={
            metric: EvaluationResult(
                name=metric,
                value=value,
                reason=None,
                source=EvaluatorSpec(name=metric, arguments=None),
            )
            for metric, value in scores.items()
        },
        labels={},
        assertions={},
        task_duration=0.0,
        total_duration=0.0,
    )


def make_report(starved: int, answered: int) -> AgentReport:
    """A run of `starved` boundary answers and `answered` scored turns.

    A starved turn still scores seven of the eight columns — every evaluator but
    `argument_correctness` emits for a stepless turn — which is exactly what made
    the outage look like a metric bug.
    """
    cases = [
        make_case(f"starved-{index}", make_starved_result(), _SCORED_BY_EVERY_TURN)
        for index in range(starved)
    ] + [
        make_case(
            f"answered-{index}",
            make_answered_result(),
            {**_SCORED_BY_EVERY_TURN, "argument_correctness": 1.0},
        )
        for index in range(answered)
    ]
    return cast(AgentReport, EvaluationReport(name="outage", cases=cases))


def test_a_wholly_starved_run_is_refused_by_name() -> None:
    """Judged on the more forgiving of the two lanes, and refused even there."""
    with pytest.raises(ProviderOutage) as raised:
        reported_scores(make_report(starved=10, answered=0), _MODEL, is_capped=True)

    message = str(raised.value)
    assert "10/10 evaluated cases" in message
    assert "100% > 20%" in message
    assert _MODEL in message


def test_the_gate_is_what_refuses_a_starved_run() -> None:
    """The mutation: with the gate gone the same report scores seven green
    columns, which is the failure #1496 exists to stop."""
    report = make_report(starved=10, answered=0)

    scores = _scores_without_the_gate(report)

    assert sorted(scores) == sorted(_SCORED_BY_EVERY_TURN)


def _scores_without_the_gate(report: AgentReport) -> dict[str, float]:
    avg = report.averages()
    assert avg is not None
    return {
        name: float(avg.scores[name])
        for name in run_metric_names(report, has_nonempty_cases=True, l3_enabled=False)
    }


def test_a_capped_run_with_one_starved_case_in_ten_is_still_judged() -> None:
    report = make_report(starved=1, answered=9)

    refuse_starved_run(report, model_id=_MODEL, is_capped=True)
    scores = reported_scores(report, _MODEL, is_capped=True)

    assert "argument_correctness" in scores
    assert sorted(scores) == sorted([*_SCORED_BY_EVERY_TURN, "argument_correctness"])


def test_the_two_lanes_disagree_about_three_starved_in_a_hundred() -> None:
    """The PR lane judges the run; the lane that may mint a baseline will not.

    0.20 is a catastrophic backstop — at 662 cases it admits 132 starved ones —
    and the record an uncapped run writes is the floor every later run is
    compared against (#1499).
    """
    report = make_report(starved=3, answered=97)

    assert "argument_correctness" in reported_scores(report, _MODEL, is_capped=True)

    with pytest.raises(ProviderOutage) as raised:
        reported_scores(report, _MODEL, is_capped=False)

    assert "3/100 evaluated cases" in str(raised.value)
    assert "3% > 2%" in str(raised.value)


def test_a_column_nobody_scored_is_not_a_column_this_run_reports() -> None:
    report = make_report(starved=10, answered=0)

    names = run_metric_names(report, has_nonempty_cases=True, l3_enabled=False)

    assert "argument_correctness" not in names
    assert names == [
        "tool_correctness",
        "trajectory_match",
        "max_tool_calls",
        "data_keys_present",
        "locale_match",
        "nonempty_results",
        "step_efficiency",
    ]
