from __future__ import annotations

import pytest
from pydantic_evals.evaluators import EvaluatorContext

from animichi.agents.agent_result import AgentResult, StepRecord
from animichi.tests.eval.evaluators import (
    AgentExpected,
    AgentInput,
    StepEfficiency,
)
from animichi.tests.eval.official_evaluators import (
    OfficialToolCorrectness,
    OfficialTrajectoryMatch,
)
from animichi.tests.unit.eval_evaluator_fixtures import (
    JA,
    ctx,
    result,
    span_tree,
    steps,
    tool_span,
)


def _official_context(
    tools: list[str],
    stages: list[str],
    *,
    inputs: AgentInput = JA,
    runtime_steps: list[StepRecord] | None = None,
) -> EvaluatorContext[AgentInput, AgentResult, AgentExpected]:
    spans = [tool_span(tool, {}, index) for index, tool in enumerate(tools)]
    return ctx(
        inputs,
        result(runtime_steps if runtime_steps is not None else steps(*tools)),
        AgentExpected(stages),
        span_tree(*spans),
    )


@pytest.mark.parametrize(
    ("tools", "stages", "expected"),
    [
        (["resolve_anime", "search_bangumi"], ["search_bangumi"], 1.0),
        (["search_bangumi"], ["search_bangumi"], 0.0),
        (["resolve_anime", "search_bangumi", "plan_route"], ["plan_route"], 1.0),
        ([], ["general_qa"], 1.0),
        (["resolve_anime"], ["general_qa"], 0.0),
        ([], ["general_qa", "clarify"], 1.0),
        (["resolve_anime"], ["general_qa", "clarify"], 1.0),
        ([], [], 1.0),
    ],
)
def test_tool_correctness_scores_best_acceptable_stage(
    tools: list[str], stages: list[str], expected: float
) -> None:
    evaluator_ctx = _official_context(tools, stages)
    assert OfficialToolCorrectness().evaluate(evaluator_ctx) == {
        "tool_correctness": expected
    }


def test_official_metrics_penalize_extra_clarify_tool_call() -> None:
    evaluator_ctx = _official_context(["resolve_anime", "search_bangumi"], ["clarify"])

    assert OfficialToolCorrectness().evaluate(evaluator_ctx) == {
        "tool_correctness": 0.0
    }
    assert OfficialTrajectoryMatch().evaluate(evaluator_ctx) == {
        "trajectory_match": pytest.approx(2 / 3)
    }


@pytest.mark.parametrize(
    ("tools", "stages", "expected"),
    [
        (["resolve_anime", "search_bangumi", "plan_route"], ["plan_route"], 1.0),
        (
            ["plan_route", "resolve_anime", "search_bangumi"],
            ["plan_route"],
            pytest.approx(2 / 3),
        ),
        (["resolve_anime", "search_bangumi"], ["plan_route"], 0.8),
        (["resolve_anime"], ["general_qa", "clarify"], 1.0),
        (["search_bangumi"], ["general_qa", "clarify"], 0.0),
        (["search_nearby"], ["plan_route", "general_qa"], 0.0),
        (["resolve_anime"], ["general_qa"], 0.0),
        (["search_nearby"], ["clarify_after_nearby"], 1.0),
        ([], ["general_qa"], 1.0),
    ],
)
def test_trajectory_match_scores_ordered_chains(
    tools: list[str], stages: list[str], expected: float
) -> None:
    evaluator_ctx = _official_context(tools, stages)
    assert OfficialTrajectoryMatch().evaluate(evaluator_ctx) == {
        "trajectory_match": expected
    }


@pytest.mark.parametrize(
    ("steps", "stages", "expected"),
    [
        (steps("resolve_anime", "search_bangumi"), ["search_bangumi"], 1.0),
        (
            steps(
                "resolve_anime",
                "search_bangumi",
                "resolve_anime",
                "search_bangumi",
                "plan_route",
            ),
            ["search_bangumi"],
            0.4,
        ),
        (
            steps("geocode", "search_nearby", "clarify"),
            ["clarify_after_nearby"],
            1.0,
        ),
        (
            steps("clarify", "resolve_anime", "search_bangumi"),
            ["clarify", "search_bangumi"],
            pytest.approx(2 / 3),
        ),
    ],
)
def test_step_efficiency_scores_best_acceptable_minimum(
    steps: list[StepRecord], stages: list[str], expected: float
) -> None:
    evaluator_ctx = ctx(JA, result(steps), AgentExpected(stages))
    assert dict(StepEfficiency().evaluate(evaluator_ctx)) == {
        "step_efficiency": expected
    }


def test_step_efficiency_scores_direct_general_qa_as_ideal() -> None:
    """Zero steps IS the ideal here, so the turn keeps the ceiling."""
    evaluator_ctx = ctx(JA, result(steps()), AgentExpected(["general_qa"]))
    assert dict(StepEfficiency().evaluate(evaluator_ctx)) == {"step_efficiency": 1.0}


def test_step_efficiency_is_unmeasured_when_a_required_step_never_happened() -> None:
    """#1439: no step and no zero-step ideal leaves nothing to divide."""
    evaluator_ctx = ctx(JA, result(steps()), AgentExpected(["search_bangumi"]))
    assert dict(StepEfficiency().evaluate(evaluator_ctx)) == {}


def test_plan_multi_trajectory_scales_with_unique_candidates() -> None:
    inputs = AgentInput(
        query="pick both", locale="en", selected_candidate_ids=["1", "1", "2"]
    )
    complete = result(steps("search_bangumi", "search_bangumi", "plan_multi"))
    incomplete = result(steps("search_bangumi", "plan_multi"))
    expected = AgentExpected(["plan_multi"])

    complete_ctx = _official_context(
        [], ["plan_multi"], inputs=inputs, runtime_steps=complete.steps
    )
    incomplete_ctx = _official_context(
        [], ["plan_multi"], inputs=inputs, runtime_steps=incomplete.steps
    )
    assert OfficialTrajectoryMatch().evaluate(complete_ctx) == {"trajectory_match": 1.0}
    assert OfficialTrajectoryMatch().evaluate(incomplete_ctx) == {
        "trajectory_match": 1.0
    }
    assert StepEfficiency().evaluate(ctx(inputs, complete, expected)) == {
        "step_efficiency": 1.0
    }
