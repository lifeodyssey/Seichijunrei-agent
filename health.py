"""
Health check endpoints for Seichijunrei Bot.

Provides liveness and readiness probes for deployment monitoring.
"""

import asyncio
from datetime import datetime
from typing import Dict, Any

from utils.logger import get_logger

logger = get_logger(__name__)

# Version info
VERSION = "1.0.0"
BUILD_DATE = datetime.now().isoformat()


async def health_check() -> Dict[str, Any]:
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
            "agents": 7,
            "tools": 2
        }
    }


async def readiness_check() -> Dict[str, Any]:
    """
    Readiness check that verifies external service connections.

    Returns:
        Dictionary with readiness status and service checks
    """
    results = {
        "status": "ready",
        "timestamp": datetime.now().isoformat(),
        "services": {}
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
                "checked_at": datetime.now().isoformat()
            }
            if not is_healthy:
                all_healthy = False
        except Exception as e:
            results["services"][service_name] = {
                "status": "error",
                "error": str(e),
                "checked_at": datetime.now().isoformat()
            }
            all_healthy = False

    results["status"] = "ready" if all_healthy else "not_ready"
    return results


async def _check_agents() -> bool:
    """Check if agents can be imported and initialized."""
    try:
        from agents import (
            OrchestratorAgent,
            SearchAgent,
            WeatherAgent,
            FilterAgent,
            POIAgent,
            RouteAgent,
            TransportAgent
        )
        # Quick instantiation check
        _ = OrchestratorAgent()
        return True
    except Exception as e:
        logger.error("Agent check failed", error=str(e))
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
        from domain.entities import (
            Coordinates,
            Station,
            PilgrimageSession
        )
        # Quick validation check
        coords = Coordinates(latitude=35.6896, longitude=139.7006)
        station = Station(name="Test", coordinates=coords)
        session = PilgrimageSession(session_id="health-check", station=station)
        return True
    except Exception as e:
        logger.error("Domain check failed", error=str(e))
        return False


async def startup_check() -> Dict[str, Any]:
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
        "timestamp": datetime.now().isoformat()
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
