"""Rebuild one oracle scenario into the objects the Python evaluators read.

The official agentic evaluators walk an OTel span tree; the project-specific
ones walk `AgentResult` and the session registries. This module reconstructs
both from a single scenario, which is what makes the two views consistent by
construction.

Every call in a scenario gets a span, so the span tree, `AgentResult.steps` and
W3-2's `trajectory` are the same list here, which is what lets `stepCount` mean
the same thing on both sides. That is a statement about this rebuild, NOT about
the runtime: a deterministic bypass publishes a `tool-input-start` frame exactly
like a model call does and produces no span at all (#1454), and giving it one
here is what keeps the two views of a bypass scenario scoring the same trajectory
metrics. `candidate_selection_published_step`, `point_selection_published_step`
and `place_selection_calls_the_stage_it_names` are that shape written down, one
per bypass stage (#1461, #1462).

What a scenario CAN now say is who asked for the call (`model_initiated`, #1462).
It reaches `StepRecord` and the wire's `origin`, and nothing else: the span stays
because the trajectory ports read it. Only `OfficialArgumentCorrectness` filters
on it, and it pairs by occurrence over the spans — so a scenario must not mix a
server-initiated and a model-initiated call to the SAME tool, a turn the runtime
cannot produce anyway (a bypass turn makes no model call at all).

An `unsettled` call — made, never settled — is given a span status of `error`
and `is_success=False`: `include_failed=False` must exclude it, since its
arguments were never answered for. `MaxToolCalls` still counts it, because it
still spent the budget.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

from pydantic_evals.evaluators import EvaluatorContext
from pydantic_evals.otel.span_tree import SpanNode, SpanTree

from animichi.agents.agent_result import (
    AgentResult,
    ProducedItinerary,
    ProducedSearch,
    StepRecord,
    TurnProvenance,
)
from animichi.agents.runtime_models import QAResponseModel
from animichi.agents.session_state import (
    ItineraryPayloadState,
    ItineraryRef,
    PendingClarification,
    PointState,
    ResultRef,
    SearchPayloadState,
    SessionState,
)
from animichi.tests.eval.evaluator_oracle_scenarios import OracleScenario, OracleStep
from animichi.tests.eval.evaluators import AgentExpected, AgentInput

_SEARCH_REF = ResultRef("search:bangumi:1")
_SOURCE_REF = ResultRef("search:source:1")
_ITINERARY_REF = ItineraryRef("route:plan:1")
_EPOCH = datetime(2026, 1, 1, tzinfo=UTC)


def succeeded(step: OracleStep) -> bool:
    """Only a settled, successful call is `is_success` / a non-error span."""
    return step.status == "ok"


def _agent_input(scenario: OracleScenario) -> AgentInput:
    return AgentInput(
        query=scenario.query,
        locale=scenario.locale,
        selected_point_ids=scenario.selected_point_ids,
        selected_candidate_ids=scenario.selected_candidate_ids,
        clarification_id=scenario.clarification_id,
        seeded_pending=scenario.seeded_pending,
    )


def _agent_expected(scenario: OracleScenario) -> AgentExpected:
    return AgentExpected(
        acceptable_stages=list(scenario.acceptable_stages),
        data_keys=list(scenario.data_keys),
        expect_nonempty=scenario.expect_nonempty,
    )


def _session_state(scenario: OracleScenario) -> SessionState:
    state = SessionState()
    if scenario.search_row_count is not None:
        state.search_results[_SEARCH_REF] = SearchPayloadState(
            kind="bangumi", row_count=scenario.search_row_count
        )
    _add_itinerary(state, scenario)
    if scenario.pending_clarification:
        state.pending_clarification = PendingClarification(
            reason="anime_ambiguity", candidate_ids=["c1"], revision=1
        )
    return state


def _add_itinerary(state: SessionState, scenario: OracleScenario) -> None:
    itinerary = scenario.itinerary
    if itinerary is None:
        return
    source_ref = _source_ref(state, itinerary.source_row_count)
    state.itineraries[_ITINERARY_REF] = ItineraryPayloadState(
        ordered_points=[PointState() for _ in range(itinerary.ordered_point_count)],
        source_ref=source_ref,
    )


def _source_ref(state: SessionState, row_count: int | None) -> ResultRef | None:
    if row_count is None:
        return None
    state.search_results[_SOURCE_REF] = SearchPayloadState(
        kind="bangumi", row_count=row_count
    )
    return _SOURCE_REF


def _provenance(scenario: OracleScenario) -> TurnProvenance:
    return TurnProvenance(
        search=(
            ProducedSearch(outcome="ok", result_ref=_SEARCH_REF)
            if scenario.search_row_count is not None
            else None
        ),
        itinerary=(
            ProducedItinerary(status="ok", itinerary_ref=_ITINERARY_REF)
            if scenario.itinerary is not None
            else None
        ),
    )


def _step_record(step: OracleStep) -> StepRecord:
    """The runner's record: what the tool ran with, which is not always what the
    model asked with (#1381). The span below keeps the model's own arguments,
    and `OfficialArgumentCorrectness` scores the two against each other."""
    return StepRecord(
        tool=step.tool,
        is_success=succeeded(step),
        params=step.settled_params,
        model_initiated=step.model_initiated,
    )


def _agent_result(scenario: OracleScenario) -> AgentResult:
    return AgentResult(
        output=QAResponseModel(message=scenario.message),
        intent=scenario.intent,
        session_state=_session_state(scenario),
        steps=[_step_record(step) for step in scenario.steps],
        provenance=_provenance(scenario),
    )


def _span_attributes(step: OracleStep) -> dict[str, str]:
    return {
        "gen_ai.tool.name": step.tool,
        "tool_arguments": json.dumps(dict(step.args)),
    }


def _span(index: int, step: OracleStep) -> SpanNode:
    moment = _EPOCH + timedelta(seconds=index)
    return SpanNode(
        name="running tool",
        trace_id=1,
        span_id=index + 1,
        parent_span_id=None,
        start_timestamp=moment,
        end_timestamp=moment,
        attributes=dict(_span_attributes(step)),
        status="ok" if succeeded(step) else "error",
    )


def _span_tree(scenario: OracleScenario) -> SpanTree:
    tree = SpanTree()
    tree.add_spans([_span(index, step) for index, step in enumerate(scenario.steps)])
    return tree


def evaluator_context(
    scenario: OracleScenario,
) -> EvaluatorContext[AgentInput, AgentResult, AgentExpected]:
    return EvaluatorContext(
        name=scenario.case_id,
        inputs=_agent_input(scenario),
        metadata=_agent_expected(scenario),
        expected_output=None,
        output=_agent_result(scenario),
        duration=0.0,
        _span_tree=_span_tree(scenario),
        attributes={},
        metrics={},
    )
