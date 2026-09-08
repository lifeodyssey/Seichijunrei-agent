"""The evidence a finished eval report gives the gates.

Split out of ``eval_gate_flow.py`` (#1493). Three readings of the same
pydantic-evals report — the trajectory each produced turn took, the errors the
failures classify into, and the assertion each case's stage expects — which
``eval_gate_flow`` assembles into a ``GateInput`` alongside the run's own
identity. Nothing here reads the harness's module state, so the flow module
stays the one place a test has to patch a run's shape.
"""

from __future__ import annotations

from pydantic_evals.reporting import EvaluationReport

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval.direct_gates import TrajectoryCase
from animichi.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    accepted_chains_for_case,
)
from animichi.tests.eval.smoke_errors import SmokeError, classify_error
from animichi.tests.eval.trajectory_assertions import TrajectoryExpectation

Report = EvaluationReport[AgentInput, AgentResult, AgentExpected]


def trajectory_expectations(report: Report) -> tuple[TrajectoryExpectation, ...]:
    return tuple(
        TrajectoryExpectation.from_case(
            TrajectoryCase.from_result(str(case.name), case.output),
            accepted_chains_for_case(case.metadata),
        )
        for case in report.cases
        if isinstance(case.output, AgentResult)
    )


def classified_errors(report: Report) -> tuple[SmokeError, ...]:
    return tuple(
        classify_error(str(failure.name), failure.error_message)
        for failure in report.failures
    )


def trajectory_cases(report: Report) -> tuple[TrajectoryCase, ...]:
    return tuple(
        TrajectoryCase.from_result(str(case.name), case.output)
        for case in report.cases
        if isinstance(case.output, AgentResult)
    )
