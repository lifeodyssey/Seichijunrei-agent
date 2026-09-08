from __future__ import annotations

from collections.abc import Mapping
from typing import cast

import pytest
from pydantic_evals.evaluators import LLMJudge

from animichi.agents.agent_result import AgentResult
from animichi.agents.base import parse_model_spec
from animichi.agents.runtime_models import QAResponseModel, SearchResponseModel
from animichi.agents.session_state import (
    ItineraryPayloadState,
    ItineraryRef,
    OrderedCandidate,
    PendingClarification,
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from animichi.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    DataKeysPresent,
    LocaleMatch,
    NonemptyResults,
    _available_data_keys,
)
from animichi.tests.eval.l3_judges import build_l3_evaluators
from animichi.tests.unit.eval_evaluator_fixtures import JA, ctx, result, steps


def _search_state(row_count: int, *, kind: str = "nearby") -> SessionState:
    rows = [PointState(id=f"p-{index}", bangumi_id="1") for index in range(row_count)]
    state = SessionState()
    state.store_search_result(
        ResultRef("search:1"),
        SearchPayloadState.model_validate(
            {"kind": kind, "rows": rows, "row_count": row_count, "anime_ids": ["1"]}
        ),
    )
    return state


def _clarify_state(with_candidates: bool) -> SessionState:
    ids = ["1", "2"] if with_candidates else []
    reason = "anime_ambiguity" if with_candidates else "anime_not_found"
    return SessionState(
        pending_clarification=PendingClarification(
            reason=reason,
            candidate_ids=ids,
            ordered_candidates=[OrderedCandidate(id=item, title=item) for item in ids],
            revision=1,
        ),
        clarification_revision=1,
    )


def _route_result(source_rows: int, route_rows: int, *, intent: str) -> AgentResult:
    state = _search_state(
        source_rows, kind="multi" if intent == "plan_multi" else "bangumi"
    )
    source_ref = state.last_result_ref
    state.store_itinerary(
        ItineraryRef("route:1"),
        ItineraryPayloadState(
            ordered_points=[PointState(id=f"r-{index}") for index in range(route_rows)],
            source_ref=source_ref,
        ),
    )
    return result(steps("plan_route"), intent=intent, state=state)


def _judges() -> list[LLMJudge]:
    model = parse_model_spec(
        "openai:deepseek-v4-pro@https://api.deepseek.com",
        use_settings_fallbacks=False,
    )
    return cast(list[LLMJudge], build_l3_evaluators(model))


@pytest.mark.parametrize(
    ("message", "locale", "expected"),
    [
        ("これは日本語です", "ja", {"locale_match": 1.0}),
        ("これは日本語です", "en", {"locale_match": 0.0}),
        ("", "ja", {"locale_match": 0.0}),
        ("Hello there friend", "en", {"locale_match": 1.0}),
    ],
)
def test_locale_match_scores_message_language(
    message: str, locale: str, expected: Mapping[str, float]
) -> None:
    output = QAResponseModel(message=message)
    evaluator_ctx = ctx(
        AgentInput(query="q", locale=locale),
        result(steps(), output),
        AgentExpected(["general_qa"]),
    )
    assert dict(LocaleMatch().evaluate(evaluator_ctx)) == expected


def test_locale_match_prefers_current_query_over_stale_locale() -> None:
    evaluator_ctx = ctx(
        AgentInput(query="请介绍圣地巡礼", locale="ja"),
        result(steps(), QAResponseModel(message="圣地巡礼是一种旅行方式。")),
        AgentExpected(["general_qa"]),
    )
    assert dict(LocaleMatch().evaluate(evaluator_ctx)) == {"locale_match": 1.0}


def test_available_data_keys_use_new_registry_vocabulary() -> None:
    search = result(
        steps("search_nearby"),
        SearchResponseModel(message="found"),
        intent="search_nearby",
        state=_search_state(1),
    )
    candidate = result(steps(), intent="clarify", state=_clarify_state(True))
    no_candidate = result(steps(), intent="clarify", state=_clarify_state(False))
    assert _available_data_keys(search) == {"results"}
    assert _available_data_keys(_route_result(1, 1, intent="plan_route")) == {"route"}
    assert _available_data_keys(_route_result(1, 1, intent="plan_multi")) == {
        "results",
        "route",
    }
    assert _available_data_keys(candidate) == {"reason", "candidates"}
    assert _available_data_keys(no_candidate) == {"reason", "candidates"}


def test_available_data_keys_do_not_leak_stale_registry_across_stages() -> None:
    state = _search_state(1)
    qa = result(steps(), intent="general_qa", state=state)
    clarify = result(steps(), intent="clarify", state=state)
    assert _available_data_keys(qa) == set()
    assert _available_data_keys(clarify) == set()


def test_data_keys_present_scores_registry_payload() -> None:
    evaluated = result(steps(), intent="clarify", state=_clarify_state(True))
    evaluator_ctx = ctx(
        JA, evaluated, AgentExpected(["clarify"], ["reason", "candidates"])
    )
    assert dict(DataKeysPresent().evaluate(evaluator_ctx)) == {"data_keys_present": 1.0}


@pytest.mark.parametrize(
    ("row_count", "expected"),
    [(2, {"nonempty_results": 1.0}), (0, {"nonempty_results": 0.0})],
)
def test_nonempty_results_scores_search_registry(
    row_count: int, expected: Mapping[str, float]
) -> None:
    evaluated = result(
        steps("search_nearby"),
        SearchResponseModel(message="found"),
        intent="search_nearby",
        state=_search_state(row_count),
    )
    evaluator_ctx = ctx(
        JA, evaluated, AgentExpected(["search_nearby"], expect_nonempty=True)
    )
    assert dict(NonemptyResults().evaluate(evaluator_ctx)) == expected


def test_nonempty_route_requires_source_and_ordered_points() -> None:
    empty_source = _route_result(0, 1, intent="plan_route")
    empty_route = _route_result(1, 0, intent="plan_route")
    complete = _route_result(1, 1, intent="plan_route")
    expected = AgentExpected(["plan_route"], expect_nonempty=True)
    assert (
        NonemptyResults().evaluate(ctx(JA, empty_source, expected))["nonempty_results"]
        == 0
    )
    assert (
        NonemptyResults().evaluate(ctx(JA, empty_route, expected))["nonempty_results"]
        == 0
    )
    assert (
        NonemptyResults().evaluate(ctx(JA, complete, expected))["nonempty_results"] == 1
    )


def test_nonempty_results_omits_metric_for_untagged_case() -> None:
    evaluated = result(steps(), intent="search_nearby", state=_search_state(3))
    assert dict(NonemptyResults().evaluate(ctx(JA, evaluated, AgentExpected([])))) == {}


def test_build_l3_evaluators_contract() -> None:
    judges = _judges()
    assert len(judges) == 2
    assert all(isinstance(judge, LLMJudge) for judge in judges)
    assert judges[0].model_settings == {"temperature": 0.0}
    assert judges[0].assertion is False
    assert judges[0].score == {
        "evaluation_name": "task_completion",
        "include_reason": True,
    }
    assert judges[1].score["evaluation_name"] == "hallucination_check"
