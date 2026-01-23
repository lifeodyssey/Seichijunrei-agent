"""ADK BaseAgent that probes MCP stdio subprocess viability.

This agent:
- spawns a minimal local MCP server (stdio) as a subprocess
- lists tools via ADK's McpToolset
- calls the `ping` tool end-to-end

It is intended as a diagnostic tool for Agent Engine deployments.
"""

from __future__ import annotations

import sys
from collections.abc import AsyncGenerator

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from google.adk.tools.mcp_tool.mcp_session_manager import StdioConnectionParams
from google.adk.tools.mcp_tool.mcp_toolset import McpToolset
from google.adk.tools.tool_context import ToolContext
from google.genai import types
from mcp import StdioServerParameters
from pydantic import ConfigDict

from utils.logger import get_logger

logger = get_logger(__name__)


def _text_response(text: str) -> types.Content:
    return types.Content(role="model", parts=[types.Part(text=text)])


class McpProbeAgent(BaseAgent):
    model_config = ConfigDict(extra="allow", arbitrary_types_allowed=True)

    def __init__(self) -> None:
        super().__init__(name="McpProbeAgent")

    async def _run_async_impl(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        server_params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "infrastructure.mcp_servers.ping_server"],
        )
        toolset = McpToolset(
            connection_params=StdioConnectionParams(
                server_params=server_params,
                timeout=10.0,
            ),
            tool_filter=["ping"],
        )

        # NOTE: Close the MCP session BEFORE yielding any events.
        # In async generators, `finally` cleanup may run in a different task
        # depending on how the runner consumes/closes the generator, which can
        # break AnyIO cancel-scope invariants inside the MCP client stack.
        try:
            tools = await toolset.get_tools()
            tool_names = [t.name for t in tools]
            ping_tool = next((t for t in tools if t.name.endswith("ping")), None)

            if ping_tool is None:
                raise RuntimeError(
                    f"MCP probe tool 'ping' not found. Tools: {tool_names}"
                )

            result = await ping_tool.run_async(
                args={"message": "ping"},
                tool_context=ToolContext(ctx),
            )
            text = (
                "MCP stdio probe OK.\n"
                f"- server: infrastructure.mcp_servers.ping_server\n"
                f"- tools: {tool_names}\n"
                f"- ping result: {result}\n"
            )
        except Exception as exc:
            logger.error("MCP stdio probe failed", error=str(exc), exc_info=True)
            text = "MCP stdio probe FAILED.\n" f"- error: {exc}\n"
        finally:
            try:
                await toolset.close()
            except Exception as exc:
                logger.warning("Failed to close MCP probe toolset", error=str(exc))

        yield Event(
            invocation_id=ctx.invocation_id,
            author=self.name,
            content=_text_response(text),
            actions=EventActions(),
        )


mcp_probe_agent = McpProbeAgent()
