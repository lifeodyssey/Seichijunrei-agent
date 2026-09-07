"""Deterministic L0 trajectory assertions (S1.13 pilot).

Every assertion here runs on a recorded trace alone — no model call, no judge.
Card AC: expected tool set/order + over-repetition detection + step ceiling.
"""

from __future__ import annotations

from animichi.tests.eval.direct_gates import RecordedToolCall, TrajectoryCase
from animichi.tests.eval.evaluators import (
    AgentExpected,
    accepted_chains_for_case,
)
from animichi.tests.eval.trajectory_assertions import (
    TrajectoryExpectation,
    case_assertion_failures,
    trajectory_assertion_failures,
)

_SEARCH_CHAIN = (("resolve_anime", "search_bangumi"),)


def _expectation(
    observed: tuple[str, ...], accepted: tuple[tuple[str, ...], ...] = _SEARCH_CHAIN
) -> TrajectoryExpectation:
    return TrajectoryExpectation("A1_ja_001", observed, accepted)


def _case(tools: tuple[str, ...]) -> TrajectoryCase:
    calls = tuple(RecordedToolCall.from_arguments(tool, {}) for tool in tools)
    return TrajectoryCase("A1_ja_001", requests=len(tools), tool_calls=calls)


def test_exact_accepted_chain_passes() -> None:
    assert (
        case_assertion_failures(_expectation(("resolve_anime", "search_bangumi"))) == []
    )


def test_unexpected_tool_is_named() -> None:
    failures = case_assertion_failures(_expectation(("resolve_anime", "plan_route")))

    assert "unexpected tools [plan_route]" in failures[0]
    assert "missing tools [search_bangumi]" in failures[0]


def test_right_tools_wrong_order_is_reported_as_an_order_violation() -> None:
    failures = case_assertion_failures(
        _expectation(("search_bangumi", "resolve_anime"))
    )

    assert "tool order [search_bangumi, resolve_anime]" in failures[0]
    assert "unexpected tools" not in failures[0]


def test_over_repeated_tool_is_detected() -> None:
    observed = ("resolve_anime", "resolve_anime", "search_bangumi")

    failures = case_assertion_failures(_expectation(observed))

    assert any("more often than any accepted chain allows" in f for f in failures)
    assert any("[resolve_anime]" in f for f in failures)


def test_step_ceiling_violation_is_detected() -> None:
    observed = ("resolve_anime", "search_bangumi", "search_nearby", "plan_route")

    failures = case_assertion_failures(_expectation(observed))

    assert any("exceed the accepted ceiling of 2" in f for f in failures)


def test_disjunction_of_chains_accepts_either_branch() -> None:
    expectation = _expectation(("resolve_anime",), (("resolve_anime",), ()))

    assert case_assertion_failures(expectation) == []


def test_empty_accepted_chain_requires_an_empty_trace() -> None:
    assert case_assertion_failures(_expectation((), ((),))) == []


def test_tool_call_when_none_accepted_is_a_ceiling_and_set_violation() -> None:
    failures = case_assertion_failures(_expectation(("web_search",), ((),)))

    assert any("unexpected tools [web_search]" in f for f in failures)
    assert any("exceed the accepted ceiling of 0" in f for f in failures)


def test_case_with_no_accepted_chains_is_not_asserted() -> None:
    assert case_assertion_failures(_expectation(("resolve_anime",), ())) == []


def test_failures_aggregate_across_cases() -> None:
    good = _expectation(("resolve_anime", "search_bangumi"))
    bad = TrajectoryExpectation("A2_zh_002", ("plan_route",), _SEARCH_CHAIN)

    failures = trajectory_assertion_failures([good, bad])

    assert len(failures) == 2
    assert all("A2_zh_002" in failure for failure in failures)


def test_expectation_is_built_from_a_recorded_trace_and_dataset_stages() -> None:
    metadata = AgentExpected(acceptable_stages=["search_bangumi"])

    expectation = TrajectoryExpectation.from_case(
        _case(("resolve_anime", "search_bangumi")),
        accepted_chains_for_case(metadata),
    )

    assert expectation.observed == ("resolve_anime", "search_bangumi")
    assert case_assertion_failures(expectation) == []


def test_point_selection_accepts_the_step_the_wire_publishes() -> None:
    """#1461: the bypass makes no span in process and one tool part on the wire."""
    chains = accepted_chains_for_case(AgentExpected(["plan_selected"]))

    assert chains == [(), ("plan_selected",)]


def test_multi_selection_accepts_the_step_the_wire_publishes() -> None:
    """#1454: the bypass makes no span in process and one tool part on the wire."""
    chains = accepted_chains_for_case(AgentExpected(["plan_multi"]))

    assert chains == [(), ("plan_multi",)]


def test_place_selection_still_expects_the_call_its_stage_names() -> None:
    """#1439: a selection whose stage names a tool must not accept nothing."""
    chains = accepted_chains_for_case(AgentExpected(["search_nearby"]))

    assert chains == [("search_nearby",)]
