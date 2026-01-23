"""Minimal MCP server for testing stdio subprocess viability.

This server intentionally exposes a tiny surface area so we can verify:
1) ADK can spawn a local MCP server process (stdio)
2) ADK can list tools and call a tool end-to-end

Run manually:
  python -m infrastructure.mcp_servers.ping_server
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

_mcp = FastMCP(name="seichijunrei-mcp-ping")


@_mcp.tool()
async def ping(message: str = "ping") -> dict[str, str]:
    """Health check tool."""

    return {"ok": "true", "message": message, "reply": "pong"}


def main() -> None:
    _mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
