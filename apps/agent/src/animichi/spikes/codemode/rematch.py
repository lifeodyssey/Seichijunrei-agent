"""Run one arm of the paired official-v1 CodeMode rematch subset."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import math
import os
from collections import defaultdict
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import TypeAlias, cast

import logfire
from opentelemetry.trace import get_tracer_provider
from pydantic_ai import Agent
from pydantic_evals import Case, Dataset
from pydantic_evals.reporting import EvaluationReport, ReportCase, ReportCaseFailure

from animichi.agents.agent_result import AgentResult
from animichi.agents.animichi_agent import RuntimeOutput
from animichi.agents.runtime_deps import RuntimeDeps
from animichi.spikes.codemode.agent import Arm, build_rematch_arm
from animichi.spikes.codemode.report import (
    OFFICIAL_V1_METRICS,
    CaseMeasurement,
    RematchReport,
)
from animichi.tests.eval.eval_harness import (
    ALL_CASES,
    DATASET_NAME,
    EVAL_CONCURRENCY,
    AgentExpected,
    AgentInput,
    build_evaluators,
    make_agent_task,
    make_model,
)
from animichi.tests.eval.eval_report import collect_scores
from animichi.tests.eval.exec_tiers import read_max_cases, trajectory_web_mocks
from animichi.tests.eval.mock_catalog_client import MockCatalogClient
from animichi.tests.eval.null_database import NullDatabase
from animichi.utils.logger import configure_structlog

AgentCase: TypeAlias = Case[AgentInput, AgentResult, AgentExpected]
AgentReport: TypeAlias = EvaluationReport[AgentInput, AgentResult, AgentExpected]
DEFAULT_CASE_CAP = 80
MIMO_INPUT_USD_PER_MILLION = 1.0
MIMO_OUTPUT_USD_PER_MILLION = 3.0


def _family(case: AgentCase) -> str:
    return str(case.name).split("_", 1)[0]


def _allocations(groups: dict[str, list[AgentCase]], cap: int) -> dict[str, int]:
    counts = dict.fromkeys(groups, 0)
    for _ in range(cap):
        available = [name for name in groups if counts[name] < len(groups[name])]
        name = min(available, key=lambda item: (counts[item] / len(groups[item]), item))
        counts[name] += 1
    return counts


def stratified_cases(cases: Sequence[AgentCase], cap: int) -> list[AgentCase]:
    """Select a seedless, prefix-stratified, case-ID-sorted subset."""
    ordered = sorted(cases, key=lambda case: str(case.name))
    if cap <= 0 or cap >= len(ordered):
        return ordered
    groups: dict[str, list[AgentCase]] = defaultdict(list)
    for case in ordered:
        groups[_family(case)].append(case)
    counts = _allocations(dict(groups), cap)
    chosen = [case for name in sorted(groups) for case in groups[name][: counts[name]]]
    return sorted(chosen, key=lambda case: str(case.name))


def _case_cap() -> int:
    return read_max_cases() or DEFAULT_CASE_CAP


def _subset_digest(case_ids: Sequence[str]) -> str:
    return hashlib.sha256("\n".join(case_ids).encode()).hexdigest()


def _request_p95(cases: Sequence[CaseMeasurement]) -> int:
    requests = sorted(case.requests for case in cases if case.requests > 0)
    return requests[math.ceil(0.95 * len(requests)) - 1] if requests else 0


def _usage(output: object) -> tuple[int, int, int]:
    if not isinstance(output, AgentResult) or output.usage is None:
        return 0, 0, 0
    usage = output.usage
    return usage.requests, usage.input_tokens, usage.output_tokens


def _score_value(score: object) -> float:
    value = getattr(score, "value", score)
    if isinstance(value, int | float | str | bytes | bytearray):
        return float(value)
    raise TypeError(f"Score is not numeric: {value!r}")


def _success(
    case: ReportCase[AgentInput, AgentResult, AgentExpected],
) -> CaseMeasurement:
    requests, input_tokens, output_tokens = _usage(case.output)
    scores = {
        str(name): _score_value(score) for name, score in (case.scores or {}).items()
    }
    return CaseMeasurement(
        id=str(case.name),
        scores=scores,
        requests=requests,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _failure(
    case: ReportCaseFailure[AgentInput, AgentResult, AgentExpected],
) -> CaseMeasurement:
    return CaseMeasurement(id=str(case.name), error=case.error_message)


def _case_measurements(report: AgentReport) -> list[CaseMeasurement]:
    rows = [*map(_success, report.cases), *map(_failure, report.failures)]
    return sorted(rows, key=lambda case: case.id)


def _scores(report: AgentReport) -> dict[str, float]:
    averages = report.averages()
    if averages is None:
        raise RuntimeError("All rematch cases errored; no metrics are available.")
    return collect_scores(averages, OFFICIAL_V1_METRICS)


def _estimated_cost(input_tokens: int, output_tokens: int) -> float:
    weighted = input_tokens * MIMO_INPUT_USD_PER_MILLION
    weighted += output_tokens * MIMO_OUTPUT_USD_PER_MILLION
    return weighted / 1_000_000


def _build_report(
    arm: Arm, model_id: str, case_ids: list[str], report: AgentReport
) -> RematchReport:
    cases = _case_measurements(report)
    input_tokens = sum(case.input_tokens for case in cases)
    output_tokens = sum(case.output_tokens for case in cases)
    return RematchReport(
        arm=arm,
        model=model_id,
        dataset=DATASET_NAME,
        subset_digest=_subset_digest(case_ids),
        case_ids=case_ids,
        scores=_scores(report),
        request_p95=_request_p95(cases),
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        estimated_cost_usd=_estimated_cost(input_tokens, output_tokens),
        cases=cases,
    )


def _ensure_tracing() -> None:
    if not hasattr(get_tracer_provider(), "add_span_processor"):
        logfire.configure(send_to_logfire=False, console=False)


@contextmanager
def _installed_arm(agent: Agent[RuntimeDeps, RuntimeOutput]) -> Iterator[None]:
    from animichi.agents import animichi_runner

    previous_agent, previous_instrument = (
        animichi_runner.animichi_agent,
        agent.instrument,
    )
    animichi_runner.animichi_agent, agent.instrument = agent, True
    try:
        yield
    finally:
        animichi_runner.animichi_agent, agent.instrument = (
            previous_agent,
            previous_instrument,
        )


async def _evaluate(arm: Arm, model_id: str, cases: list[AgentCase]) -> AgentReport:
    web = trajectory_web_mocks()
    task = make_agent_task(
        NullDatabase(),
        MockCatalogClient,
        make_model(model_id),
        web_searcher=web.web_searcher,
        title_translator=web.title_translator,
    )
    dataset = Dataset(
        name=f"{DATASET_NAME}-codemode-rematch",
        cases=cases,
        evaluators=build_evaluators(),
    )
    agent = build_rematch_arm(arm)
    _ensure_tracing()
    with _installed_arm(agent):
        return await dataset.evaluate(
            task, name=f"codemode-rematch-{arm}", max_concurrency=EVAL_CONCURRENCY
        )


SPIKE_DIR = Path(__file__).resolve().parent


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--arm", choices=("control", "codemode-taught"), required=True)
    return parser


async def main() -> None:
    configure_structlog()
    args = _parser().parse_args()
    arm = cast(Arm, args.arm)
    cases = stratified_cases(ALL_CASES, _case_cap())
    case_ids = [str(case.name) for case in cases]
    model_id = os.environ.get(
        "EVAL_MODEL", "openai:mimo-v2.5@https://api.xiaomimimo.com/v1"
    )
    report = await _evaluate(arm, model_id, cases)
    out_path = SPIKE_DIR / f"rematch-{arm}.json"
    out_path.write_text(
        _build_report(arm, model_id, case_ids, report).model_dump_json(indent=2) + "\n"
    )


if __name__ == "__main__":
    asyncio.run(main())
