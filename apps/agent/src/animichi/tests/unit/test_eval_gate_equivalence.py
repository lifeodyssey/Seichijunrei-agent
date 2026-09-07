"""Golden contract for the real report seam and both entry verdicts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest
from pydantic_evals.evaluators import EvaluationResult, EvaluatorSpec
from pydantic_evals.reporting import EvaluationReport, ReportCase, ReportCaseFailure

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval import eval_gate_flow
from animichi.tests.eval.eval_gate_flow import NoEvaluatedCases, finish_cli_report
from animichi.tests.eval.eval_harness import AgentReport
from animichi.tests.eval.evaluators import AgentExpected, AgentInput
from animichi.tests.eval.exec_tiers import CaseRow, EvalTierTarget, ResultsPayload
from animichi.tests.eval.gate import BaselineRecord, baseline_path
from animichi.tests.eval.run_agent_eval import _finish_report
from animichi.tests.eval.stats import CaseStrata
from animichi.tests.eval.test_agent_eval import _assert_report

_FIXTURES = Path(__file__).parent / "fixtures" / "eval_gate"
_MODEL = "fixture:model"
_LAYER = "agent_fixture"


def _fixture(name: str) -> tuple[ResultsPayload, str | None, bool]:
    raw = cast(dict[str, object], json.loads((_FIXTURES / f"{name}.json").read_text()))
    payload = ResultsPayload.model_validate(raw["results_payload"])
    baseline = raw.get("baseline")
    is_capped = raw.get("capped") is True
    return payload, json.dumps(baseline) if baseline is not None else None, is_capped


def _prepare_baseline(directory: Path, payload: str | None) -> None:
    if payload is None:
        return
    directory.mkdir(parents=True, exist_ok=True)
    baseline_path(_LAYER, _MODEL, directory).write_text(payload)


def _report_case(row: CaseRow) -> ReportCase[AgentInput, AgentResult, AgentExpected]:
    scores = {
        name: EvaluationResult(
            name=name,
            value=value,
            reason=None,
            source=EvaluatorSpec(name=name, arguments=None),
        )
        for name, value in (row.scores or {}).items()
    }
    inputs = AgentInput(query=row.query or str(row.id), locale=row.locale or "en")
    return ReportCase(
        name=str(row.id),
        inputs=inputs,
        metadata=None,
        expected_output=None,
        output=cast(AgentResult, object()),
        metrics={},
        attributes={},
        scores=scores,
        labels={},
        assertions={},
        task_duration=0.0,
        total_duration=0.0,
    )


def _report_failure(
    row: CaseRow,
) -> ReportCaseFailure[AgentInput, AgentResult, AgentExpected]:
    inputs = AgentInput(query=row.query or str(row.id), locale=row.locale or "en")
    return ReportCaseFailure(
        name=str(row.id),
        inputs=inputs,
        metadata=None,
        expected_output=None,
        error_message=row.error or "evaluation failed",
        error_stacktrace="fixture stacktrace",
    )


def _report(payload: ResultsPayload) -> AgentReport:
    cases = [_report_case(row) for row in payload.cases if row.scores is not None]
    failures = [_report_failure(row) for row in payload.cases if row.error is not None]
    return EvaluationReport(name="golden", cases=cases, failures=failures)


def _configure(
    monkeypatch: pytest.MonkeyPatch,
    directory: Path,
    payload: ResultsPayload,
    baseline: str | None,
    is_capped: bool,
) -> EvalTierTarget:
    directory.mkdir(parents=True, exist_ok=True)
    _prepare_baseline(directory, baseline)
    monkeypatch.setattr(eval_gate_flow, "BASELINES_DIR", directory)
    monkeypatch.setattr(eval_gate_flow, "RESULTS_DIR", directory / "results")
    monkeypatch.setattr(eval_gate_flow, "CASES", [object()] * payload.case_count)
    monkeypatch.setattr(eval_gate_flow, "ALL_CASES", [object()] * payload.case_count)
    monkeypatch.setattr(eval_gate_flow, "CAPPED", is_capped)
    monkeypatch.setattr(eval_gate_flow, "DATASET_NAME", payload.dataset)
    monkeypatch.setattr(eval_gate_flow, "METRIC_NAMES", list(payload.scores))
    return EvalTierTarget(object(), object, _LAYER, payload.tier, "fixture")


@pytest.fixture
def pooled_strata() -> CaseStrata:
    """The synthetic fixture cases are named by no dataset: one stratum."""
    return CaseStrata({}, [])


@pytest.mark.parametrize(
    ("fixture_name", "expected_failures", "expected_exit"),
    [
        ("clean_pass", [], 0),
        (
            "metric_regression",
            [
                "Accuracy: mean_delta=1.0000, ci=[1.0000, 1.0000], n=10, "
                "method=stratified-paired-bootstrap"
            ],
            1,
        ),
        # A regression the exact interval can separate from the baseline blocks.
        (
            "error_rate",
            [
                "error_rate: mean_delta=0.2000, ci=[0.0904, 0.2918], n=100, "
                "method=clopper-pearson"
            ],
            1,
        ),
        # AC: overlapping intervals are inconclusive, not an automatic block.
        # 4/20 vs 0/20 is not separable at 95%; the absolute 20% ceiling still
        # catches runs that are egregious regardless of the baseline.
        ("error_rate_inconclusive", [], 0),
        ("missing_baseline", None, 0),
        ("stale_baseline", None, 0),
        ("capped_run", [], 0),
        (
            "error_ceiling",
            ["5/20 cases errored (25%). Check API key and model endpoint."],
            1,
        ),
    ],
)
def test_finish_cli_report_golden_and_entry_verdicts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    pooled_strata: CaseStrata,
    fixture_name: str,
    expected_failures: list[str] | None,
    expected_exit: int,
) -> None:
    monkeypatch.delenv("EVAL_SMOKE", raising=False)
    payload, baseline, is_capped = _fixture(fixture_name)
    direct_target = _configure(
        monkeypatch, tmp_path / "direct", payload, baseline, is_capped
    )
    failures = finish_cli_report(_report(payload), direct_target, _MODEL, pooled_strata)

    assert failures == expected_failures
    if expected_failures is None:
        established = BaselineRecord.model_validate_json(
            baseline_path(_LAYER, _MODEL, tmp_path / "direct").read_text()
        )
        assert established.scores == payload.scores

    runner_target = _configure(
        monkeypatch, tmp_path / "runner", payload, baseline, is_capped
    )
    exit_code = _finish_report(_report(payload), runner_target, _MODEL, pooled_strata)
    assert exit_code == expected_exit

    pytest_target = _configure(
        monkeypatch, tmp_path / "pytest", payload, baseline, is_capped
    )
    if expected_failures is None:
        with pytest.raises(pytest.skip.Exception):
            _assert_report(_report(payload), pytest_target, pooled_strata, _MODEL)
    elif expected_failures:
        with pytest.raises(AssertionError, match="Regression"):
            _assert_report(_report(payload), pytest_target, pooled_strata, _MODEL)
    else:
        _assert_report(_report(payload), pytest_target, pooled_strata, _MODEL)


def test_uncapped_all_error_is_failure_in_both_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, pooled_strata: CaseStrata
) -> None:
    payload, baseline, is_capped = _fixture("all_error")
    direct_target = _configure(
        monkeypatch, tmp_path / "direct", payload, baseline, is_capped
    )
    with pytest.raises(NoEvaluatedCases, match="All cases errored"):
        finish_cli_report(_report(payload), direct_target, _MODEL, pooled_strata)

    runner_target = _configure(
        monkeypatch, tmp_path / "runner", payload, baseline, is_capped
    )
    assert _finish_report(_report(payload), runner_target, _MODEL, pooled_strata) == 1

    pytest_target = _configure(
        monkeypatch, tmp_path / "pytest", payload, baseline, is_capped
    )
    with pytest.raises(pytest.fail.Exception, match="All cases errored"):
        _assert_report(_report(payload), pytest_target, pooled_strata, _MODEL)


def test_missing_baseline_golden_creates_schema_v2_record(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, pooled_strata: CaseStrata
) -> None:
    payload, baseline, is_capped = _fixture("missing_baseline")
    target = _configure(monkeypatch, tmp_path, payload, baseline, is_capped)

    assert finish_cli_report(_report(payload), target, _MODEL, pooled_strata) is None

    created = BaselineRecord.model_validate_json(
        baseline_path(_LAYER, _MODEL, tmp_path).read_text()
    )
    assert created.case_count == payload.case_count
