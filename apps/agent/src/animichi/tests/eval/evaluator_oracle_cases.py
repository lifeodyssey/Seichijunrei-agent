"""The transcripts the evaluator oracle scores (#1301).

Each scenario pins one branch the TypeScript port has to reproduce: the ANY-of-N
chain disjunction and its ties, the two selection stages that accept the empty
chain, the place selection that does not, the deterministic bypass as the WIRE
publishes it — one tool part named for the stage, opened with no arguments and
carrying its own origin, once per bypass stage (#1454, #1461, #1462, measured on
staging 2026-09-07) — every branch of
`_acceptable_min_steps`, the `{}` (no metric) returns — including the zero-step
turn on a case that required a step (#1439) — the
`resolve_reply_language` decision points, and — since #1381 — both answers
`argument_correctness` can give: every call whose params equal its arguments
scores 1.0, and the two calls the runtime settled differently score 0.0.

The three bypass scenarios are where that metric gives its THIRD answer (#1462).
Each opens with `{}` and settles with the request the visitor made, so its two
witnesses disagree by construction — and neither runner scores it, because
neither runner's evaluator looks at a step the model did not ask for. The
disagreement is left in the scenarios on purpose: it is what makes the skip
visible, since a bypass written with matching witnesses would score 1.0 whether
the filter ran or not.
"""

from __future__ import annotations

from animichi.tests.eval.evaluator_oracle_reply_language_cases import (
    REPLY_LANGUAGE_SCENARIOS,
)
from animichi.tests.eval.evaluator_oracle_scenarios import (
    EN_QUERY,
    EN_REPLY,
    JA_QUERY,
    JA_REPLY,
    OracleItinerary,
    OracleScenario,
    OracleStep,
)
from animichi.tests.eval.evaluator_oracle_selection_cases import (
    BYPASS_SELECTION_SCENARIOS,
    PLACE_SELECTION_SCENARIOS,
)

SCENARIOS: list[OracleScenario] = [
    OracleScenario(
        case_id="search_bangumi_exact_chain",
        query=JA_QUERY,
        locale="ja",
        intent="search_bangumi",
        message=JA_REPLY,
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
        query=EN_QUERY,
        locale="en",
        intent="general_qa",
        message=EN_REPLY,
        acceptable_stages=["general_qa"],
        steps=[OracleStep(tool="web_search", args={"query": "nishinomiya"})],
    ),
    OracleScenario(
        case_id="clarify_any_of_n_tie_partial",
        query=JA_QUERY,
        locale="ja",
        intent="clarify",
        message=JA_REPLY,
        acceptable_stages=["clarify"],
        steps=[
            OracleStep(tool="resolve_anime", args={"title": "ハルヒ"}),
            OracleStep(tool="search_bangumi", args={"bangumi_id": "b1"}),
        ],
        data_keys=["reason", "candidates"],
        pending_clarification=True,
    ),
    *BYPASS_SELECTION_SCENARIOS,
    OracleScenario(
        case_id="place_ambiguity_min_steps",
        query=JA_QUERY,
        locale="ja",
        intent="clarify",
        message=JA_REPLY,
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
        query=JA_QUERY,
        locale="ja",
        intent="clarify",
        message=JA_REPLY,
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
        query=EN_QUERY,
        locale="en",
        intent="greet_user",
        message=EN_REPLY,
        acceptable_stages=["greet_user"],
    ),
    *REPLY_LANGUAGE_SCENARIOS,
    OracleScenario(
        case_id="unknown_stage_defaults",
        query=EN_QUERY,
        locale="en",
        intent="general_qa",
        message=EN_REPLY,
        acceptable_stages=["mystery_stage"],
        steps=[OracleStep(tool="web_search", args={"query": "spot"})],
    ),
    OracleScenario(
        case_id="failed_step_excluded_from_chain",
        query=JA_QUERY,
        locale="ja",
        intent="search_bangumi",
        message=JA_REPLY,
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
        query=JA_QUERY,
        locale="ja",
        intent="search_nearby",
        message=JA_REPLY,
        acceptable_stages=["search_nearby"],
        steps=[
            OracleStep(tool="search_nearby", args={"place": "西宮"}, status="unsettled")
        ],
        data_keys=["results"],
        search_row_count=2,
    ),
    OracleScenario(
        case_id="repeated_tool_call",
        query=EN_QUERY,
        locale="en",
        intent="general_qa",
        message=EN_REPLY,
        acceptable_stages=["general_qa"],
        steps=[
            OracleStep(tool="web_search", args={"query": "a"}),
            OracleStep(tool="web_search", args={"query": "b"}),
        ],
    ),
    OracleScenario(
        case_id="empty_arguments_still_score",
        query=EN_QUERY,
        locale="en",
        intent="general_qa",
        message=EN_REPLY,
        acceptable_stages=["general_qa"],
        steps=[OracleStep(tool="web_search", args={})],
    ),
    OracleScenario(
        case_id="itinerary_without_source",
        query=JA_QUERY,
        locale="ja",
        intent="plan_route",
        message=JA_REPLY,
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
        query=JA_QUERY,
        locale="ja",
        intent="search_nearby",
        message=JA_REPLY,
        acceptable_stages=["search_nearby"],
        steps=[OracleStep(tool="search_nearby", args={"place": "西宮"})],
        data_keys=["results"],
        expect_nonempty=True,
        search_row_count=0,
    ),
    OracleScenario(
        case_id="settled_params_coerced_from_raw_arguments",
        query=JA_QUERY,
        locale="ja",
        intent="search_bangumi",
        message=JA_REPLY,
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
        query=JA_QUERY,
        locale="ja",
        intent="search_nearby",
        message=JA_REPLY,
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
    *PLACE_SELECTION_SCENARIOS,
    OracleScenario(
        case_id="clarify_without_pending",
        query=JA_QUERY,
        locale="ja",
        intent="clarify",
        message=JA_REPLY,
        acceptable_stages=["clarify"],
        steps=[OracleStep(tool="resolve_anime", args={"title": "ハルヒ"})],
        data_keys=["reason", "candidates"],
    ),
]
