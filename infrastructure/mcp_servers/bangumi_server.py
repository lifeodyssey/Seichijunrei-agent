"""Bangumi MCP server (Python).

This server wraps our existing Bangumi client + application use cases into MCP
tools with stable JSON outputs.

Run:
  MCP_TRANSPORT=stdio python -m infrastructure.mcp_servers.bangumi_server
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

from application.use_cases import GetBangumiSubject, SearchBangumiSubjects
from infrastructure.gateways.bangumi import BangumiClientGateway
from utils.logger import get_logger

logger = get_logger(__name__)

_mcp = FastMCP(
    name="seichijunrei-bangumi",
    instructions=(
        "Tools for querying Bangumi subject metadata.\n"
        "All tools return JSON with {success, error} fields."
    ),
)


@_mcp.tool()
async def search_bangumi_subjects(
    keyword: str, subject_type: int = 2, max_results: int = 10
) -> dict:
    """Search Bangumi subjects by keyword."""

    try:
        use_case = SearchBangumiSubjects(bangumi=BangumiClientGateway())
        results = await use_case(
            keyword=keyword,
            subject_type=subject_type,
            max_results=max_results,
        )
        return {"keyword": keyword, "results": results, "success": True, "error": None}
    except Exception as exc:
        logger.error(
            "search_bangumi_subjects failed",
            keyword=keyword,
            error=str(exc),
            exc_info=True,
        )
        return {"keyword": keyword, "results": [], "success": False, "error": str(exc)}


@_mcp.tool()
async def get_bangumi_subject(subject_id: int) -> dict:
    """Get Bangumi subject details by ID."""

    try:
        use_case = GetBangumiSubject(bangumi=BangumiClientGateway())
        subject = await use_case(subject_id)
        return {
            "subject_id": subject_id,
            "subject": subject,
            "success": True,
            "error": None,
        }
    except Exception as exc:
        logger.error(
            "get_bangumi_subject failed",
            subject_id=subject_id,
            error=str(exc),
            exc_info=True,
        )
        return {
            "subject_id": subject_id,
            "subject": None,
            "success": False,
            "error": str(exc),
        }


def main() -> None:
    transport = os.environ.get("MCP_TRANSPORT", "stdio")
    _mcp.run(transport=transport)  # type: ignore[arg-type]


if __name__ == "__main__":
    main()
