"""Four-layer agent eval harness on the two-tier execution shell.

Dataset reading lives in ``agent_eval_cases`` and the three per-case routes in
``agent_eval_task`` (#1493); this module is the run itself.
"""

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import TypeAlias, cast

import logfire
from dotenv import dotenv_values
from opentelemetry.trace import get_tracer_provider
from pydantic_ai.models import Model
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator
from pydantic_evals.lifecycle import CaseLifecycle
from pydantic_evals.reporting import EvaluationReport

from animichi.agents.agent_result import AgentResult
from animichi.agents.animichi_agent import animichi_agent
from animichi.agents.base import parse_model_spec
from animichi.agents.runtime_deps import TitleTranslator, WebSearcher
from animichi.domain.ports import CatalogLookup
from animichi.tests.eval.agent_eval_cases import load_cases
from animichi.tests.eval.agent_eval_task import (
    CatalogFactory,
    agent_task,
    selected_task,
    selection_task,
)
from animichi.tests.eval.case_strata import UNSTRATIFIED, load_case_strata
from animichi.tests.eval.eval_common import real_env_updates
from animichi.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    DataKeysPresent,
    LocaleMatch,
    NonemptyResults,
    StepEfficiency,
)
from animichi.tests.eval.exec_tiers import (
    EvalTierTarget,
    cap_cases,
    read_max_cases,
)
from animichi.tests.eval.l0_selection import L0Case, select_l0_cases
from animichi.tests.eval.l3_judges import build_l3_evaluators
from animichi.tests.eval.metric_names import metric_names
from animichi.tests.eval.official_evaluators import (
    OfficialArgumentCorrectness,
    OfficialMaxToolCalls,
    OfficialToolCorrectness,
    OfficialTrajectoryMatch,
)

TaskFn: TypeAlias = Callable[[AgentInput], Awaitable[AgentResult]]
AgentReport: TypeAlias = EvaluationReport[AgentInput, AgentResult, AgentExpected]
LifecycleFactory: TypeAlias = Callable[
    [Case[AgentInput, AgentResult, AgentExpected]],
    CaseLifecycle[AgentInput, AgentResult, AgentExpected],
]


def _load_eval_env() -> None:
    updates = real_env_updates(
        dotenv_values(Path(__file__).parents[4] / ".env"), os.environ
    )
    for key, value in updates.items():
        if key != "LOGFIRE_TOKEN":
            os.environ[key] = value


_load_eval_env()

# The zen/go gateway began refusing every request without an
# `x-opencode-session` header on 2026-09-07, and nothing here sends one, so
# the eval runs against the direct MiMo endpoint — the same endpoint
# staging's own DEFAULT_AGENT_MODEL names (#1303).
DEFAULT_MODEL_ID = "openai:mimo-v2.5@https://api.xiaomimimo.com/v1"
EVAL_MODEL_ID = os.environ.get("EVAL_MODEL", DEFAULT_MODEL_ID)
EVAL_CONCURRENCY = int(os.environ.get("EVAL_CONCURRENCY", "10"))
EVAL_L3 = os.environ.get("EVAL_L3") == "1"
JUDGE_MODEL_ID = os.environ.get("EVAL_JUDGE_MODEL", DEFAULT_MODEL_ID)
DATASET_PATH = (
    Path(__file__).parent
    / "datasets"
    / os.environ.get("EVAL_DATASET", "agent_eval_v3.json")
)
DATASET_NAME = DATASET_PATH.stem
BASELINES_DIR = Path(__file__).parent / "baselines"
RESULTS_DIR = Path(__file__).parent / "results"


def make_model(model_id: str | None = None) -> Model:
    return parse_model_spec(model_id or EVAL_MODEL_ID, use_settings_fallbacks=False)


AgentCase: TypeAlias = Case[AgentInput, AgentResult, AgentExpected]


def _l0_view(case: AgentCase, strata: Mapping[str, str]) -> L0Case:
    name = str(case.name)
    return L0Case(name, strata.get(name, UNSTRATIFIED), case.inputs.locale)


def select_cases(cases: list[AgentCase], cap: int | None) -> list[AgentCase]:
    """L0 smoke composes an explicit set; every other tier caps by even spread."""
    if cap is None or os.environ.get("EVAL_SMOKE") != "1":
        return cap_cases(cases, cap)
    strata = load_case_strata(DATASET_PATH).by_case
    return select_l0_cases(cases, lambda case: _l0_view(case, strata), cap)


ALL_CASES = load_cases(DATASET_PATH)
CASES = select_cases(ALL_CASES, read_max_cases())
CAPPED = len(CASES) < len(ALL_CASES)
HAS_NONEMPTY_CASES = any(
    case.metadata is not None and case.metadata.expect_nonempty for case in CASES
)
#: This DATASET's vocabulary, with both per-run toggles on. What ONE run reports
#: is `run_metric_names`; this stays the vocabulary a committed baseline is read
#: against, so a run that computed a column for nobody does not make the
#: baseline look stale.
METRIC_NAMES = metric_names(
    has_nonempty_cases=HAS_NONEMPTY_CASES,
    has_params_recorded=True,
    has_measured_steps=True,
    l3_enabled=EVAL_L3,
)


def build_evaluators() -> list[Evaluator[AgentInput, AgentResult, AgentExpected]]:
    evaluators: list[Evaluator[AgentInput, AgentResult, AgentExpected]] = [
        OfficialArgumentCorrectness(),
        OfficialToolCorrectness(),
        OfficialTrajectoryMatch(),
        OfficialMaxToolCalls(),
        DataKeysPresent(),
        LocaleMatch(),
        NonemptyResults(),
        StepEfficiency(),
    ]
    if EVAL_L3:
        evaluators.extend(build_l3_evaluators(make_model(JUDGE_MODEL_ID)))
    return evaluators


agent_dataset = Dataset(name=DATASET_NAME, cases=CASES, evaluators=build_evaluators())


def make_agent_task(
    db: CatalogLookup,
    catalog_factory: CatalogFactory,
    model: Model | None = None,
    *,
    web_searcher: WebSearcher | None = None,
    title_translator: TitleTranslator | None = None,
) -> TaskFn:
    resolved_model = model or make_model()

    async def task(inp: AgentInput) -> AgentResult:
        if inp.selected_candidate_ids is not None:
            return await selection_task(inp)
        if inp.selected_point_ids is not None:
            return await selected_task(inp)
        return await agent_task(
            inp, db, catalog_factory, resolved_model, web_searcher, title_translator
        )

    return task


def _target_task(target: EvalTierTarget, model: Model | None) -> TaskFn:
    return make_agent_task(
        cast(CatalogLookup, target.db),
        cast(CatalogFactory, target.catalog_factory),
        model,
        web_searcher=target.web_mocks.web_searcher,
        title_translator=target.web_mocks.title_translator,
    )


def _ensure_tracer_provider() -> None:
    if hasattr(get_tracer_provider(), "add_span_processor"):
        return
    logfire.configure(send_to_logfire=False, console=False)


@contextmanager
def _agentic_tracing() -> Iterator[None]:
    _ensure_tracer_provider()
    previous = animichi_agent.instrument
    animichi_agent.instrument = True
    try:
        yield
    finally:
        animichi_agent.instrument = previous


async def evaluate_target(
    target: EvalTierTarget,
    model: Model | None = None,
    model_id: str = EVAL_MODEL_ID,
    *,
    lifecycle: LifecycleFactory | None = None,
    progress: bool = True,
) -> AgentReport:
    with _agentic_tracing():
        return await agent_dataset.evaluate(
            _target_task(target, model),
            name=f"{target.layer}_{model_id}",
            max_concurrency=EVAL_CONCURRENCY,
            lifecycle=lifecycle,
            progress=progress,
        )
