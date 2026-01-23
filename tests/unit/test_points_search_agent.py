import pytest
from google.adk.agents.invocation_context import InvocationContext
from google.adk.sessions import InMemorySessionService
from google.adk.sessions.session import Session
from google.genai import types

from adk_agents.seichijunrei_bot._agents.points_search_agent import PointsSearchAgent
from adk_agents.seichijunrei_bot._state import ALL_POINTS, SELECTED_BANGUMI
from domain.entities import Coordinates, Point


@pytest.mark.asyncio
async def test_points_search_agent_flattens_points_into_all_points():
    async def _fake_fetch_points(bangumi_id: str):
        return [
            Point(
                id="p1",
                name="JP",
                cn_name="CN",
                coordinates=Coordinates(latitude=1.0, longitude=2.0),
                bangumi_id=bangumi_id,
                bangumi_title="T",
                episode=1,
                time_seconds=2,
                screenshot_url="https://example.com/x.png",
                address="addr",
            )
        ]

    agent = PointsSearchAgent(fetch_bangumi_points=_fake_fetch_points)  # type: ignore[arg-type]

    session_service = InMemorySessionService()
    session = Session(
        id="s1",
        app_name="app",
        user_id="u1",
        state={SELECTED_BANGUMI: {"bangumi_id": 1}},
    )
    ctx = InvocationContext(
        session_service=session_service,
        invocation_id="inv-1",
        agent=agent,
        user_content=types.Content(role="user", parts=[types.Part(text="1")]),
        session=session,
    )

    _events = [e async for e in agent.run_async(ctx)]

    assert ALL_POINTS in ctx.session.state
    all_points = ctx.session.state[ALL_POINTS]
    assert isinstance(all_points, list)
    assert all_points[0]["id"] == "p1"
    assert all_points[0]["lat"] == 1.0
    assert all_points[0]["lng"] == 2.0
    assert all_points[0]["screenshot_url"] == "https://example.com/x.png"
