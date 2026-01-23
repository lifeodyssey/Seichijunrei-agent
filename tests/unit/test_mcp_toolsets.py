import pytest
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset

from config.settings import get_settings


@pytest.mark.asyncio
async def test_bangumi_search_tool_defaults_to_python_callable(monkeypatch):
    monkeypatch.delenv("ENABLE_MCP_TOOLS", raising=False)
    get_settings.cache_clear()

    from adk_agents.seichijunrei_bot.mcp_toolsets import bangumi_search_tool

    tool = bangumi_search_tool()
    assert callable(tool)


@pytest.mark.asyncio
async def test_bangumi_search_tool_can_build_stdio_mcp_toolset(monkeypatch):
    monkeypatch.setenv("ENABLE_MCP_TOOLS", "true")
    monkeypatch.setenv("MCP_TRANSPORT", "stdio")
    get_settings.cache_clear()

    from adk_agents.seichijunrei_bot.mcp_toolsets import bangumi_search_tool

    tool = bangumi_search_tool()
    assert isinstance(tool, McpToolset)


@pytest.mark.asyncio
async def test_anitabi_points_tool_can_build_stdio_mcp_toolset(monkeypatch):
    monkeypatch.setenv("ENABLE_MCP_TOOLS", "true")
    monkeypatch.setenv("MCP_TRANSPORT", "stdio")
    get_settings.cache_clear()

    from adk_agents.seichijunrei_bot.mcp_toolsets import anitabi_points_tool

    tool = anitabi_points_tool()
    assert isinstance(tool, McpToolset)


def test_settings_normalizes_mcp_transport_variants(monkeypatch):
    monkeypatch.setenv("MCP_TRANSPORT", "streamable_http")
    get_settings.cache_clear()
    assert get_settings().mcp_transport == "streamable-http"
