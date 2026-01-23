"""Tests for RoutePlanningAgent determinism (ADK-005).

These tests verify that RoutePlanningAgent:
1. Is a BaseAgent (not LlmAgent) - no LLM calls
2. Produces deterministic output given same input
3. Correctly writes to session state
"""

import pytest
from google.adk.agents import BaseAgent, LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.sessions import InMemorySessionService
from google.adk.sessions.session import Session
from google.genai import types

from adk_agents.seichijunrei_bot._agents.route_planning_agent import (
    RoutePlanningAgent,
    route_planning_agent,
)
from adk_agents.seichijunrei_bot._state import (
    EXTRACTION_RESULT,
    POINTS_SELECTION_RESULT,
    ROUTE_PLAN,
    SELECTED_BANGUMI,
)


def _make_ctx(agent: BaseAgent, *, state: dict) -> InvocationContext:
    session_service = InMemorySessionService()
    session = Session(
        id="test-session", app_name="test", user_id="test-user", state=state
    )
    return InvocationContext(
        session_service=session_service,
        invocation_id="inv-test",
        agent=agent,
        user_content=types.Content(role="user", parts=[types.Part(text="")]),
        session=session,
    )


class TestRoutePlanningAgentDeterminism:
    """ADK-005: Verify RoutePlanningAgent is deterministic."""

    def test_is_base_agent_not_llm_agent(self) -> None:
        """RoutePlanningAgent should be BaseAgent, not LlmAgent."""
        assert isinstance(route_planning_agent, BaseAgent)
        assert not isinstance(route_planning_agent, LlmAgent)

    def test_has_no_model_attribute(self) -> None:
        """RoutePlanningAgent should not have a model attribute."""
        # LlmAgent has a 'model' attribute for the LLM
        assert (
            not hasattr(route_planning_agent, "model")
            or route_planning_agent.model is None
        )

    @pytest.mark.asyncio
    async def test_produces_deterministic_output(self) -> None:
        """Same input should produce same output."""
        state = {
            EXTRACTION_RESULT: {"location": "Tokyo"},
            SELECTED_BANGUMI: {"bangumi_title": "Test Anime"},
            POINTS_SELECTION_RESULT: {
                "selected_points": [
                    {"name": "Point A", "lat": 35.6, "lng": 139.7},
                    {"name": "Point B", "lat": 35.7, "lng": 139.8},
                ]
            },
        }

        agent = RoutePlanningAgent()

        # Run twice with same input
        ctx1 = _make_ctx(agent, state=state.copy())
        _ = [e async for e in agent.run_async(ctx1)]

        ctx2 = _make_ctx(agent, state=state.copy())
        _ = [e async for e in agent.run_async(ctx2)]

        # Both should produce route_plan in state
        assert ROUTE_PLAN in ctx1.session.state
        assert ROUTE_PLAN in ctx2.session.state

        # Output should be identical
        plan1 = ctx1.session.state[ROUTE_PLAN]
        plan2 = ctx2.session.state[ROUTE_PLAN]
        assert plan1 == plan2

    @pytest.mark.asyncio
    async def test_writes_route_plan_to_state(self) -> None:
        """RoutePlanningAgent should write route_plan to session state."""
        state = {
            EXTRACTION_RESULT: {"location": "Uji"},
            SELECTED_BANGUMI: {"bangumi_title": "Hibike! Euphonium"},
            POINTS_SELECTION_RESULT: {
                "selected_points": [
                    {"name": "Uji Bridge", "lat": 34.88, "lng": 135.8},
                ]
            },
        }

        agent = RoutePlanningAgent()
        ctx = _make_ctx(agent, state=state)

        _ = [e async for e in agent.run_async(ctx)]

        assert ROUTE_PLAN in ctx.session.state
        plan = ctx.session.state[ROUTE_PLAN]
        assert isinstance(plan, dict)
        assert "recommended_order" in plan
        assert "route_description" in plan

    @pytest.mark.asyncio
    async def test_handles_empty_points(self) -> None:
        """RoutePlanningAgent should handle empty points list."""
        state = {
            EXTRACTION_RESULT: {"location": "Tokyo"},
            SELECTED_BANGUMI: {"bangumi_title": "Test Anime"},
            POINTS_SELECTION_RESULT: {"selected_points": []},
        }

        agent = RoutePlanningAgent()
        ctx = _make_ctx(agent, state=state)

        _ = [e async for e in agent.run_async(ctx)]

        assert ROUTE_PLAN in ctx.session.state
        plan = ctx.session.state[ROUTE_PLAN]
        assert plan["recommended_order"] == []

    @pytest.mark.asyncio
    async def test_handles_missing_state_gracefully(self) -> None:
        """RoutePlanningAgent should handle missing state keys."""
        state = {}  # Empty state

        agent = RoutePlanningAgent()
        ctx = _make_ctx(agent, state=state)

        _ = [e async for e in agent.run_async(ctx)]

        # Should still produce a plan (with empty values)
        assert ROUTE_PLAN in ctx.session.state
