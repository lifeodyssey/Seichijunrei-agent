"""Execution-tier concerns for model-backed evals: the target, the cap, the file.

The results file's schema lives in ``results_payload`` and the reading of a
finished report into its rows lives in ``report_case_rows`` (#1493).
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from pydantic_evals.reporting import EvaluationReport

from animichi.agents.runtime_deps import TitleTranslator, WebSearcher
from animichi.tests.eval.evaluators import EVALUATOR_VERSION
from animichi.tests.eval.report_case_rows import aggregate_usage, case_rows
from animichi.tests.eval.results_payload import ResultsPayload

T = TypeVar("T")
InputsT = TypeVar("InputsT")
OutputT = TypeVar("OutputT")
MetadataT = TypeVar("MetadataT")


@dataclass(frozen=True)
class EvalWebMocks:
    web_searcher: WebSearcher | None = None
    title_translator: TitleTranslator | None = None


@dataclass(frozen=True)
class EvalTierTarget:
    db: object
    catalog_factory: Callable[[], object]
    layer: str
    tier: str
    source: str
    web_mocks: EvalWebMocks = field(default_factory=EvalWebMocks)
    on_close: Callable[[], Awaitable[None]] | None = None


def trajectory_web_mocks() -> EvalWebMocks:
    from animichi.tests.eval.mock_web import MockTitleTranslator, MockWebSearcher

    return EvalWebMocks(MockWebSearcher(), MockTitleTranslator())


def cap_cases(cases: list[T], cap: int | None) -> list[T]:
    if cap is None or cap <= 0 or cap >= len(cases):
        return cases
    return [cases[index] for index in _even_indices(len(cases), cap)]


def read_max_cases() -> int | None:
    raw = os.environ.get("EVAL_MAX_CASES")
    if raw is None or raw in ("", "0"):
        return None
    value = int(raw)
    return value if value > 0 else None


def is_fullstack() -> bool:
    return os.environ.get("EVAL_FULLSTACK") == "1"


def results_filename(layer: str, model_id: str) -> str:
    return f"{layer}_{_safe_model(model_id)}.json"


def build_results_payload(
    report: EvaluationReport[InputsT, OutputT, MetadataT],
    *,
    model_id: str,
    dataset: str,
    tier: str,
    case_count: int,
    scores: dict[str, float],
    warnings: Sequence[str] = (),
) -> ResultsPayload:
    return ResultsPayload(
        model=model_id,
        evaluator_version=EVALUATOR_VERSION,
        dataset=dataset,
        tier=tier,
        case_count=case_count,
        evaluated_count=len(report.cases),
        errored_count=len(report.failures),
        scores=scores,
        warnings=list(warnings),
        cases=case_rows(report),
        usage=aggregate_usage(report),
    )


def save_results(
    *,
    results_dir: Path,
    layer: str,
    model_id: str,
    payload: ResultsPayload,
) -> Path:
    results_dir.mkdir(exist_ok=True)
    path = results_dir / results_filename(layer, model_id)
    path.write_text(payload.model_dump_json(indent=2) + "\n")
    print(f"\nPer-case results saved to: {path}")
    return path


def _even_indices(length: int, cap: int) -> list[int]:
    if cap == 1:
        return [0]
    last = length - 1
    return [round(index * last / (cap - 1)) for index in range(cap)]


def _safe_model(model_id: str) -> str:
    return model_id.replace(":", "-").replace("@", "-").replace("/", "-")
