"""The oracle scenarios that pin `resolve_reply_language`'s decision points.

Split out of ``evaluator_oracle_cases.py`` (#1493). Four turns whose only job is
`locale_match`: an empty message, a reply in the wrong language, a simplified-Han
query the requested locale must not override, and a Han-only query that falls
back to it.
"""

from __future__ import annotations

from animichi.tests.eval.evaluator_oracle_scenarios import (
    EN_QUERY,
    OracleScenario,
    OracleStep,
)

REPLY_LANGUAGE_SCENARIOS: list[OracleScenario] = [
    OracleScenario(
        case_id="empty_message_locale_zero",
        query=EN_QUERY,
        locale="en",
        intent="general_qa",
        message="",
        acceptable_stages=["general_qa"],
    ),
    OracleScenario(
        case_id="reply_language_mismatch",
        query=EN_QUERY,
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
]
