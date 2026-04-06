from backend.agents.models import (
    DoneSignal,
    ExecutionPlan,
    Observation,
    PlanStep,
    ReactStep,
    RetrievalRequest,
    ToolName,
)


class TestToolName:
    def test_values(self):
        assert ToolName.RESOLVE_ANIME == "resolve_anime"
        assert ToolName.SEARCH_BANGUMI == "search_bangumi"
        assert ToolName.SEARCH_NEARBY == "search_nearby"
        assert ToolName.PLAN_ROUTE == "plan_route"
        assert ToolName.PLAN_SELECTED == "plan_selected"
        assert ToolName.ANSWER_QUESTION == "answer_question"
        assert ToolName.GREET_USER == "greet_user"


class TestPlanStep:
    def test_defaults(self):
        step = PlanStep(tool=ToolName.SEARCH_BANGUMI)
        assert step.params == {}
        assert step.parallel is False

    def test_with_params(self):
        step = PlanStep(
            tool=ToolName.SEARCH_BANGUMI,
            params={"bangumi_id": "115908", "episode": 3},
        )
        assert step.params["bangumi_id"] == "115908"
        assert step.params["episode"] == 3


class TestExecutionPlan:
    def test_defaults(self):
        plan = ExecutionPlan(
            steps=[
                PlanStep(tool=ToolName.SEARCH_BANGUMI, params={"bangumi_id": "115908"})
            ],
            reasoning="user asked about a specific anime",
        )
        assert plan.locale == "ja"
        assert len(plan.steps) == 1

    def test_locale_override(self):
        plan = ExecutionPlan(
            steps=[],
            reasoning="empty",
            locale="en",
        )
        assert plan.locale == "en"


class TestReactStep:
    def test_react_step_plan_step(self):
        """ReactStep can hold a PlanStep."""
        step = ReactStep(
            thought="User wants Hibike spots, need to resolve anime first",
            action=PlanStep(tool=ToolName.RESOLVE_ANIME, params={"title": "響け"}),
        )
        assert step.thought.startswith("User wants")
        assert step.action.tool == ToolName.RESOLVE_ANIME
        assert step.done is None

    def test_react_step_done(self):
        """ReactStep can signal done."""
        step = ReactStep(
            thought="Found 12 spots and planned route",
            done=DoneSignal(message="Created a route with 12 stops."),
        )
        assert step.done is not None
        assert step.action is None

    def test_observation_from_step_result(self):
        """Observation formats a step result summary."""
        obs = Observation(
            tool="resolve_anime",
            success=True,
            summary="Resolved to bangumi_id=115908 (響け！ユーフォニアム)",
        )
        assert obs.tool == "resolve_anime"
        assert "115908" in obs.summary


class TestRetrievalRequest:
    def test_bangumi_request(self):
        req = RetrievalRequest(tool="search_bangumi", bangumi_id="115908", episode=2)
        assert req.bangumi_id == "115908"
        assert req.episode == 2
        assert req.location is None

    def test_nearby_request(self):
        req = RetrievalRequest(tool="search_nearby", location="宇治", radius=3000)
        assert req.location == "宇治"
        assert req.radius == 3000
        assert req.bangumi_id is None
