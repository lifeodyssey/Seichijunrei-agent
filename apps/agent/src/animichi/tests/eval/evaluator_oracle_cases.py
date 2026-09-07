"""The transcripts the evaluator oracle scores (#1301).

Each scenario pins one branch the TypeScript port has to reproduce: the ANY-of-N
chain disjunction and its ties, the two selection stages that accept the empty
chain, the place selection that does not, the deterministic bypass as the WIRE
publishes it — one tool part named for the stage, opened with no arguments, once
per bypass stage (#1454, #1461, measured on staging 2026-09-07) — every branch of
`_acceptable_min_steps`, the `{}` (no metric) returns — including the zero-step
turn on a case that required a step (#1439) — the
`resolve_reply_language` decision points, and — since #1381 — both answers
`argument_correctness` can give: every call whose params equal its arguments
scores 1.0, and the two calls the runtime settled differently score 0.0.
"""

from __future__ import annotations

from animichi.tests.eval.evaluator_oracle_scenarios import (
    OracleItinerary,
    OracleScenario,
    OracleStep,
)

_JA_QUERY = "涼宮ハルヒの聖地はどこですか"
_JA_REPLY = "西宮市の聖地はこちらです。"
_EN_QUERY = "Where is the pilgrimage spot?"
_EN_REPLY = "The spots are in Nishinomiya."

SCENARIOS: list[OracleScenario] = [
    OracleScenario(
        case_id="search_bangumi_exact_chain",
        query=_JA_QUERY,
        locale="ja",
        intent="search_bangumi",
        message=_JA_REPLY,
        acceptable_stages=["search_bangumi"],
        steps=[
            OracleStep(tool="resolve_anime", args={"title": "涼宮ハルヒ"}),
            OracleStep(tool="search_bangumi", args={"bangumi_id": "b1"}),
        ],
        data_keys=["results"],
        expect_nonempty=True,
        search_row_count=5,
    ),
    OracleScenario(
        case_id="general_qa_any_of_n_web_search",
        query=_EN_QUERY,
        locale="en",
        intent="general_qa",
        message=_EN_REPLY,
        acceptable_stages=["general_qa"],
        steps=[OracleStep(tool="web_search", args={"query": "nishinomiya"})],
    ),
    OracleScenario(
        case_id="clarify_any_of_n_tie_partial",
        query=_JA_QUERY,
        locale="ja",
        intent="clarify",
        message=_JA_REPLY,
        acceptable_stages=["clarify"],
        steps=[
            OracleStep(tool="resolve_anime", args={"title": "ハルヒ"}),
            OracleStep(tool="search_bangumi", args={"bangumi_id": "b1"}),
        ],
        data_keys=["reason", "candidates"],
        pending_clarification=True,
    ),
    OracleScenario(
        case_id="point_selection_empty_chain",
        query=_JA_QUERY,
        locale="ja",
        intent="plan_selected",
        message=_JA_REPLY,
        acceptable_stages=["plan_selected"],
        data_keys=["route"],
        expect_nonempty=True,
        selected_point_ids=["p1", "p2"],
        itinerary=OracleItinerary(ordered_point_count=3, source_row_count=4),
    ),
    OracleScenario(
        case_id="point_selection_published_step",
        query=_EN_QUERY,
        locale="en",
        intent="plan_selected",
        message=_EN_REPLY,
        acceptable_stages=["plan_selected"],
        steps=[
            OracleStep(
                tool="plan_selected", args={}, params={"point_ids": ["p1", "p2"]}
            )
        ],
        data_keys=["route"],
        expect_nonempty=True,
        selected_point_ids=["p1", "p2"],
        itinerary=OracleItinerary(ordered_point_count=3, source_row_count=4),
    ),
    OracleScenario(
        case_id="candidate_selection_min_steps",
        query=_JA_QUERY,
        locale="ja",
        intent="plan_multi",
        message=_JA_REPLY,
        acceptable_stages=["plan_multi"],
        steps=[
            OracleStep(tool="search_bangumi", args={"bangumi_id": "b1"}),
            OracleStep(tool="search_bangumi", args={"bangumi_id": "b2"}),
            OracleStep(tool="plan_route", args={"result_ref": "r1"}),
            OracleStep(tool="plan_route", args={"result_ref": "r2"}),
        ],
        data_keys=["results", "route"],
        selected_candidate_ids=["c1", "c2", "c2"],
        search_row_count=6,
        itinerary=OracleItinerary(ordered_point_count=2, source_row_count=6),
    ),
    OracleScenario(
        case_id="candidate_selection_published_step",
        query=_EN_QUERY,
        locale="en",
        intent="plan_multi",
        message=_EN_REPLY,
        acceptable_stages=["plan_multi"],
        steps=[
            OracleStep(
                tool="plan_multi", args={}, params={"candidate_ids": ["c1", "c2"]}
            )
        ],
        data_keys=["results", "route"],
        expect_nonempty=True,
        selected_candidate_ids=["c1", "c2"],
        search_row_count=6,
        itinerary=OracleItinerary(ordered_point_count=2, source_row_count=6),
    ),
    OracleScenario(
        case_id="place_ambiguity_min_steps",
        query=_JA_QUERY,
        locale="ja",
        intent="clarify",
        message=_JA_REPLY,
        acceptable_stages=["clarify_after_nearby"],
        steps=[
            OracleStep(tool="search_nearby", args={"place": "西宮"}),
            OracleStep(tool="geocode", args={"place": "西宮"}),
        ],
        data_keys=["reason", "candidates"],
        seeded_pending={"reason": "place_ambiguity"},
        pending_clarification=True,
    ),
    OracleScenario(
        case_id="clarify_after_nearby_geocode_min_steps",
        query=_JA_QUERY,
        locale="ja",
        intent="clarify",
        message=_JA_REPLY,
        acceptable_stages=["clarify_after_nearby"],
        steps=[
            OracleStep(tool="search_nearby", args={"place": "西宮"}),
            OracleStep(tool="geocode", args={"place": "西宮"}),
            OracleStep(tool="search_nearby", args={"place": "西宮市"}),
        ],
        pending_clarification=True,
    ),
    OracleScenario(
        case_id="greet_user_no_steps",
        query=_EN_QUERY,
        locale="en",
        intent="greet_user",
        message=_EN_REPLY,
        acceptable_stages=["greet_user"],
    ),
    OracleScenario(
        case_id="empty_message_locale_zero",
        query=_EN_QUERY,
        locale="en",
        intent="general_qa",
        message="",
        acceptable_stages=["general_qa"],
    ),
    OracleScenario(
        case_id="reply_language_mismatch",
        query=_EN_QUERY,
        locale="en",
        intent="general_qa",
        message="こちらです。",
        acceptable_stages=["general_qa"],
    ),
    OracleScenario(
        case_id="simplified_hint_locale",
        query="凉宫春日的圣地在哪里",
        locale="ja",
        intent="search_bangumi",
        message="圣地在西宫市。",
        acceptable_stages=["search_bangumi"],
        steps=[
            OracleStep(tool="resolve_anime", args={"title": "凉宫"}),
            OracleStep(tool="search_bangumi", args={"bangumi_id": "b1"}),
        ],
        search_row_count=3,
    ),
    OracleScenario(
        case_id="han_only_query_falls_back",
        query="聖地案内",
        locale="en",
        intent="general_qa",
        message="こちらです。",
        acceptable_stages=["general_qa"],
    ),
    OracleScenario(
        case_id="unknown_stage_defaults",
        query=_EN_QUERY,
        locale="en",
        intent="general_qa",
        message=_EN_REPLY,
        acceptable_stages=["mystery_stage"],
        steps=[OracleStep(tool="web_search", args={"query": "spot"})],
    ),
    OracleScenario(
        case_id="failed_step_excluded_from_chain",
        query=_JA_QUERY,
        locale="ja",
        intent="search_bangumi",
        message=_JA_REPLY,
        acceptable_stages=["search_bangumi"],
        steps=[
            OracleStep(tool="resolve_anime", args={"title": "ハルヒ"}),
            OracleStep(
                tool="search_bangumi", args={"bangumi_id": "b1"}, status="error"
            ),
        ],
        data_keys=["results"],
        expect_nonempty=True,
    ),
    OracleScenario(
        case_id="unsettled_call_excluded_from_chain",
        query=_JA_QUERY,
        locale="ja",
        intent="search_nearby",
        message=_JA_REPLY,
        acceptable_stages=["search_nearby"],
        steps=[
            OracleStep(tool="search_nearby", args={"place": "西宮"}, status="unsettled")
        ],
        data_keys=["results"],
        search_row_count=2,
    ),
    OracleScenario(
        case_id="repeated_tool_call",
        query=_EN_QUERY,
        locale="en",
        intent="general_qa",
        message=_EN_REPLY,
        acceptable_stages=["general_qa"],
        steps=[
            OracleStep(tool="web_search", args={"query": "a"}),
            OracleStep(tool="web_search", args={"query": "b"}),
        ],
    ),
    OracleScenario(
        case_id="empty_arguments_still_score",
        query=_EN_QUERY,
        locale="en",
        intent="general_qa",
        message=_EN_REPLY,
        acceptable_stages=["general_qa"],
        steps=[OracleStep(tool="web_search", args={})],
    ),
    OracleScenario(
        case_id="itinerary_without_source",
        query=_JA_QUERY,
        locale="ja",
        intent="plan_route",
        message=_JA_REPLY,
        acceptable_stages=["plan_route"],
        steps=[
            OracleStep(tool="resolve_anime", args={"title": "ハルヒ"}),
            OracleStep(tool="search_bangumi", args={"bangumi_id": "b1"}),
            OracleStep(tool="plan_route", args={"result_ref": "r1"}),
        ],
        data_keys=["route"],
        expect_nonempty=True,
        itinerary=OracleItinerary(ordered_point_count=2, source_row_count=None),
    ),
    OracleScenario(
        case_id="search_present_but_zero_rows",
        query=_JA_QUERY,
        locale="ja",
        intent="search_nearby",
        message=_JA_REPLY,
        acceptable_stages=["search_nearby"],
        steps=[OracleStep(tool="search_nearby", args={"place": "西宮"})],
        data_keys=["results"],
        expect_nonempty=True,
        search_row_count=0,
    ),
    OracleScenario(
        case_id="settled_params_coerced_from_raw_arguments",
        query=_JA_QUERY,
        locale="ja",
        intent="search_bangumi",
        message=_JA_REPLY,
        acceptable_stages=["search_bangumi"],
        steps=[
            OracleStep(
                tool="search_bangumi",
                args={"bangumi_id": "12345"},
                params={"bangumi_id": 12345},
            )
        ],
        data_keys=["results"],
        search_row_count=2,
    ),
    OracleScenario(
        case_id="settled_params_dropped_an_optional_null",
        query=_JA_QUERY,
        locale="ja",
        intent="search_nearby",
        message=_JA_REPLY,
        acceptable_stages=["search_nearby"],
        steps=[
            OracleStep(
                tool="search_nearby",
                args={"place": "西宮", "radius_m": None},
                params={"place": "西宮"},
            )
        ],
        data_keys=["results"],
        search_row_count=2,
    ),
    OracleScenario(
        case_id="place_selection_calls_the_stage_it_names",
        query="Use Uji",
        locale="ja",
        intent="search_nearby",
        message=_EN_REPLY,
        acceptable_stages=["search_nearby"],
        steps=[OracleStep(tool="search_nearby", args={"place": "\u5b87\u6cbb"})],
        data_keys=["results"],
        expect_nonempty=True,
        selected_candidate_ids=["seed:uji"],
        seeded_pending={"reason": "place_ambiguity"},
        clarification_id=6,
        search_row_count=4,
    ),
    OracleScenario(
        case_id="place_selection_refused_to_act",
        query="Use Uji",
        locale="ja",
        intent="search_nearby",
        message=_EN_REPLY,
        acceptable_stages=["search_nearby"],
        data_keys=["results"],
        expect_nonempty=True,
        selected_candidate_ids=["seed:uji"],
        seeded_pending={"reason": "place_ambiguity"},
        clarification_id=6,
    ),
    OracleScenario(
        case_id="clarify_without_pending",
        query=_JA_QUERY,
        locale="ja",
        intent="clarify",
        message=_JA_REPLY,
        acceptable_stages=["clarify"],
        steps=[OracleStep(tool="resolve_anime", args={"title": "ハルヒ"})],
        data_keys=["reason", "candidates"],
    ),
]
