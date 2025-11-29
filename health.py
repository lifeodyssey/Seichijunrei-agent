"""
Health check endpoints for Seichijunrei Bot.

Provides liveness and readiness probes for deployment monitoring.
"""

import asyncio
from datetime import datetime
from typing import Any

from utils.logger import get_logger

logger = get_logger(__name__)

# Version info
VERSION = "1.0.0"
BUILD_DATE = datetime.now().isoformat()


async def health_check() -> dict[str, Any]:
    """
    Basic health check for liveness probe.

    Returns:
        Dictionary with health status and basic info
    """
    return {
        "status": "healthy",
        "version": VERSION,
        "timestamp": datetime.now().isoformat(),
        "components": {
            "adk_agents": 7,  # 3 LlmAgents + 4 BaseAgents
            "workflow_steps": 5,  # Sequential workflow with 5 steps
            "tools": 7,  # PilgrimageWorkflow + 6 utility tools
        },
    }


async def readiness_check() -> dict[str, Any]:
    """
    Readiness check that verifies external service connections.

    Returns:
        Dictionary with readiness status and service checks
    """
    results = {
        "status": "ready",
        "timestamp": datetime.now().isoformat(),
        "services": {},
    }

    # Check each service
    checks = [
        ("agents", _check_agents),
        ("tools", _check_tools),
        ("domain", _check_domain),
    ]

    all_healthy = True

    for service_name, check_func in checks:
        try:
            is_healthy = await check_func()
            results["services"][service_name] = {
                "status": "healthy" if is_healthy else "unhealthy",
                "checked_at": datetime.now().isoformat(),
            }
            if not is_healthy:
                all_healthy = False
        except Exception as e:
            results["services"][service_name] = {
                "status": "error",
                "error": str(e),
                "checked_at": datetime.now().isoformat(),
            }
            all_healthy = False

    results["status"] = "ready" if all_healthy else "not_ready"
    return results


async def _check_agents() -> bool:
    """Check if ADK agents can be imported and initialized."""
    try:
        from adk_agents.seichijunrei_bot._workflows.bangumi_search_workflow import (
            bangumi_search_workflow,
        )
        from adk_agents.seichijunrei_bot._workflows.route_planning_workflow import (
            route_planning_workflow,
        )
        from adk_agents.seichijunrei_bot.agent import root_agent

        # Verify root agent is configured with the expected name
        assert root_agent.name == "seichijunrei_bot"

        # Verify it wires the two-stage workflows as sub-agents
        sub_agent_names = {
            agent.name for agent in getattr(root_agent, "sub_agents", [])
        }
        assert bangumi_search_workflow.name in sub_agent_names
        assert route_planning_workflow.name in sub_agent_names

        return True
    except Exception as e:
        logger.error("ADK agent check failed", error=str(e))
        return False


async def _check_tools() -> bool:
    """Check if tools can be imported and initialized."""
    try:
        from tools import MapGeneratorTool, PDFGeneratorTool

        # Quick instantiation check
        _ = MapGeneratorTool()
        _ = PDFGeneratorTool()
        return True
    except Exception as e:
        logger.error("Tool check failed", error=str(e))
        return False


async def _check_domain() -> bool:
    """Check if domain entities are working."""
    try:
        from domain.entities import Coordinates, PilgrimageSession, Station

        # Quick validation check
        coords = Coordinates(latitude=35.6896, longitude=139.7006)
        station = Station(name="Test", coordinates=coords)
        PilgrimageSession(session_id="health-check", station=station)
        return True
    except Exception as e:
        logger.error("Domain check failed", error=str(e))
        return False


async def startup_check() -> dict[str, Any]:
    """
    Comprehensive startup check.

    Runs all health checks and returns detailed status.
    """
    logger.info("Running startup health checks...")

    health = await health_check()
    readiness = await readiness_check()

    result = {
        "startup_status": "ok" if readiness["status"] == "ready" else "failed",
        "health": health,
        "readiness": readiness,
        "timestamp": datetime.now().isoformat(),
    }

    if result["startup_status"] == "ok":
        logger.info("Startup checks passed", **result)
    else:
        logger.error("Startup checks failed", **result)

    return result


# Entry point for testing
if __name__ == "__main__":
    result = asyncio.run(startup_check())
    print(f"\nStartup Check Result: {result['startup_status'].upper()}")
    for service, status in result["readiness"]["services"].items():
        icon = "✅" if status["status"] == "healthy" else "❌"
        print(f"  {icon} {service}: {status['status']}")
