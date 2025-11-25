"""
Seichijunrei Bot - ADK Agent Entry Point

This module defines the root agent for the Seichijunrei (anime pilgrimage) planning bot.
It wraps the OrchestratorAgent and exposes it as an ADK-compatible agent for deployment
to Google Agent Engine.
"""

import os
from typing import Optional

from google.adk import Agent
from google.adk.tools import FunctionTool

from agents import OrchestratorAgent
from agents.base import AgentInput
from tools import MapGeneratorTool, PDFGeneratorTool
from domain.entities import PilgrimageSession
from utils.logger import get_logger

logger = get_logger(__name__)

# Initialize sub-components
_orchestrator = OrchestratorAgent()
_map_generator = MapGeneratorTool()
_pdf_generator = PDFGeneratorTool()


async def plan_pilgrimage(station_name: str, session_id: Optional[str] = None) -> dict:
    """
    Plan a complete anime pilgrimage route from a station.

    This is the main entry point for the pilgrimage planning workflow.
    It coordinates all 6 sub-agents to generate a complete plan.

    Args:
        station_name: Name of the starting station (e.g., "新宿駅", "Shinjuku Station")
        session_id: Optional session ID for tracking. Auto-generated if not provided.

    Returns:
        Dictionary containing:
        - session: Complete PilgrimageSession data
        - success: Boolean indicating success
        - steps_completed: Number of workflow steps completed
        - errors: List of any errors encountered

    Example:
        >>> result = await plan_pilgrimage("新宿駅")
        >>> print(f"Found {len(result['session']['points'])} pilgrimage points")
    """
    import uuid

    if not session_id:
        session_id = f"session-{uuid.uuid4().hex[:8]}"

    logger.info(
        "Starting pilgrimage planning",
        station_name=station_name,
        session_id=session_id
    )

    try:
        input_data = AgentInput(
            session_id=session_id,
            data={"station_name": station_name}
        )

        result = await _orchestrator.execute(input_data)

        if result.success:
            logger.info(
                "Pilgrimage planning completed successfully",
                session_id=session_id,
                points_count=len(result.data["session"].get("points", []))
            )
        else:
            logger.error(
                "Pilgrimage planning failed",
                session_id=session_id,
                error=result.error
            )

        return {
            "session": result.data.get("session") if result.success else None,
            "success": result.success,
            "steps_completed": result.data.get("steps_completed", 0) if result.success else 0,
            "errors": [result.error] if result.error else []
        }

    except Exception as e:
        logger.exception(
            "Unexpected error in pilgrimage planning",
            session_id=session_id,
            error=str(e)
        )
        return {
            "session": None,
            "success": False,
            "steps_completed": 0,
            "errors": [str(e)]
        }


async def generate_map(session_data: dict) -> dict:
    """
    Generate an interactive HTML map for a pilgrimage session.

    Args:
        session_data: Dictionary containing PilgrimageSession data

    Returns:
        Dictionary containing:
        - map_path: Path to the generated HTML map file
        - success: Boolean indicating success
        - error: Error message if failed
    """
    try:
        session = PilgrimageSession(**session_data)
        map_path = await _map_generator.generate(session)

        logger.info(
            "Map generated successfully",
            session_id=session.session_id,
            map_path=map_path
        )

        return {
            "map_path": map_path,
            "success": True,
            "error": None
        }

    except Exception as e:
        logger.error(
            "Map generation failed",
            error=str(e)
        )
        return {
            "map_path": None,
            "success": False,
            "error": str(e)
        }


async def generate_pdf(session_data: dict, map_image_path: Optional[str] = None) -> dict:
    """
    Generate a PDF pilgrimage guide for a session.

    Args:
        session_data: Dictionary containing PilgrimageSession data
        map_image_path: Optional path to a map image to embed

    Returns:
        Dictionary containing:
        - pdf_path: Path to the generated PDF file
        - success: Boolean indicating success
        - error: Error message if failed
    """
    try:
        session = PilgrimageSession(**session_data)
        pdf_path = await _pdf_generator.generate(session, map_image_path)

        logger.info(
            "PDF generated successfully",
            session_id=session.session_id,
            pdf_path=pdf_path
        )

        return {
            "pdf_path": pdf_path,
            "success": True,
            "error": None
        }

    except Exception as e:
        logger.error(
            "PDF generation failed",
            error=str(e)
        )
        return {
            "pdf_path": None,
            "success": False,
            "error": str(e)
        }


# Define ADK tools
plan_pilgrimage_tool = FunctionTool(plan_pilgrimage)
generate_map_tool = FunctionTool(generate_map)
generate_pdf_tool = FunctionTool(generate_pdf)


# Define the root agent
root_agent = Agent(
    name="seichijunrei_bot",
    model="gemini-2.0-flash",
    description="""
    Seichijunrei Bot (圣地巡礼机器人) - An AI-powered travel assistant for anime pilgrims.

    This agent helps users plan pilgrimage routes to visit real-world locations
    featured in anime. It can:
    - Search for anime locations near a train station
    - Check weather conditions for the visit
    - Filter locations based on user preferences
    - Optimize the visiting route
    - Suggest transportation modes (walking vs transit)
    - Generate interactive maps and PDF guides
    """,
    instruction="""
    You are Seichijunrei Bot, a friendly and knowledgeable travel assistant specialized
    in anime pilgrimage (聖地巡礼/圣地巡礼) planning.

    When a user wants to plan a pilgrimage:
    1. Ask for their starting station if not provided
    2. Use the plan_pilgrimage tool to generate a complete plan
    3. Offer to generate a map or PDF guide if successful
    4. Present the results in a clear, bilingual (Chinese/Japanese) format

    Always be enthusiastic about anime and helpful with travel advice!
    Use both Chinese and Japanese when appropriate for location names.
    """,
    tools=[
        plan_pilgrimage_tool,
        generate_map_tool,
        generate_pdf_tool
    ]
)


# Entry point for ADK CLI
if __name__ == "__main__":
    # This allows running with `adk run agent.py`
    pass
