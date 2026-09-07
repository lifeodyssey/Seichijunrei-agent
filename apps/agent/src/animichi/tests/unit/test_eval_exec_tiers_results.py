from __future__ import annotations

from typing import TypeAlias

from pydantic_ai.usage import RunUsage
from pydantic_evals.evaluators import EvaluationResult, EvaluatorSpec
from pydantic_evals.reporting import (
    EvaluationReport,
    ReportCase,
    ReportCaseFailure,
)

from animichi.agents.agent_result import AgentResult
from animichi.agents.runtime_models import QAResponseModel
from animichi.agents.session_state import SessionState
from animichi.tests.eval.evaluators import AgentExpected, AgentInput
from animichi.tests.eval.exec_tiers import build_results_payload

_Case: TypeAlias = ReportCase[AgentInput, AgentResult, AgentExpected]
_Failure: TypeAlias = ReportCaseFailure[AgentInput, AgentResult, AgentExpected]
_Report: TypeAlias = EvaluationReport[AgentInput, AgentResult, AgentExpected]


def _score(
    name: str, value: int | float, reason: str | None
) -> EvaluationResult[int | float]:
    source = EvaluatorSpec(name="unit", arguments=None)
    return EvaluationResult(name=name, value=value, reason=reason, source=source)


def _result() -> AgentResult:
    output = QAResponseModel(message="Hello there")
    return AgentResult(
        output=output,
        intent="general_qa",
        session_state=SessionState(),
        steps=[],
        usage=RunUsage(input_tokens=12, output_tokens=4, requests=2),
    )


def _input() -> AgentInput:
    return AgentInput(query="Where?", locale="en")


def _expected() -> AgentExpected:
    return AgentExpected(acceptable_stages=["general_qa"])


def _case() -> _Case:
    return ReportCase(
        name="c1",
        inputs=_input(),
        metadata=_expected(),
        expected_output=None,
        output=_result(),
        metrics={},
        attributes={},
        scores=_scores(),
        labels={},
        assertions={},
        task_duration=0.1,
        total_duration=0.2,
    )


def _scores() -> dict[str, EvaluationResult[int | float]]:
    scores = {"task_completion": _score("task_completion", 1, "judge passed")}
    scores["tool_correctness"] = _score("tool_correctness", 0.5, None)
    scores["argument_correctness"] = _score("argument_correctness", 1, None)
    return scores


def _failure() -> _Failure:
    return ReportCaseFailure(
        name="f1",
        inputs=_input(),
        metadata=_expected(),
        expected_output=None,
        error_message="boom",
        error_stacktrace="trace",
    )


def _report() -> _Report:
    return EvaluationReport(name="eval", cases=[_case()], failures=[_failure()])


def test_build_results_payload_persists_failures_and_reasons() -> None:
    payload = build_results_payload(
        _report(),
        model_id="model/id",
        dataset="agent_eval_v3",
        tier="trajectory",
        case_count=2,
        scores={"task_completion": 1.0, "tool_correctness": 0.5},
    )
    assert payload.evaluator_version == "official-v2"
    assert payload.cases[0].reasons == {"task_completion": "judge passed"}
    assert payload.cases[0].scores == {
        "task_completion": 1.0,
        "tool_correctness": 0.5,
        "argument_correctness": 1.0,
    }
    assert payload.cases[0].expected_stages == ["general_qa"]
    assert payload.cases[1].error == "boom"
    assert payload.cases[1].expected_stages == ["general_qa"]
    assert payload.usage.model_dump() == {
        "input_tokens": 12,
        "output_tokens": 4,
        "requests": 2,
        "cases_with_usage": 1,
    }
    assert payload.cases[0].usage is not None
    assert payload.cases[0].usage.requests == 2
