from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from pydantic_ai import ModelRetry

from backend.agents.models import ExecutionPlan, PlanStep, ReactStep, ToolName
from backend.agents.planner_agent import (
    PLANNER_SYSTEM_PROMPT,
    ReActDeps,
    ReActPlannerAgent,
)


@pytest.fixture
def mock_plan_bangumi() -> ExecutionPlan:
    from backend.agents.models import PlanStep

    return ExecutionPlan(
        steps=[PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})],
        reasoning="user asked about a specific anime",
        locale="ja",
    )


class TestReActPlannerAgent:
    def test_planner_system_prompt_includes_greet_user_rules(self) -> None:
        assert "greet_user(message: str)" in PLANNER_SYSTEM_PROMPT
        assert "Use greet_user(message: str) for greetings" in PLANNER_SYSTEM_PROMPT
        assert (
            "Use greet_user(message: str) for identity questions"
            in PLANNER_SYSTEM_PROMPT
        )

    def test_planner_system_prompt_prioritizes_real_tasks_over_greetings(self) -> None:
        assert "Do not use it for real pilgrimage queries" in PLANNER_SYSTEM_PROMPT
        assert "hello, plan a route for Your Name in Tokyo" in PLANNER_SYSTEM_PROMPT

    def test_format_context_block_full(self) -> None:
        from backend.agents.planner_agent import _format_context_block

        block = {
            "current_bangumi_id": "253",
            "current_anime_title": "響け！ユーフォニアム",
            "last_location": "宇治",
            "last_intent": "search_bangumi",
            "visited_bangumi_ids": ["253"],
        }

        result = _format_context_block(block)
        assert "[context]" in result
        assert "anime: 響け！ユーフォニアム (bangumi_id: 253)" in result
        assert "last_location: 宇治" in result
        assert "last_intent: search_bangumi" in result
        assert "visited_ids: 253" in result

    def test_format_context_block_minimal(self) -> None:
        from backend.agents.planner_agent import _format_context_block

        block = {
            "current_bangumi_id": None,
            "current_anime_title": None,
            "last_location": "京都",
            "last_intent": None,
            "visited_bangumi_ids": [],
        }

        result = _format_context_block(block)
        assert "last_location: 京都" in result
        assert "anime:" not in result

    def test_format_context_block_renders_summary_first(self) -> None:
        from backend.agents.planner_agent import _format_context_block

        block = {
            "summary": "previous summary",
            "current_bangumi_id": "253",
            "current_anime_title": "響け！ユーフォニアム",
            "last_location": "宇治",
            "last_intent": "search_bangumi",
            "visited_bangumi_ids": ["253"],
        }

        result = _format_context_block(block)
        lines = result.splitlines()
        assert lines[1] == "summary: previous summary"

    async def test_create_plan_returns_execution_plan(self, mock_plan_bangumi):
        with (
            patch("backend.agents.planner_agent.create_agent") as mock_create,
            patch("backend.agents.planner_agent.Agent") as mock_agent_cls,
        ):
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent
            mock_step = MagicMock()
            mock_step.output_validator = MagicMock(side_effect=lambda f: f)
            mock_agent_cls.return_value = mock_step

            planner = ReActPlannerAgent()
            plan = await planner.create_plan("吹響の聖地在哪", locale="ja")

        assert isinstance(plan, ExecutionPlan)
        assert plan.locale == "ja"
        assert len(plan.steps) >= 1

    async def test_create_plan_passes_locale_in_prompt(self, mock_plan_bangumi):
        with (
            patch("backend.agents.planner_agent.create_agent") as mock_create,
            patch("backend.agents.planner_agent.Agent") as mock_agent_cls,
        ):
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent
            mock_step = MagicMock()
            mock_step.output_validator = MagicMock(side_effect=lambda f: f)
            mock_agent_cls.return_value = mock_step

            planner = ReActPlannerAgent()
            await planner.create_plan(
                "where is kyoani",
                locale="en",
                context={
                    "current_bangumi_id": "253",
                    "current_anime_title": "響け！ユーフォニアム",
                    "last_location": "宇治",
                    "last_intent": "search_bangumi",
                    "visited_bangumi_ids": ["253"],
                },
            )

            call_args = mock_agent.run.call_args[0][0]
            assert "en" in call_args
            assert "[context]" in call_args
            assert "anime: 響け！ユーフォニアム (bangumi_id: 253)" in call_args
            assert "visited_ids: 253" in call_args

    async def test_create_plan_supports_greet_user_step(self):
        from backend.agents.models import PlanStep

        greet_plan = ExecutionPlan(
            steps=[
                PlanStep(
                    tool=ToolName.GREET_USER,
                    params={"message": "我是圣地巡礼，可以帮你找动漫取景地。"},
                )
            ],
            reasoning="pure greeting",
            locale="zh",
        )

        with (
            patch("backend.agents.planner_agent.create_agent") as mock_create,
            patch("backend.agents.planner_agent.Agent") as mock_agent_cls,
        ):
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=greet_plan)
            mock_create.return_value = mock_agent
            mock_step = MagicMock()
            mock_step.output_validator = MagicMock(side_effect=lambda f: f)
            mock_agent_cls.return_value = mock_step

            planner = ReActPlannerAgent()
            plan = await planner.create_plan("你好", locale="zh")

        assert plan.steps == greet_plan.steps
        assert plan.steps[0].tool == ToolName.GREET_USER

    async def test_create_plan_prefixes_context_block(self, mock_plan_bangumi):
        with (
            patch("backend.agents.planner_agent.create_agent") as mock_create,
            patch("backend.agents.planner_agent.Agent") as mock_agent_cls,
        ):
            mock_agent = AsyncMock()
            mock_agent.run.return_value = AsyncMock(output=mock_plan_bangumi)
            mock_create.return_value = mock_agent
            mock_step = MagicMock()
            mock_step.output_validator = MagicMock(side_effect=lambda f: f)
            mock_agent_cls.return_value = mock_step

            planner = ReActPlannerAgent()
            await planner.create_plan(
                "where is kyoani",
                locale="en",
                context={
                    "current_bangumi_id": "253",
                    "current_anime_title": "響け！ユーフォニアム",
                    "last_location": "宇治",
                    "last_intent": "search_bangumi",
                    "visited_bangumi_ids": ["253", "105"],
                },
            )

            call_args = mock_agent.run.call_args[0][0]
            assert "[context]" in call_args
            assert "anime: 響け！ユーフォニアム (bangumi_id: 253)" in call_args
            assert "visited_ids: 253, 105" in call_args


class TestReActOutputValidatorSessionDeps:
    """Tests for validator's session-satisfied dependency logic.

    The output_validator should accept plan_route when search_bangumi was
    satisfied in a prior interaction (stored in session context), not just
    in the current-turn history.
    """

    def _make_run_context(
        self,
        deps: ReActDeps,
    ) -> MagicMock:
        """Return a minimal RunContext-like mock for the validator."""
        from pydantic_ai import RunContext

        ctx = MagicMock(spec=RunContext)
        ctx.deps = deps
        return ctx

    async def test_validator_accepts_plan_route_when_search_bangumi_in_session(
        self,
    ) -> None:
        """AC: Validator accepts plan_route when search_bangumi exists in
        session context (not current plan).  -> unit
        """
        # Session context has last_search_data with a search_bangumi entry,
        # simulating a prior successful search in a previous interaction.
        session_context: dict[str, object] = {
            "last_search_data": {
                "search_bangumi": {
                    "rows": [{"bangumi_id": "115908", "title": "Your Name"}],
                    "row_count": 1,
                }
            }
        }
        # Current-turn history is empty — search_bangumi not run THIS turn.
        deps = ReActDeps(
            history=[],
            session_context=session_context,
        )
        ctx = self._make_run_context(deps)

        plan_route_step = ReactStep(
            thought="User wants a route; prior search exists in session.",
            action=PlanStep(
                tool=ToolName.PLAN_ROUTE,
                params={"origin": None},
            ),
        )

        # Build a real agent instance to get the registered validator function.
        with (
            patch("backend.agents.planner_agent.create_agent") as mock_create,
            patch("backend.agents.planner_agent.Agent") as mock_agent_cls,
        ):
            captured_validator: list[object] = []

            def capture_decorator(fn: object) -> object:
                captured_validator.append(fn)
                return fn

            mock_step_agent = MagicMock()
            mock_step_agent.output_validator = MagicMock(side_effect=capture_decorator)
            mock_create.return_value = MagicMock()
            mock_agent_cls.return_value = mock_step_agent

            ReActPlannerAgent()

        assert captured_validator, "output_validator decorator was not called"
        validator_fn = captured_validator[0]

        # Should NOT raise ModelRetry — dependency satisfied via session.
        result = await validator_fn(ctx, plan_route_step)  # type: ignore[operator]
        assert result is plan_route_step

    async def test_validator_rejects_plan_route_when_no_search_bangumi_anywhere(
        self,
    ) -> None:
        """AC: Validator still rejects plan_route when search_bangumi is
        neither in current plan nor session.  -> unit
        """
        # No session context and no current-turn history with search_bangumi.
        deps = ReActDeps(
            history=[],
            session_context=None,
        )
        ctx = self._make_run_context(deps)

        plan_route_step = ReactStep(
            thought="User wants route but no prior search anywhere.",
            action=PlanStep(
                tool=ToolName.PLAN_ROUTE,
                params={"origin": None},
            ),
        )

        with (
            patch("backend.agents.planner_agent.create_agent") as mock_create,
            patch("backend.agents.planner_agent.Agent") as mock_agent_cls,
        ):
            captured_validator: list[object] = []

            def capture_decorator(fn: object) -> object:
                captured_validator.append(fn)
                return fn

            mock_step_agent = MagicMock()
            mock_step_agent.output_validator = MagicMock(side_effect=capture_decorator)
            mock_create.return_value = MagicMock()
            mock_agent_cls.return_value = mock_step_agent

            ReActPlannerAgent()

        assert captured_validator
        validator_fn = captured_validator[0]

        with pytest.raises(ModelRetry):
            await validator_fn(ctx, plan_route_step)  # type: ignore[operator]

    async def test_session_context_is_passed_to_planner_deps(self) -> None:
        """AC: Session context with prior search_bangumi data is passed to
        planner (via ReActDeps.session_context).  -> unit
        """
        from backend.agents.models import DoneSignal
        from backend.agents.pipeline import react_loop

        session_context: dict[str, object] = {
            "last_search_data": {
                "search_bangumi": {
                    "rows": [{"bangumi_id": "253", "title": "Hibike"}],
                    "row_count": 1,
                }
            }
        }

        done_step = ReactStep(
            thought="done",
            done=DoneSignal(message="Here is your route."),
        )

        mock_planner = AsyncMock()
        mock_planner.step = AsyncMock(return_value=done_step)
        mock_executor = MagicMock()
        mock_executor._execute_step = AsyncMock()

        events = []
        async for event in react_loop(
            text="plan a route",
            planner=mock_planner,
            executor=mock_executor,
            locale="ja",
            context=session_context,
        ):
            events.append(event)

        assert mock_planner.step.called
        call_kwargs = mock_planner.step.call_args.kwargs
        # Pipeline must pass context through to the planner.step() call.
        assert call_kwargs.get("context") is session_context
