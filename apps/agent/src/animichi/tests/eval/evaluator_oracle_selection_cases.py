"""The oracle scenarios for the turns a selection makes deterministic.

Split out of ``evaluator_oracle_cases.py`` (#1493), which keeps the roster and
splices these two lists back into it in place — the exported fixture's case
order is what the drift gate compares, so the roster, not this file, decides it.

Two lists because the roster names them at two points and the fixture order is
load-bearing: the point and candidate bypasses (each written twice, once for the
empty chain a Python run observes and once for the step the wire publishes), and
the place selection, which is a bypass step that accepts no empty chain.
"""

from __future__ import annotations

from animichi.tests.eval.evaluator_oracle_scenarios import (
    EN_QUERY,
    EN_REPLY,
    JA_QUERY,
    JA_REPLY,
    OracleItinerary,
    OracleScenario,
    OracleStep,
)

BYPASS_SELECTION_SCENARIOS: list[OracleScenario] = [
    OracleScenario(
        case_id="point_selection_empty_chain",
        query=JA_QUERY,
        locale="ja",
        intent="plan_selected",
        message=JA_REPLY,
        acceptable_stages=["plan_selected"],
        data_keys=["route"],
        expect_nonempty=True,
        selected_point_ids=["p1", "p2"],
        itinerary=OracleItinerary(ordered_point_count=3, source_row_count=4),
    ),
    OracleScenario(
        case_id="point_selection_published_step",
        query=EN_QUERY,
        locale="en",
        intent="plan_selected",
        message=EN_REPLY,
        acceptable_stages=["plan_selected"],
        steps=[
            OracleStep(
                tool="plan_selected",
                args={},
                params={"point_ids": ["p1", "p2"]},
                model_initiated=False,
            )
        ],
        data_keys=["route"],
        expect_nonempty=True,
        selected_point_ids=["p1", "p2"],
        itinerary=OracleItinerary(ordered_point_count=3, source_row_count=4),
    ),
    OracleScenario(
        case_id="candidate_selection_min_steps",
        query=JA_QUERY,
        locale="ja",
        intent="plan_multi",
        message=JA_REPLY,
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
        query=EN_QUERY,
        locale="en",
        intent="plan_multi",
        message=EN_REPLY,
        acceptable_stages=["plan_multi"],
        steps=[
            OracleStep(
                tool="plan_multi",
                args={},
                params={"candidate_ids": ["c1", "c2"]},
                model_initiated=False,
            )
        ],
        data_keys=["results", "route"],
        expect_nonempty=True,
        selected_candidate_ids=["c1", "c2"],
        search_row_count=6,
        itinerary=OracleItinerary(ordered_point_count=2, source_row_count=6),
    ),
]

PLACE_SELECTION_SCENARIOS: list[OracleScenario] = [
    OracleScenario(
        case_id="place_selection_calls_the_stage_it_names",
        query="Use Uji",
        locale="ja",
        intent="search_nearby",
        message=EN_REPLY,
        acceptable_stages=["search_nearby"],
        steps=[
            OracleStep(
                tool="search_nearby",
                args={},
                params={"candidate_id": "seed:uji", "radius_m": 3000},
                model_initiated=False,
            )
        ],
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
        message=EN_REPLY,
        acceptable_stages=["search_nearby"],
        data_keys=["results"],
        expect_nonempty=True,
        selected_candidate_ids=["seed:uji"],
        seeded_pending={"reason": "place_ambiguity"},
        clarification_id=6,
    ),
]
