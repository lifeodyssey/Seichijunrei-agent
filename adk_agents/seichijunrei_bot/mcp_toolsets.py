"""Helpers for connecting ADK agents to local/remote MCP servers.

Default behavior stays deployment-first (no MCP). When enabled via settings,
we connect to self-hosted MCP servers in `infrastructure/mcp_servers/*`.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from google.adk.agents.llm_agent import ToolUnion
from google.adk.tools.mcp_tool.mcp_session_manager import (
    SseConnectionParams,
    StdioConnectionParams,
    StreamableHTTPConnectionParams,
)
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from mcp import StdioServerParameters

from config import get_settings

from .tools import get_anitabi_points, search_bangumi_subjects


def _repo_root() -> str:
    # .../adk_agents/seichijunrei_bot/mcp_toolsets.py -> repo root
    return str(Path(__file__).resolve().parents[2])


def _stdio_params(*, module: str) -> StdioConnectionParams:
    server_params = StdioServerParameters(
        command=sys.executable,
        args=["-m", module],
        cwd=_repo_root(),
    )
    return StdioConnectionParams(server_params=server_params, timeout=10.0)


def _mcp_toolset_for_bangumi() -> McpToolset:
    settings = get_settings()
    transport = settings.mcp_transport

    if transport == "stdio":
        connection_params: Any = _stdio_params(
            module="infrastructure.mcp_servers.bangumi_server"
        )
    elif transport == "sse":
        if not settings.mcp_bangumi_url:
            raise ValueError("MCP_BANGUMI_URL is required when MCP_TRANSPORT=sse")
        connection_params = SseConnectionParams(url=settings.mcp_bangumi_url)
    elif transport == "streamable-http":
        if not settings.mcp_bangumi_url:
            raise ValueError(
                "MCP_BANGUMI_URL is required when MCP_TRANSPORT=streamable-http"
            )
        connection_params = StreamableHTTPConnectionParams(url=settings.mcp_bangumi_url)
    else:
        raise ValueError(f"Unsupported MCP transport: {transport}")

    return McpToolset(
        connection_params=connection_params,
        tool_filter=["search_bangumi_subjects"],
    )


def _mcp_toolset_for_anitabi() -> McpToolset:
    settings = get_settings()
    transport = settings.mcp_transport

    if transport == "stdio":
        connection_params: Any = _stdio_params(
            module="infrastructure.mcp_servers.anitabi_server"
        )
    elif transport == "sse":
        if not settings.mcp_anitabi_url:
            raise ValueError("MCP_ANITABI_URL is required when MCP_TRANSPORT=sse")
        connection_params = SseConnectionParams(url=settings.mcp_anitabi_url)
    elif transport == "streamable-http":
        if not settings.mcp_anitabi_url:
            raise ValueError(
                "MCP_ANITABI_URL is required when MCP_TRANSPORT=streamable-http"
            )
        connection_params = StreamableHTTPConnectionParams(url=settings.mcp_anitabi_url)
    else:
        raise ValueError(f"Unsupported MCP transport: {transport}")

    return McpToolset(
        connection_params=connection_params,
        tool_filter=["get_anitabi_points"],
    )


def bangumi_search_tool() -> ToolUnion:
    """Tool for Bangumi search used by Stage 1.

    Returns either:
    - a Python callable tool (default), or
    - an McpToolset connected to the Bangumi MCP server.
    """

    if not get_settings().enable_mcp_tools:
        return search_bangumi_subjects
    return _mcp_toolset_for_bangumi()


def anitabi_points_tool() -> ToolUnion:
    """Tool for fetching Anitabi points (optional MCP-backed tool)."""

    if not get_settings().enable_mcp_tools:
        return get_anitabi_points
    return _mcp_toolset_for_anitabi()
