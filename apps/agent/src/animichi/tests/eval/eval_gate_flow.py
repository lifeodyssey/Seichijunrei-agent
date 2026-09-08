"""Shared result persistence and schema-v2 gate flow for agent eval tiers."""

from __future__ import annotations

import os
from collections.abc import Sequence
from pathlib import Path

from animichi.agents.agent_result import AgentResult
from animichi.tests.eval.baseline_mint import mint_baseline
from animichi.tests.eval.direct_gates import (
    TrajectoryCase,
    direct_thrash_gate,
    print_direct_thrash_metrics,
)
from animichi.tests.eval.eval_harness import (
    ALL_CASES,
    BASELINES_DIR,
    CAPPED,
    CASES,
    DATASET_NAME,
    EVAL_L3,
    METRIC_NAMES,
    RESULTS_DIR,
    AgentReport,
)
from animichi.tests.eval.eval_report import print_scores
from animichi.tests.eval.evaluators import accepted_chains_for_case
from animichi.tests.eval.exec_tiers import (
    EvalTierTarget,
    build_results_payload,
    collect_case_scores,
    save_results,
)
from animichi.tests.eval.gate import (
    BaselineRecord,
    bootstrap_gate,
    error_rate_gate,
    read_baseline_record,
)
from animichi.tests.eval.gate_input import GateInput
from animichi.tests.eval.provider_outage import starved_case_ids
from animichi.tests.eval.run_scores import ScoreMap, scores_for_run
from animichi.tests.eval.smoke_errors import (
    SmokeError,
    SmokeErrorSummary,
    classify_error,
    format_transport_notice,
    smoke_error_failures,
    summarize_errors,
)
from animichi.tests.eval.stats import CaseStrata
from animichi.tests.eval.trajectory_assertions import (
    TrajectoryExpectation,
    print_trajectory_assertions,
    trajectory_assertion_failures,
)


def gate_exit_code(failures: list[str] | None) -> int:
    return 1 if failures else 0


class SmokeRequiresCappedRun(RuntimeError):
    """Raised when EVAL_SMOKE=1 is set but the run resolved to uncapped."""


def persist_report(
    report: AgentReport,
    target: EvalTierTarget,
    model_id: str,
    scores: ScoreMap,
    warnings: Sequence[str] = (),
) -> Path:
    """Write the run down, warnings included: the log is not the artifact."""
    payload = build_results_payload(
        report,
        model_id=model_id,
        dataset=DATASET_NAME,
        tier=target.tier,
        case_count=len(CASES),
        scores=scores,
        warnings=warnings,
    )
    return save_results(
        results_dir=RESULTS_DIR, layer=target.layer, model_id=model_id, payload=payload
    )


def _baseline(
    layer: str, model_id: str, case_count: int, baselines_dir: Path
) -> BaselineRecord | None:
    return read_baseline_record(
        layer,
        model_id,
        baselines_dir=baselines_dir,
        expected_case_count=case_count,
        expected_metrics=METRIC_NAMES,
    )


def _capped_mode_label(*, is_smoke: bool) -> str:
    if is_smoke:
        return "smoke-enforced (zero-errors + direct gates)"
    return "report-only"


def _capped_notice(case_count: int, *, is_smoke: bool) -> None:
    label = _capped_mode_label(is_smoke=is_smoke)
    print(
        f"\nCAPPED eval run: {case_count}/{len(ALL_CASES)} cases; {label} "
        "(no baseline read/write/statistical gate)."
    )


def gate_report(
    report: AgentReport,
    target: EvalTierTarget,
    model_id: str,
    scores: ScoreMap,
    strata: CaseStrata,
) -> list[str] | None:
    gate_input = _report_gate_input(report, target, model_id, scores, strata)
    return _run_gate(gate_input, target.layer, BASELINES_DIR, is_capped=CAPPED)


def _run_gate(
    gate_input: GateInput, layer: str, baselines_dir: Path, *, is_capped: bool
) -> list[str] | None:
    if is_capped:
        return _run_capped_gate(gate_input)
    _refuse_uncapped_smoke()
    enforce_direct = _direct_gate_enforced()
    _print_direct_metrics(gate_input, include_p95=True, is_enforced=enforce_direct)
    return _run_uncapped_gate(gate_input, layer, baselines_dir, enforce_direct)


def _refuse_uncapped_smoke() -> None:
    """Never silently drop EVAL_SMOKE=1 into the uncapped statistical gate."""
    if not _smoke_enforced():
        return
    raise SmokeRequiresCappedRun(
        "EVAL_SMOKE=1 requires a capped run (EVAL_MAX_CASES below the dataset "
        f"size, currently {len(ALL_CASES)} cases) — refusing to silently fall "
        "through to the uncapped statistical gate."
    )


def _run_capped_gate(gate_input: GateInput) -> list[str]:
    """L0 smoke tier: never touches the baseline; EVAL_SMOKE=1 makes it enforce."""
    is_smoke = _smoke_enforced()
    _print_direct_metrics(gate_input, include_p95=is_smoke, is_enforced=is_smoke)
    _capped_notice(gate_input.case_count, is_smoke=is_smoke)
    if not is_smoke:
        return []
    return _smoke_gate_failures(gate_input)


def _smoke_gate_failures(gate_input: GateInput) -> list[str]:
    return [
        *_smoke_error_failures(gate_input),
        *direct_thrash_gate(gate_input.trajectories),
        *_trajectory_assertion_failures(gate_input),
    ]


def _trajectory_assertion_failures(gate_input: GateInput) -> list[str]:
    """S1.13 pilot: report every case, block only once calibrated (opt-in)."""
    is_enforced = _trajectory_assertions_enforced()
    print_trajectory_assertions(gate_input.expectations, is_enforced=is_enforced)
    if not is_enforced:
        return []
    return trajectory_assertion_failures(gate_input.expectations)


def _trajectory_assertions_enforced() -> bool:
    return os.environ.get("TRAJECTORY_ASSERT") == "1"


def _smoke_error_failures(gate_input: GateInput) -> list[str]:
    """Name every errored case, and gate on agent errors rather than noise."""
    summary = summarize_errors(gate_input.errors, gate_input.case_count)
    _print_transport_notice(summary)
    return smoke_error_failures(summary)


def _print_transport_notice(summary: SmokeErrorSummary) -> None:
    notice = format_transport_notice(summary)
    if notice:
        print(f"\n{notice}")


def _smoke_enforced() -> bool:
    return os.environ.get("EVAL_SMOKE") == "1"


def _run_uncapped_gate(
    gate_input: GateInput, layer: str, baselines_dir: Path, enforce_direct: bool
) -> list[str] | None:
    baseline = _baseline(layer, gate_input.model, gate_input.case_count, baselines_dir)
    failures = _gate_failures(gate_input, baseline, enforce_direct=enforce_direct)
    if failures:
        return failures
    if baseline is not None:
        return []
    return mint_baseline(gate_input, layer=layer, baselines_dir=baselines_dir)


def _print_direct_metrics(
    gate_input: GateInput, *, include_p95: bool, is_enforced: bool
) -> None:
    print_direct_thrash_metrics(
        gate_input.trajectories, include_p95=include_p95, is_enforced=is_enforced
    )


def _gate_failures(
    gate_input: GateInput,
    baseline: BaselineRecord | None,
    *,
    enforce_direct: bool,
) -> list[str]:
    direct = direct_thrash_gate(gate_input.trajectories)
    bootstrap = (
        bootstrap_gate(
            gate_input.cases,
            baseline,
            strata=gate_input.strata,
            starved=gate_input.starved,
        )
        if baseline
        else []
    )
    errors = error_rate_gate(
        gate_input.errored_count,
        gate_input.evaluated_count + gate_input.errored_count,
        baseline,
    )
    return [*(direct if enforce_direct else []), *bootstrap, *errors]


def _direct_gate_enforced() -> bool:
    return os.environ.get("DIRECT_GATE_ENFORCE") == "1"


def _report_gate_input(
    report: AgentReport,
    target: EvalTierTarget,
    model_id: str,
    scores: ScoreMap,
    strata: CaseStrata,
) -> GateInput:
    return GateInput(
        model_id,
        DATASET_NAME,
        target.tier,
        len(CASES),
        len(report.cases),
        scores,
        collect_case_scores(report),
        errors=_classified_errors(report),
        trajectories=_trajectory_cases(report),
        expectations=_expectations(report),
        strata=None if CAPPED else strata.by_case,
        starved=starved_case_ids(report),
    )


def _expectations(report: AgentReport) -> tuple[TrajectoryExpectation, ...]:
    return tuple(
        TrajectoryExpectation.from_case(
            TrajectoryCase.from_result(str(case.name), case.output),
            accepted_chains_for_case(case.metadata),
        )
        for case in report.cases
        if isinstance(case.output, AgentResult)
    )


def _classified_errors(report: AgentReport) -> tuple[SmokeError, ...]:
    return tuple(
        classify_error(str(failure.name), failure.error_message)
        for failure in report.failures
    )


def _trajectory_cases(report: AgentReport) -> tuple[TrajectoryCase, ...]:
    return tuple(
        TrajectoryCase.from_result(str(case.name), case.output)
        for case in report.cases
        if isinstance(case.output, AgentResult)
    )


def _print_report_scores(
    scores: ScoreMap, target: EvalTierTarget, model_id: str
) -> None:
    print_scores(
        scores, model_id, case_count=len(CASES), l3_enabled=EVAL_L3, tier=target.tier
    )


def finish_cli_report(
    report: AgentReport, target: EvalTierTarget, model_id: str, strata: CaseStrata
) -> list[str] | None:
    scores = scores_for_run(report, model_id, is_capped=CAPPED)
    persist_report(report, target, model_id, scores, strata.warnings)
    _print_report_scores(scores, target, model_id)
    return gate_report(report, target, model_id, scores, strata)
