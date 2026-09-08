"""Dump Python evaluator scores as the TS port's oracle fixture (#1301).

`packages/eval/src/evaluators/` re-implements these eight evaluators in
TypeScript over W3-2's wire transcript (`packages/eval/src/turn-transcript.ts`)
instead of an OTel span tree. Its tests must compare against Python's *numbers*,
not against a second derivation of the same formulas — so this script runs the
real Python evaluators over the scenarios in `evaluator_oracle_cases.py` and
writes, per scenario, both the transcript the TS side reads and the scores it
has to reproduce.

The transcript view here is `transcriptResultOf`'s output shape, projected from
the same scenario the Python objects are built from — so the two views cannot
drift apart within one case. `dataKeys` is Python's own `_available_data_keys`
rather than a re-derivation, which makes this an oracle for W3-2's `dataKeysOf`
as well.

Run: `cd apps/agent && uv run python -m animichi.tests.eval.evaluator_oracle`
(the export script does it for you; the fixture-drift gate then compares).
"""

from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel

from animichi.tests.eval.evaluator_oracle_cases import SCENARIOS
from animichi.tests.eval.evaluator_oracle_context import evaluator_context
from animichi.tests.eval.evaluator_oracle_scenarios import (
    OracleScenario,
    OracleStep,
    StepOrigin,
    StepStatus,
)
from animichi.tests.eval.evaluators import (
    EVALUATOR_VERSION,
    DataKeysPresent,
    LocaleMatch,
    NonemptyResults,
    StepEfficiency,
    _available_data_keys,
)
from animichi.tests.eval.metric_names_oracle import (
    MetricNamesSection,
    metric_names_section,
)
from animichi.tests.eval.official_evaluators import (
    OfficialArgumentCorrectness,
    OfficialMaxToolCalls,
    OfficialToolCorrectness,
    OfficialTrajectoryMatch,
)

FIXTURE_PATH = (
    Path(__file__).parents[6]
    / "packages"
    / "eval"
    / "fixtures"
    / "evaluator-oracle.json"
)

_EVALUATORS = (
    OfficialArgumentCorrectness(),
    OfficialToolCorrectness(),
    OfficialTrajectoryMatch(),
    OfficialMaxToolCalls(),
    DataKeysPresent(),
    LocaleMatch(),
    NonemptyResults(),
    StepEfficiency(),
)

_CLARIFY_INTENT = "clarify"
_ROUTE_INTENTS = frozenset({"plan_route", "plan_selected", "plan_multi"})


class _WireStep(BaseModel):
    """One call as `turn-transcript.ts` publishes it."""

    toolName: str
    # An open map on purpose: tool arguments are `Mapping[str, object]` at the
    # source and arbitrary JSON on the wire (`packages/eval/AGENTS.md`).
    args: dict[str, object]
    # The second witness (#1381): `args` is what the SD-9 stream published, this
    # is what `GET /v1/conversations/{id}/messages` publishes for the same call.
    params: dict[str, object]
    status: StepStatus
    # Who asked for the call (#1462): `StepRecord.model_initiated` as the frames
    # publish it, which the shaper resolves for every step — absent on the wire
    # means the model asked, and `TranscriptStep.origin` is never absent.
    origin: StepOrigin


class _WireAnswer(BaseModel):
    """The `data-response` part, as `answerOf` reads it."""

    intent: str
    success: bool
    message: str
    data: dict[str, object]


class _WireTranscript(BaseModel):
    """`TranscriptResult` — what W3-2's shaper hands the evaluators."""

    intent: str
    success: bool
    message: str
    locale: str
    dataKeys: list[str]
    stepCount: int
    # Whether the transcript read published a step record at all (#1381). The
    # in-process runner always recorded params, so every scenario here is a
    # turn the second witness WAS offered for; the wire's other answer (no
    # `steps` array at all) is a page shape Python never serves.
    paramsRecorded: bool
    trajectory: list[_WireStep]
    response: _WireAnswer | None
    runStatus: str | None


class _CaseInputs(BaseModel):
    """`AgentInput` on the wire — snake_case, as the exporter writes it."""

    clarification_id: int | None
    context: dict[str, object] | None
    locale: str
    query: str
    seeded_pending: dict[str, object] | None
    selected_candidate_ids: list[str] | None
    selected_point_ids: list[str] | None


class _CaseExpected(BaseModel):
    """`AgentExpected` on the wire."""

    acceptable_stages: list[str]
    data_keys: list[str]
    expect_nonempty: bool


class _OracleCase(BaseModel):
    """One scenario as the TS test consumes it: the inputs and Python's scores."""

    caseId: str
    inputs: _CaseInputs
    metadata: _CaseExpected
    transcript: _WireTranscript
    scores: dict[str, float]


class EvaluatorOracle(BaseModel):
    """The whole fixture: metric-name parity plus one row per scenario."""

    generatedBy: str
    evaluatorVersion: str
    metricNames: MetricNamesSection
    cases: list[_OracleCase]


def _scores(scenario: OracleScenario) -> dict[str, float]:
    ctx = evaluator_context(scenario)
    scores: dict[str, float] = {}
    for evaluator in _EVALUATORS:
        scores.update(evaluator.evaluate(ctx))
    return scores


def _wire_step(step: OracleStep) -> _WireStep:
    return _WireStep(
        toolName=step.tool,
        args=dict(step.args),
        params=step.settled_params,
        status=step.status,
        origin="model" if step.model_initiated else "server",
    )


def _clarification_data(scenario: OracleScenario) -> dict[str, object]:
    if not scenario.pending_clarification:
        return {}
    return {"reason": "anime_ambiguity", "candidates": [{"id": "c1"}]}


def _itinerary_data(scenario: OracleScenario) -> dict[str, object]:
    """A routed turn republishes its itinerary's *source* search as `results`.

    That is the wire's only stand-in for `_nonempty`'s `source_ref` hop: the
    stream carries points and row counts, never a ref to follow.
    """
    itinerary = scenario.itinerary
    if itinerary is None or scenario.intent not in _ROUTE_INTENTS:
        return {}
    points = [f"p{index}" for index in range(itinerary.ordered_point_count)]
    data: dict[str, object] = {"itinerary": {"ordered_points": points}}
    if itinerary.source_row_count is not None:
        data["results"] = {"row_count": itinerary.source_row_count}
    return data


def _published_data(scenario: OracleScenario) -> dict[str, object]:
    """The answer `data` the edge publishes for this turn."""
    if scenario.intent == _CLARIFY_INTENT:
        return _clarification_data(scenario)
    data: dict[str, object] = {}
    if scenario.search_row_count is not None:
        data["results"] = {"row_count": scenario.search_row_count}
    return data | _itinerary_data(scenario)


def _wire_answer(scenario: OracleScenario) -> _WireAnswer:
    return _WireAnswer(
        intent=scenario.intent,
        success=True,
        message=scenario.message,
        data=_published_data(scenario),
    )


def _wire_transcript(scenario: OracleScenario) -> _WireTranscript:
    answer = _wire_answer(scenario)
    result = evaluator_context(scenario).output
    return _WireTranscript(
        intent=answer.intent,
        success=answer.success,
        message=answer.message,
        locale=scenario.locale,
        dataKeys=sorted(_available_data_keys(result)),
        stepCount=len(scenario.steps),
        paramsRecorded=True,
        trajectory=[_wire_step(step) for step in scenario.steps],
        response=answer,
        runStatus="succeeded",
    )


def _case_inputs(scenario: OracleScenario) -> _CaseInputs:
    return _CaseInputs(
        clarification_id=scenario.clarification_id,
        context=None,
        locale=scenario.locale,
        query=scenario.query,
        seeded_pending=scenario.seeded_pending,
        selected_candidate_ids=scenario.selected_candidate_ids,
        selected_point_ids=scenario.selected_point_ids,
    )


def _oracle_case(scenario: OracleScenario) -> _OracleCase:
    return _OracleCase(
        caseId=scenario.case_id,
        inputs=_case_inputs(scenario),
        metadata=_CaseExpected(
            acceptable_stages=list(scenario.acceptable_stages),
            data_keys=list(scenario.data_keys),
            expect_nonempty=scenario.expect_nonempty,
        ),
        transcript=_wire_transcript(scenario),
        scores=_scores(scenario),
    )


def build_oracle() -> EvaluatorOracle:
    return EvaluatorOracle(
        generatedBy="apps/agent/src/animichi/tests/eval/evaluator_oracle.py",
        evaluatorVersion=EVALUATOR_VERSION,
        metricNames=metric_names_section(),
        cases=[_oracle_case(scenario) for scenario in SCENARIOS],
    )


def main() -> None:
    FIXTURE_PATH.write_text(
        build_oracle().model_dump_json(indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
