import pytest
from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.adk.sessions import InMemorySessionService
from google.adk.sessions.session import Session
from google.genai import types
from pydantic import ConfigDict, PrivateAttr

from adk_agents.seichijunrei_bot._agents.route_state_machine_agent import (
    RouteStateMachineAgent,
    _extract_user_text,
)


class _DummyWorkflow(BaseAgent):
    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)
    _text: str = PrivateAttr()

    def __init__(self, *, name: str, text: str):
        super().__init__(name=name)
        self._text = text

    async def _run_async_impl(self, ctx):  # type: ignore[override]
        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=types.Content(role="model", parts=[types.Part(text=self._text)]),
            actions=EventActions(),
        )


def _make_ctx(agent: BaseAgent, *, user_text: str, state: dict):
    session_service = InMemorySessionService()
    session = Session(id="s1", app_name="app", user_id="u1", state=state)
    return InvocationContext(
        session_service=session_service,
        invocation_id="inv-1",
        agent=agent,
        user_content=types.Content(role="user", parts=[types.Part(text=user_text)]),
        session=session,
    )


@pytest.mark.asyncio
async def test_extract_user_text_from_content_parts():
    content = types.Content(
        role="user",
        parts=[types.Part(text="hello"), types.Part(text="world")],
    )
    assert _extract_user_text(content) == "hello\nworld"


@pytest.mark.asyncio
async def test_routes_to_stage1_when_no_candidates():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    ctx = _make_ctx(router, user_text="我想去镰仓圣地巡礼", state={})

    events = [e async for e in router.run_async(ctx)]
    assert any(getattr(e.content.parts[0], "text", "") == "STAGE1" for e in events)


@pytest.mark.asyncio
async def test_routes_to_stage2_when_candidates_and_selection():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    ctx = _make_ctx(
        router,
        user_text="1",
        state={"bangumi_candidates": {"candidates": [{"bangumi_id": 1, "title": "A"}]}},
    )

    events = [e async for e in router.run_async(ctx)]
    assert any(getattr(e.content.parts[0], "text", "") == "STAGE2" for e in events)


@pytest.mark.asyncio
async def test_routes_to_stage2_when_candidates_and_selection_phrase_with_digit():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    ctx = _make_ctx(
        router,
        user_text="我选 1",
        state={"bangumi_candidates": {"candidates": [{"bangumi_id": 1, "title": "A"}]}},
    )

    events = [e async for e in router.run_async(ctx)]
    assert any(getattr(e.content.parts[0], "text", "") == "STAGE2" for e in events)


@pytest.mark.asyncio
async def test_routes_to_stage2_when_candidates_and_year_based_description():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    ctx = _make_ctx(
        router,
        user_text="2015 年那部",
        state={
            "bangumi_candidates": {
                "candidates": [
                    {"bangumi_id": 1, "title": "A", "air_date": "2015-04"},
                    {"bangumi_id": 2, "title": "B", "air_date": "2010-01"},
                ]
            }
        },
    )

    events = [e async for e in router.run_async(ctx)]
    assert any(getattr(e.content.parts[0], "text", "") == "STAGE2" for e in events)


@pytest.mark.asyncio
async def test_routes_to_stage2_when_candidates_and_title_selection():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    ctx = _make_ctx(
        router,
        user_text="孤独摇滚",
        state={
            "bangumi_candidates": {
                "candidates": [
                    {"bangumi_id": 1, "title": "孤独摇滚！"},
                    {"bangumi_id": 2, "title": "K-ON!"},
                ]
            }
        },
    )

    events = [e async for e in router.run_async(ctx)]
    assert any(getattr(e.content.parts[0], "text", "") == "STAGE2" for e in events)


@pytest.mark.asyncio
async def test_new_query_while_candidates_restarts_stage1_and_clears_state():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    initial_state = {
        "bangumi_candidates": {"candidates": [{"bangumi_id": 1, "title": "A"}]},
        "selected_bangumi": {"bangumi_id": 1},
        "route_plan": {"recommended_order": []},
    }
    ctx = _make_ctx(router, user_text="换个作品：孤独摇滚", state=initial_state)

    events = [e async for e in router.run_async(ctx)]
    assert any(getattr(e.content.parts[0], "text", "") == "STAGE1" for e in events)
    assert "bangumi_candidates" not in ctx.session.state
    assert "selected_bangumi" not in ctx.session.state
    assert "route_plan" not in ctx.session.state


@pytest.mark.asyncio
async def test_reset_command_clears_state_and_prompts():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    initial_state = {
        "extraction_result": {"user_language": "zh-CN"},
        "bangumi_candidates": {"candidates": [{"bangumi_id": 1, "title": "A"}]},
        "selected_bangumi": {"bangumi_id": 1},
        "route_plan": {"recommended_order": []},
    }
    ctx = _make_ctx(router, user_text="reset", state=initial_state)

    events = [e async for e in router.run_async(ctx)]
    # Should respond directly (not run workflows)
    assert any("已重置" in getattr(e.content.parts[0], "text", "") for e in events)
    assert ctx.session.state == {}


@pytest.mark.asyncio
async def test_back_command_keeps_candidates_but_clears_stage2_outputs():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    initial_state = {
        "extraction_result": {"user_language": "en"},
        "bangumi_candidates": {
            "query": "test",
            "candidates": [
                {
                    "bangumi_id": 1,
                    "title": "JP",
                    "title_cn": "CN",
                    "air_date": "2015-04",
                }
            ],
        },
        "selected_bangumi": {"bangumi_id": 1},
        "route_plan": {"recommended_order": []},
    }
    ctx = _make_ctx(router, user_text="back", state=initial_state)

    events = [e async for e in router.run_async(ctx)]
    assert any(
        "Please choose" in getattr(e.content.parts[0], "text", "") for e in events
    )

    assert "bangumi_candidates" in ctx.session.state
    assert "selected_bangumi" not in ctx.session.state
    assert "route_plan" not in ctx.session.state


@pytest.mark.asyncio
async def test_mcp_probe_command_routes_to_probe_agent():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    probe = _DummyWorkflow(name="McpProbeAgent", text="PROBE")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2, probe],
    )

    ctx = _make_ctx(router, user_text="/mcp_probe", state={})

    events = [e async for e in router.run_async(ctx)]
    assert any(getattr(e.content.parts[0], "text", "") == "PROBE" for e in events)


@pytest.mark.asyncio
async def test_help_command_responds_without_running_workflows():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    ctx = _make_ctx(router, user_text="/help", state={})

    events = [e async for e in router.run_async(ctx)]
    text = "\n".join(
        getattr(e.content.parts[0], "text", "") for e in events if e.content
    )
    assert "使用方法" in text
    assert "STAGE1" not in text
    assert "STAGE2" not in text


@pytest.mark.asyncio
async def test_status_command_reports_stage_and_state_keys():
    stage1 = _DummyWorkflow(name="BangumiSearchWorkflow", text="STAGE1")
    stage2 = _DummyWorkflow(name="RoutePlanningWorkflow", text="STAGE2")
    router = RouteStateMachineAgent(
        name="seichijunrei_bot",
        sub_agents=[stage1, stage2],
    )

    ctx = _make_ctx(router, user_text="/status", state={})
    events = [e async for e in router.run_async(ctx)]
    text = "\n".join(
        getattr(e.content.parts[0], "text", "") for e in events if e.content
    )
    assert "当前状态: stage1" in text

    ctx2 = _make_ctx(
        router,
        user_text="/status",
        state={"bangumi_candidates": {"candidates": [{"bangumi_id": 1, "title": "A"}]}},
    )
    events2 = [e async for e in router.run_async(ctx2)]
    text2 = "\n".join(
        getattr(e.content.parts[0], "text", "") for e in events2 if e.content
    )
    assert "当前状态: stage2" in text2
