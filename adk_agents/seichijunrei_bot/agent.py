"""
Seichijunrei Bot - ADK Agent Entry Point

This module defines the root ADK agent for the Seichijunrei (anime pilgrimage)
planning bot. It exposes a Gemini-powered LlmAgent that orchestrates the
multi-agent workflows for:

- Stage 1: extracting user intent and searching Bangumi for candidates
- Stage 2: interpreting the user's selection, fetching pilgrimage points
  from Anitabi, selecting the best points, and generating a route plan
"""

import os

from google.adk.sessions import InMemorySessionService
from google.adk.tools import FunctionTool

from config import get_settings
from utils.logger import get_logger, setup_logging

from ._agents.mcp_probe_agent import mcp_probe_agent
from ._intent import IntentRouter
from .skills import ROOT_SUB_AGENTS
from .tools import (
    get_anitabi_points,
    get_bangumi_subject,
    search_anitabi_bangumi_near_station,
    search_bangumi_subjects,
)

# Initialize logging when module is loaded
setup_logging()
logger = get_logger(__name__)

# Log startup information
settings = get_settings()
logger.info(
    "Seichijunrei Bot initialized",
    adk_version="2.0",
    python_path=os.getcwd(),
    debug_mode=settings.debug,
    log_level=settings.log_level,
)

# Configure persistent session storage for multi-invocation conversations.
session_service = InMemorySessionService()

# === ADK Tools Definition ===
# (Bangumi & Anitabi query functions are imported from the local tools module)

# ADK Best Practice: Use SequentialAgent directly as root agent instead of wrapping it in AgentTool
# This ensures proper state propagation between sub-agents in the workflow.
# The old approach (wrapping as AgentTool) caused state isolation issues where
# sub-agent outputs were not accessible to downstream agents.

# Bangumi and Anitabi query tools
search_bangumi_tool = FunctionTool(search_bangumi_subjects)
get_bangumi_tool = FunctionTool(get_bangumi_subject)
get_anitabi_points_tool = FunctionTool(get_anitabi_points)
search_anitabi_bangumi_tool = FunctionTool(search_anitabi_bangumi_near_station)

# Root intent router between Stage 1 and Stage 2 workflows.
# Name is kept as 'seichijunrei_bot' to match ADK Web app_name configuration.
root_agent = IntentRouter(
    name="seichijunrei_bot",
    description=(
        "Intent router for Seichijunrei Bot. Routes user input via fast path "
        "(regex patterns) or slow path (LLM classifier) to appropriate workflows."
    ),
    sub_agents=[*ROOT_SUB_AGENTS, mcp_probe_agent],
)


# Entry point for ADK CLI
if __name__ == "__main__":
    # This allows running with `adk run agent.py`
    pass
