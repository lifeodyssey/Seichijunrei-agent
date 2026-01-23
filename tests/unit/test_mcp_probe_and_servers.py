import pytest
from google.adk.agents.invocation_context import InvocationContext
from google.adk.sessions import InMemorySessionService
from google.adk.sessions.session import Session
from google.genai import types

from adk_agents.seichijunrei_bot._agents.mcp_probe_agent import McpProbeAgent
from domain.entities import Bangumi, Coordinates, Point, Station
from infrastructure.mcp_servers import anitabi_server, bangumi_server, ping_server


@pytest.mark.asyncio
async def test_ping_server_tool_returns_pong():
    assert await ping_server.ping() == {
        "ok": "true",
        "message": "ping",
        "reply": "pong",
    }
    assert (await ping_server.ping("hello"))["reply"] == "pong"


@pytest.mark.asyncio
async def test_bangumi_server_tools_success(mocker):
    class DummySearch:
        def __init__(self, *, bangumi):
            self._bangumi = bangumi

        async def __call__(self, *, keyword: str, subject_type: int, max_results: int):
            return [{"id": 1, "name": "X"}]

    class DummyGet:
        def __init__(self, *, bangumi):
            self._bangumi = bangumi

        async def __call__(self, subject_id: int):
            return {"id": subject_id, "name": "Y"}

    mocker.patch.object(bangumi_server, "SearchBangumiSubjects", DummySearch)
    mocker.patch.object(bangumi_server, "GetBangumiSubject", DummyGet)

    out = await bangumi_server.search_bangumi_subjects("test")
    assert out["success"] is True
    assert out["results"][0]["id"] == 1

    out2 = await bangumi_server.get_bangumi_subject(123)
    assert out2["success"] is True
    assert out2["subject"]["id"] == 123


@pytest.mark.asyncio
async def test_bangumi_server_tools_error(mocker):
    class DummySearch:
        def __init__(self, *, bangumi):
            self._bangumi = bangumi

        async def __call__(self, *, keyword: str, subject_type: int, max_results: int):
            raise RuntimeError("boom")

    mocker.patch.object(bangumi_server, "SearchBangumiSubjects", DummySearch)

    out = await bangumi_server.search_bangumi_subjects("test")
    assert out["success"] is False
    assert out["results"] == []
    assert "boom" in (out["error"] or "")


@pytest.mark.asyncio
async def test_anitabi_server_tools_success(mocker):
    class DummyFetchPoints:
        def __init__(self, *, anitabi):
            self._anitabi = anitabi

        async def __call__(self, bangumi_id: str):
            return [
                Point(
                    id="p1",
                    name="A",
                    cn_name="A",
                    coordinates=Coordinates(latitude=1.0, longitude=2.0),
                    bangumi_id=bangumi_id,
                    bangumi_title="T",
                    episode=1,
                    time_seconds=2,
                    screenshot_url="https://example.com/x.png",
                )
            ]

    class DummyNearStation:
        def __init__(self, *, anitabi):
            self._anitabi = anitabi

        async def __call__(self, *, station_name: str, radius_km: float):
            return (
                Station(
                    name=station_name,
                    coordinates=Coordinates(latitude=35.0, longitude=139.0),
                    city=None,
                    prefecture=None,
                ),
                [
                    Bangumi(
                        id="b1",
                        title="JP",
                        cn_title="CN",
                        cover_url="https://example.com/cover.png",
                        points_count=1,
                        distance_km=1.2,
                    )
                ],
            )

    mocker.patch.object(anitabi_server, "FetchBangumiPoints", DummyFetchPoints)
    mocker.patch.object(
        anitabi_server, "SearchAnitabiBangumiNearStation", DummyNearStation
    )

    out = await anitabi_server.get_anitabi_points("1")
    assert out["success"] is True
    assert out["points"][0]["id"] == "p1"

    out2 = await anitabi_server.search_anitabi_bangumi_near_station("Tokyo", 5.0)
    assert out2["success"] is True
    assert out2["station"]["name"] == "Tokyo"
    assert out2["bangumi_list"][0]["id"] == "b1"


@pytest.mark.asyncio
async def test_anitabi_server_tools_error(mocker):
    class DummyFetchPoints:
        def __init__(self, *, anitabi):
            self._anitabi = anitabi

        async def __call__(self, bangumi_id: str):
            raise RuntimeError("boom")

    mocker.patch.object(anitabi_server, "FetchBangumiPoints", DummyFetchPoints)

    out = await anitabi_server.get_anitabi_points("1")
    assert out["success"] is False
    assert out["points"] == []
    assert "boom" in (out["error"] or "")


@pytest.mark.asyncio
async def test_mcp_probe_agent_success(mocker):
    class DummyTool:
        name = "ping"

        async def run_async(self, *, args, tool_context):
            return {"ok": "true", "reply": "pong"}

    class DummyToolset:
        def __init__(self, *args, **kwargs):
            pass

        async def get_tools(self, readonly_context=None):
            return [DummyTool()]

        async def close(self):
            return None

    mocker.patch(
        "adk_agents.seichijunrei_bot._agents.mcp_probe_agent.McpToolset",
        DummyToolset,
    )

    agent = McpProbeAgent()
    session_service = InMemorySessionService()
    session = Session(id="s1", app_name="app", user_id="u1", state={})
    ctx = InvocationContext(
        session_service=session_service,
        invocation_id="inv-1",
        agent=agent,
        user_content=types.Content(role="user", parts=[types.Part(text="/mcp_probe")]),
        session=session,
    )

    events = [e async for e in agent.run_async(ctx)]
    assert any(
        "MCP stdio probe OK" in getattr(e.content.parts[0], "text", "") for e in events
    )


@pytest.mark.asyncio
async def test_mcp_probe_agent_error(mocker):
    class DummyToolset:
        def __init__(self, *args, **kwargs):
            pass

        async def get_tools(self, readonly_context=None):
            raise RuntimeError("boom")

        async def close(self):
            return None

    mocker.patch(
        "adk_agents.seichijunrei_bot._agents.mcp_probe_agent.McpToolset",
        DummyToolset,
    )

    agent = McpProbeAgent()
    session_service = InMemorySessionService()
    session = Session(id="s1", app_name="app", user_id="u1", state={})
    ctx = InvocationContext(
        session_service=session_service,
        invocation_id="inv-1",
        agent=agent,
        user_content=types.Content(role="user", parts=[types.Part(text="/mcp_probe")]),
        session=session,
    )

    events = [e async for e in agent.run_async(ctx)]
    assert any(
        "MCP stdio probe FAILED" in getattr(e.content.parts[0], "text", "")
        for e in events
    )
