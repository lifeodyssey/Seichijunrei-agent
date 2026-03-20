"""Unit tests for PlannerAgent — deterministic intent-to-plan mapping."""

from __future__ import annotations

import pytest

from agents.intent_agent import ExtractedParams, IntentOutput
from agents.planner_agent import ExecutionPlan, ExecutionStep, StepType, create_plan


class TestStepType:
    """Test StepType enum values."""

    def test_values(self):
        assert StepType.QUERY_DB == "query_db"
        assert StepType.PLAN_ROUTE == "plan_route"
        assert StepType.FORMAT_RESPONSE == "format_response"


class TestExecutionStep:
    """Test ExecutionStep model."""

    def test_defaults(self):
        step = ExecutionStep(step_type=StepType.QUERY_DB, description="test")
        assert step.params == {}

    def test_with_params(self):
        step = ExecutionStep(
            step_type=StepType.QUERY_DB,
            description="test",
            params={"bangumi": "927"},
        )
        assert step.params["bangumi"] == "927"


class TestCreatePlan:
    """Test create_plan() for each intent type."""

    def _make_intent(self, intent: str, **kwargs) -> IntentOutput:
        return IntentOutput(
            intent=intent,
            confidence=0.95,
            extracted_params=ExtractedParams(**kwargs),
        )

    def test_search_by_bangumi(self):
        intent = self._make_intent("search_by_bangumi", bangumi="927")
        plan = create_plan(intent)
        assert plan.intent == "search_by_bangumi"
        assert len(plan.steps) == 2
        assert plan.steps[0].step_type == StepType.QUERY_DB
        assert plan.steps[1].step_type == StepType.FORMAT_RESPONSE
        assert plan.steps[0].params["bangumi"] == "927"

    def test_search_by_location(self):
        intent = self._make_intent("search_by_location", location="宇治")
        plan = create_plan(intent)
        assert plan.intent == "search_by_location"
        assert len(plan.steps) == 2
        assert plan.steps[0].step_type == StepType.QUERY_DB
        assert plan.steps[0].params["location"] == "宇治"

    def test_plan_route(self):
        intent = self._make_intent("plan_route", bangumi="115908", origin="京都站")
        plan = create_plan(intent)
        assert plan.intent == "plan_route"
        assert len(plan.steps) == 3
        assert plan.steps[0].step_type == StepType.QUERY_DB
        assert plan.steps[1].step_type == StepType.PLAN_ROUTE
        assert plan.steps[2].step_type == StepType.FORMAT_RESPONSE

    def test_general_qa(self):
        intent = self._make_intent("general_qa")
        plan = create_plan(intent)
        assert plan.intent == "general_qa"
        assert len(plan.steps) == 1
        assert plan.steps[0].step_type == StepType.FORMAT_RESPONSE

    def test_unclear(self):
        intent = self._make_intent("unclear")
        plan = create_plan(intent)
        assert plan.intent == "unclear"
        assert len(plan.steps) == 1
        assert plan.steps[0].step_type == StepType.FORMAT_RESPONSE

    def test_unknown_intent(self):
        intent = self._make_intent("nonexistent_intent")
        plan = create_plan(intent)
        assert len(plan.steps) == 1
        assert plan.steps[0].step_type == StepType.FORMAT_RESPONSE
        assert "Unknown intent" in plan.steps[0].description

    def test_params_exclude_none(self):
        """Only non-None params should be in step params."""
        intent = self._make_intent("search_by_bangumi", bangumi="927")
        plan = create_plan(intent)
        assert "bangumi" in plan.steps[0].params
        assert "location" not in plan.steps[0].params
        assert "episode" not in plan.steps[0].params

    def test_plan_is_valid_pydantic(self):
        intent = self._make_intent("search_by_bangumi", bangumi="927")
        plan = create_plan(intent)
        assert isinstance(plan, ExecutionPlan)
        dumped = plan.model_dump()
        assert "steps" in dumped
        assert "intent" in dumped
