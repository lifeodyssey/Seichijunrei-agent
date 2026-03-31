from agents.models import ExecutionPlan, PlanStep, RetrievalRequest, ToolName


class TestToolName:
    def test_values(self):
        assert ToolName.RESOLVE_ANIME == "resolve_anime"
        assert ToolName.SEARCH_BANGUMI == "search_bangumi"
        assert ToolName.SEARCH_NEARBY == "search_nearby"
        assert ToolName.PLAN_ROUTE == "plan_route"
        assert ToolName.ANSWER_QUESTION == "answer_question"


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
