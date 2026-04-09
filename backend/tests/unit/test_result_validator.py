"""Unit tests for the ReAct output_validator logic.

Tests the validation rules directly without needing an LLM.
The validator rejects premature done and enforces step prerequisites.
"""

from __future__ import annotations

import pytest
from pydantic_ai import ModelRetry

from backend.agents.intent_classifier import QueryIntent
from backend.agents.models import (
    DoneSignal,
    Observation,
    PlanStep,
    ReactStep,
    ToolName,
)
from backend.agents.planner_agent import ReActDeps


def _obs(tool: str, *, success: bool = True, summary: str = "") -> Observation:
    """Helper to create an Observation."""
    return Observation(tool=tool, success=success, summary=summary or f"{tool} result")


def _done_step(message: str = "Here are the results") -> ReactStep:
    """Helper to create a ReactStep with done signal."""
    return ReactStep(thought="done", done=DoneSignal(message=message))


def _action_step(tool: ToolName, **params: object) -> ReactStep:
    """Helper to create a ReactStep with an action."""
    return ReactStep(
        thought=f"calling {tool.value}",
        action=PlanStep(tool=tool, params=params),
    )


def _deps(
    history: list[Observation] | None = None,
    intent: QueryIntent = QueryIntent.AMBIGUOUS,
) -> ReActDeps:
    """Helper to create ReActDeps."""
    return ReActDeps(
        history=history or [],
        classified_intent=intent,
        query="test query",
        locale="ja",
    )


# ── Extract validator logic for direct testing ──
# The actual validator is registered on the agent instance.
# We test the logic by reimplementing the same checks.


def _validate_done(deps: ReActDeps, result: ReactStep) -> ReactStep:
    """Replicates the done-validation logic from the output_validator."""
    if result.done is None:
        return result

    history = deps.history
    intent = deps.classified_intent

    has_bangumi_search = any(o.tool == "search_bangumi" and o.success for o in history)
    needs_bangumi_search = intent in (
        QueryIntent.ANIME_SEARCH,
        QueryIntent.ROUTE_PLAN,
    )

    if needs_bangumi_search and not has_bangumi_search:
        raise ModelRetry(
            "You resolved the anime but haven't searched for spots yet. "
            "Call search_bangumi with the bangumi_id from your "
            "resolve_anime observation."
        )

    has_route = any(o.tool == "plan_route" and o.success for o in history)
    if intent == QueryIntent.ROUTE_PLAN and not has_route and has_bangumi_search:
        raise ModelRetry(
            "The user asked for a route but you only searched for "
            "spots. Call plan_route with the search results."
        )

    return result


def _validate_action(deps: ReActDeps, result: ReactStep) -> ReactStep:
    """Replicates the action-validation logic from the output_validator."""
    from backend.agents.models import STEP_DEPENDENCIES

    if result.action is None:
        return result

    tool = result.action.tool
    dep_list = STEP_DEPENDENCIES.get(tool, [])
    for dep in dep_list:
        if not any(o.tool == dep.value and o.success for o in deps.history):
            raise ModelRetry(
                f"{tool.value} requires {dep.value} to run first. "
                f"Call {dep.value} before {tool.value}."
            )

    return result


class TestRejectPrematureDone:
    """Tests for rejecting 'done' when required work isn't complete."""

    def test_anime_search_done_without_search(self) -> None:
        """Done after resolve_anime but no search_bangumi → reject."""
        deps = _deps(
            history=[_obs("resolve_anime")],
            intent=QueryIntent.ANIME_SEARCH,
        )
        with pytest.raises(ModelRetry, match="haven't searched"):
            _validate_done(deps, _done_step())

    def test_anime_search_done_with_search(self) -> None:
        """Done after resolve + search → accept."""
        deps = _deps(
            history=[_obs("resolve_anime"), _obs("search_bangumi")],
            intent=QueryIntent.ANIME_SEARCH,
        )
        result = _validate_done(deps, _done_step())
        assert result.done is not None

    def test_route_done_without_search(self) -> None:
        """Route intent, done without search → reject (missing search)."""
        deps = _deps(
            history=[_obs("resolve_anime")],
            intent=QueryIntent.ROUTE_PLAN,
        )
        with pytest.raises(ModelRetry, match="haven't searched"):
            _validate_done(deps, _done_step())

    def test_route_done_with_search_no_route(self) -> None:
        """Route intent, done after search but no plan_route → reject."""
        deps = _deps(
            history=[_obs("resolve_anime"), _obs("search_bangumi")],
            intent=QueryIntent.ROUTE_PLAN,
        )
        with pytest.raises(ModelRetry, match="asked for a route"):
            _validate_done(deps, _done_step())

    def test_route_done_complete(self) -> None:
        """Route intent, done after resolve + search + route → accept."""
        deps = _deps(
            history=[
                _obs("resolve_anime"),
                _obs("search_bangumi"),
                _obs("plan_route"),
            ],
            intent=QueryIntent.ROUTE_PLAN,
        )
        result = _validate_done(deps, _done_step())
        assert result.done is not None

    def test_nearby_done_without_search_bangumi(self) -> None:
        """Nearby intent can finish without search_bangumi → accept."""
        deps = _deps(
            history=[_obs("search_nearby")],
            intent=QueryIntent.NEARBY_SEARCH,
        )
        result = _validate_done(deps, _done_step())
        assert result.done is not None

    def test_greeting_done_immediately(self) -> None:
        """Greeting intent can finish with just greet_user → accept."""
        deps = _deps(
            history=[_obs("greet_user")],
            intent=QueryIntent.GREETING,
        )
        result = _validate_done(deps, _done_step())
        assert result.done is not None

    def test_search_nearby_does_not_satisfy_anime_search(self) -> None:
        """search_nearby should NOT satisfy ANIME_SEARCH completion."""
        deps = _deps(
            history=[_obs("resolve_anime"), _obs("search_nearby")],
            intent=QueryIntent.ANIME_SEARCH,
        )
        with pytest.raises(ModelRetry, match="haven't searched"):
            _validate_done(deps, _done_step())

    def test_failed_search_does_not_satisfy(self) -> None:
        """A failed search_bangumi should not count as completion."""
        deps = _deps(
            history=[_obs("resolve_anime"), _obs("search_bangumi", success=False)],
            intent=QueryIntent.ANIME_SEARCH,
        )
        with pytest.raises(ModelRetry, match="haven't searched"):
            _validate_done(deps, _done_step())

    def test_ambiguous_intent_done_always_ok(self) -> None:
        """Ambiguous intent has no required steps → done always accepted."""
        deps = _deps(history=[], intent=QueryIntent.AMBIGUOUS)
        result = _validate_done(deps, _done_step())
        assert result.done is not None


class TestRejectUnmetPrerequisites:
    """Tests for rejecting actions with unmet prerequisites."""

    def test_search_bangumi_without_resolve(self) -> None:
        """search_bangumi before resolve_anime → reject."""
        deps = _deps(history=[])
        step = _action_step(ToolName.SEARCH_BANGUMI, bangumi_id="123")
        with pytest.raises(ModelRetry, match="requires resolve_anime"):
            _validate_action(deps, step)

    def test_search_bangumi_after_resolve(self) -> None:
        """search_bangumi after resolve_anime → accept."""
        deps = _deps(history=[_obs("resolve_anime")])
        step = _action_step(ToolName.SEARCH_BANGUMI, bangumi_id="123")
        result = _validate_action(deps, step)
        assert result.action is not None

    def test_plan_route_without_search(self) -> None:
        """plan_route before search_bangumi → reject."""
        deps = _deps(history=[_obs("resolve_anime")])
        step = _action_step(ToolName.PLAN_ROUTE)
        with pytest.raises(ModelRetry, match="requires search_bangumi"):
            _validate_action(deps, step)

    def test_plan_route_after_search(self) -> None:
        """plan_route after search_bangumi → accept."""
        deps = _deps(history=[_obs("resolve_anime"), _obs("search_bangumi")])
        step = _action_step(ToolName.PLAN_ROUTE)
        result = _validate_action(deps, step)
        assert result.action is not None

    def test_resolve_anime_no_deps(self) -> None:
        """resolve_anime has no prerequisites → always accept."""
        deps = _deps(history=[])
        step = _action_step(ToolName.RESOLVE_ANIME, title="Your Name")
        result = _validate_action(deps, step)
        assert result.action is not None

    def test_search_nearby_no_deps(self) -> None:
        """search_nearby has no prerequisites → always accept."""
        deps = _deps(history=[])
        step = _action_step(ToolName.SEARCH_NEARBY, location="Uji")
        result = _validate_action(deps, step)
        assert result.action is not None

    def test_failed_resolve_does_not_satisfy_dep(self) -> None:
        """A failed resolve_anime should not satisfy search_bangumi's dep."""
        deps = _deps(history=[_obs("resolve_anime", success=False)])
        step = _action_step(ToolName.SEARCH_BANGUMI, bangumi_id="123")
        with pytest.raises(ModelRetry, match="requires resolve_anime"):
            _validate_action(deps, step)

    def test_greet_user_no_deps(self) -> None:
        """greet_user has no prerequisites → always accept."""
        deps = _deps(history=[])
        step = _action_step(ToolName.GREET_USER, message="Hello")
        result = _validate_action(deps, step)
        assert result.action is not None


class TestReActDeps:
    """Tests for the ReActDeps dataclass."""

    def test_deps_creation(self) -> None:
        deps = ReActDeps(
            history=[_obs("resolve_anime")],
            classified_intent=QueryIntent.ANIME_SEARCH,
            query="Your Name spots",
            locale="en",
        )
        assert len(deps.history) == 1
        assert deps.classified_intent == QueryIntent.ANIME_SEARCH
        assert deps.locale == "en"

    def test_deps_empty_history(self) -> None:
        deps = _deps(history=[], intent=QueryIntent.GREETING)
        assert deps.history == []
        assert deps.classified_intent == QueryIntent.GREETING
