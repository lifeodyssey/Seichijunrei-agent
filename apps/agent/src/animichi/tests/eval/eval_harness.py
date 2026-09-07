"""Four-layer agent eval harness on the two-tier execution shell."""

from __future__ import annotations

import json
import os
from collections.abc import Awaitable, Callable, Iterator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import TypeAlias, cast

import logfire
from dotenv import dotenv_values
from opentelemetry.trace import get_tracer_provider
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models import Model
from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator
from pydantic_evals.lifecycle import CaseLifecycle
from pydantic_evals.reporting import EvaluationReport

from animichi.agents.agent_result import AgentResult
from animichi.agents.animichi_agent import animichi_agent
from animichi.agents.base import parse_model_spec
from animichi.agents.runtime_deps import TitleTranslator, WebSearcher
from animichi.clients.catalog_client import CatalogClientProtocol
from animichi.domain.ports import CatalogLookup
from animichi.tests.eval.eval_common import real_env_updates
from animichi.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    DataKeysPresent,
    LocaleMatch,
    NonemptyResults,
    StepEfficiency,
    build_l3_evaluators,
)
from animichi.tests.eval.exec_tiers import (
    EvalTierTarget,
    cap_cases,
    read_max_cases,
)
from animichi.tests.eval.l0_selection import L0Case, select_l0_cases
from animichi.tests.eval.official_evaluators import (
    OfficialArgumentCorrectness,
    OfficialMaxToolCalls,
    OfficialToolCorrectness,
    OfficialTrajectoryMatch,
)
from animichi.tests.eval.stats import UNSTRATIFIED, load_case_strata

Row: TypeAlias = Mapping[str, object]
TaskFn: TypeAlias = Callable[[AgentInput], Awaitable[AgentResult]]
AgentReport: TypeAlias = EvaluationReport[AgentInput, AgentResult, AgentExpected]
LifecycleFactory: TypeAlias = Callable[
    [Case[AgentInput, AgentResult, AgentExpected]],
    CaseLifecycle[AgentInput, AgentResult, AgentExpected],
]
CatalogFactory: TypeAlias = Callable[[], CatalogClientProtocol]


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
_OFFICIAL_METRIC_NAMES = [
    "argument_correctness",
    "tool_correctness",
    "trajectory_match",
    "max_tool_calls",
]
_KEPT_METRIC_NAMES = [
    "data_keys_present",
    "locale_match",
    "nonempty_results",
    "step_efficiency",
]


def metric_names(*, has_nonempty_cases: bool, l3_enabled: bool) -> list[str]:
    kept = [
        name
        for name in _KEPT_METRIC_NAMES
        if name != "nonempty_results" or has_nonempty_cases
    ]
    names = [*_OFFICIAL_METRIC_NAMES, *kept]
    if l3_enabled:
        names += ["task_completion", "hallucination_check"]
    return names


def make_model(model_id: str | None = None) -> Model:
    return parse_model_spec(model_id or EVAL_MODEL_ID, use_settings_fallbacks=False)


def _str_list(row: Row, key: str) -> list[str]:
    raw = row.get(key)
    return [str(item) for item in raw] if isinstance(raw, list) else []


def _context(row: Row) -> Mapping[str, object] | None:
    raw = row.get("context")
    return (
        {str(key): value for key, value in raw.items()}
        if isinstance(raw, Mapping)
        else None
    )


def _selected_ids(row: Row, key: str) -> list[str] | None:
    raw = row.get(key)
    return [str(item) for item in raw] if isinstance(raw, list) else None


def _optional_int(row: Row, key: str) -> int | None:
    value = row.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _mapping(row: Row, key: str) -> Mapping[str, object] | None:
    value = row.get(key)
    return (
        {str(name): item for name, item in value.items()}
        if isinstance(value, Mapping)
        else None
    )


def _padded_text(turn: Mapping[object, object], key: str) -> str:
    text = str(turn.get(key, ""))
    padding = turn.get("padding_chars", 0)
    count = padding if isinstance(padding, int) else 0
    return text + (" Travel planning context remains unchanged." * count)[:count]


def _history_turn(item: object) -> list[ModelMessage]:
    if not isinstance(item, Mapping):
        raise ValueError("Eval message_history turns must be objects.")
    user = ModelRequest(parts=[UserPromptPart(_padded_text(item, "user"))])
    assistant = ModelResponse(parts=[TextPart(_padded_text(item, "assistant"))])
    return [user, assistant]


def _message_history(context: Mapping[str, object] | None) -> list[ModelMessage]:
    raw = context.get("message_history") if context is not None else None
    if not isinstance(raw, list):
        return []
    messages: list[ModelMessage] = []
    for item in raw:
        messages.extend(_history_turn(item))
    return messages


def _case(row: Row) -> Case[AgentInput, AgentResult, AgentExpected]:
    return Case(name=str(row["id"]), inputs=_input(row), metadata=_expected(row))


def _input(row: Row) -> AgentInput:
    return AgentInput(
        str(row.get("query", "")),
        str(row.get("locale", "ja")),
        _context(row),
        _selected_ids(row, "selected_point_ids"),
        _selected_ids(row, "selected_candidate_ids"),
        _optional_int(row, "clarification_id"),
        _mapping(row, "seeded_pending"),
    )


def _expected(row: Row) -> AgentExpected:
    return AgentExpected(
        _str_list(row, "acceptable_stages"),
        _str_list(row, "expected_data_keys"),
        row.get("expect_nonempty") is True,
    )


def _row(item: object) -> Row:
    if not isinstance(item, Mapping):
        raise ValueError("Agent eval dataset rows must be objects.")
    return {str(key): value for key, value in item.items()}


def _rows(raw: object) -> list[Row]:
    if not isinstance(raw, list):
        raise ValueError("Agent eval dataset must be a list.")
    return [_row(item) for item in raw]


def load_cases() -> list[Case[AgentInput, AgentResult, AgentExpected]]:
    raw = cast(object, json.loads(DATASET_PATH.read_text()))
    return [_case(row) for row in _rows(raw)]


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


ALL_CASES = load_cases()
CASES = select_cases(ALL_CASES, read_max_cases())
CAPPED = len(CASES) < len(ALL_CASES)
METRIC_NAMES = metric_names(
    has_nonempty_cases=any(
        case.metadata is not None and case.metadata.expect_nonempty for case in CASES
    ),
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


async def _selected_task(inp: AgentInput) -> AgentResult:
    from animichi.agents.selected_route import execute_selected_itinerary
    from animichi.agents.session_state import SessionState
    from animichi.tests.eval.mock_catalog_client import MockCatalogClient

    return await execute_selected_itinerary(
        point_ids=inp.selected_point_ids or [],
        state=SessionState(),
        origin=None,
        locale=inp.locale,
        catalog=MockCatalogClient(),
    )


async def _selection_task(inp: AgentInput) -> AgentResult:
    from animichi.agents.selection import (
        execute_multi_selection,
        execute_place_selection,
        validate_candidate_selection,
    )
    from animichi.agents.session_state import PendingClarification, SessionState
    from animichi.tests.eval.mock_catalog_client import MockCatalogClient

    pending = PendingClarification.model_validate(inp.seeded_pending or {})
    state = SessionState(
        pending_clarification=pending,
        clarification_revision=pending.revision,
    )
    selected = validate_candidate_selection(
        state,
        inp.selected_candidate_ids or [],
        inp.clarification_id if inp.clarification_id is not None else -1,
    )
    if selected.reason == "anime_ambiguity":
        return await execute_multi_selection(
            candidate_ids=selected.candidate_ids,
            state=state,
            locale=inp.locale,
            catalog=MockCatalogClient(),
        )
    return await execute_place_selection(
        candidate_id=selected.candidate_ids[0],
        state=state,
        locale=inp.locale,
        catalog=MockCatalogClient(),
    )


async def _agent_task(
    inp: AgentInput,
    db: CatalogLookup,
    catalog_factory: CatalogFactory,
    model: Model,
    web_searcher: WebSearcher | None,
    title_translator: TitleTranslator | None,
) -> AgentResult:
    from animichi.agents.animichi_runner import run_animichi_agent
    from animichi.application.errors import InvalidInputError

    try:
        return await run_animichi_agent(
            text=inp.query,
            db=db,
            model=model,
            locale=inp.locale,
            context=dict(inp.context) if inp.context is not None else None,
            message_history=_message_history(inp.context),
            catalog=catalog_factory(),
            web_searcher=web_searcher,
            title_translator=title_translator,
        )
    except InvalidInputError:
        # #984 rejects blank input with InvalidInputError; the production
        # AgentTurn boundary turns that into a graceful rejection result (not a
        # crash). Mirror it here so the L0 empty_input smoke case evaluates as a
        # produced result instead of an agent error.
        from pydantic_ai.usage import RunUsage

        from animichi.agents.runtime_models import BlockedResponseModel
        from animichi.agents.session_state import SessionState

        return AgentResult(
            output=BlockedResponseModel(message="Empty message."),
            intent="general_qa",
            session_state=SessionState(),
            usage=RunUsage(),
            status="blocked",
            success_override=False,
        )


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
            return await _selection_task(inp)
        if inp.selected_point_ids is not None:
            return await _selected_task(inp)
        return await _agent_task(
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
