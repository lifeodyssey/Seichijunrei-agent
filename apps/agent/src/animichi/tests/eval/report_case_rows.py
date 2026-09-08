"""One finished evaluation report, projected into the results file's rows.

Split out of ``exec_tiers.py`` (#1493). ``exec_tiers`` owns the execution tier
and writes the file; this module owns the reading of a pydantic-evals report —
every scored case, every failure, and the usage they add up to — into the
``results_payload`` models.
"""

from __future__ import annotations

from typing import TypeVar

from pydantic_evals.reporting import EvaluationReport, ReportCase, ReportCaseFailure

from animichi.agents.agent_result import AgentResult
from animichi.interfaces.public_api import detect_language
from animichi.tests.eval.results_payload import CaseRow, UsageRow, UsageSummary

InputsT = TypeVar("InputsT")
OutputT = TypeVar("OutputT")
MetadataT = TypeVar("MetadataT")


def collect_case_scores(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
) -> dict[str, dict[str, float]]:
    return {str(case.name): _case_scores(case) for case in report.cases}


def _score_value(score: object) -> float:
    value = getattr(score, "value", score)
    if isinstance(value, int | float | str | bytes | bytearray):
        return float(value)
    raise TypeError(f"Score is not numeric: {value!r}")


def _case_scores(case: ReportCase[InputsT, OutputT, MetadataT]) -> dict[str, float]:
    scores = case.scores
    if scores is None:
        return {}
    return {str(name): _score_value(score) for name, score in scores.items()}


def case_rows(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
) -> list[CaseRow]:
    rows = [_success_row(case) for case in report.cases]
    rows.extend(_failure_row(failure) for failure in report.failures)
    return rows


def _success_row(case: ReportCase[InputsT, OutputT, MetadataT]) -> CaseRow:
    return _case_row(
        str(case.name),
        _case_scores(case),
        _case_reasons(case),
        None,
        case.output,
        case.inputs,
        case.metadata,
    )


def _failure_row(
    failure: ReportCaseFailure[InputsT, OutputT, MetadataT],
) -> CaseRow:
    return _case_row(
        str(failure.name),
        None,
        None,
        failure.error_message,
        None,
        failure.inputs,
        failure.metadata,
    )


def _case_row(
    case_id: str,
    scores: dict[str, float] | None,
    reasons: dict[str, str] | None,
    error: str | None,
    output: object | None,
    inputs: object | None,
    metadata: object | None,
) -> CaseRow:
    return CaseRow(
        id=case_id,
        scores=scores,
        reasons=reasons,
        error=error,
        intent=_output_intent(output),
        message=_output_message(output),
        message_locale=_output_locale(output),
        steps=_output_steps(output),
        step_count=_output_step_count(output),
        query=_input_query(inputs),
        locale=_input_locale(inputs),
        expected_stages=_expected_stages(metadata),
        usage=_output_usage(output),
    )


def _output_usage(output: object | None) -> UsageRow | None:
    if not isinstance(output, AgentResult) or output.usage is None:
        return None
    return UsageRow(
        input_tokens=output.usage.input_tokens,
        output_tokens=output.usage.output_tokens,
        requests=output.usage.requests,
    )


def aggregate_usage(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
) -> UsageSummary:
    usages = [_output_usage(case.output) for case in report.cases]
    present = [usage for usage in usages if usage is not None]
    return UsageSummary(
        input_tokens=sum(usage.input_tokens for usage in present),
        output_tokens=sum(usage.output_tokens for usage in present),
        requests=sum(usage.requests for usage in present),
        cases_with_usage=len(present),
    )


def _case_reasons(
    case: ReportCase[InputsT, OutputT, MetadataT],
) -> dict[str, str] | None:
    scores = case.scores
    if scores is None:
        return None
    reasons = {
        str(name): reason
        for name, score in scores.items()
        if (reason := _score_reason(score))
    }
    return reasons or None


def _score_reason(score: object) -> str | None:
    reason = getattr(score, "reason", None)
    return reason if isinstance(reason, str) else None


def _output_intent(result: object | None) -> str | None:
    return result.intent if isinstance(result, AgentResult) else None


def _output_message(output: object | None) -> str | None:
    if not isinstance(output, AgentResult):
        return None
    return output.message[:200]


def _output_locale(output: object | None) -> str | None:
    message = _output_message(output)
    return detect_language(message) if message else None


def _output_steps(output: object | None) -> list[str] | None:
    if not isinstance(output, AgentResult):
        return None
    return [step.tool for step in output.steps]


def _output_step_count(output: object | None) -> int | None:
    return len(output.steps) if isinstance(output, AgentResult) else None


def _input_query(inputs: object | None) -> str | None:
    query = getattr(inputs, "query", None)
    return query[:100] if isinstance(query, str) else None


def _input_locale(inputs: object | None) -> str | None:
    locale = getattr(inputs, "locale", None)
    return locale if isinstance(locale, str) else None


def _expected_stages(expected: object | None) -> list[str] | None:
    stages = getattr(expected, "acceptable_stages", None)
    return [str(stage) for stage in stages] if isinstance(stages, list) else None
