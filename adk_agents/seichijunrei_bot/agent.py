"""
Seichijunrei Bot - ADK Agent Entry Point

This module defines the root agent for the Seichijunrei (anime pilgrimage) planning bot.
It wraps the OrchestratorAgent and exposes it as an ADK-compatible agent for deployment
to Google Agent Engine.
"""

import os
from typing import Optional, Dict, Any

from google.adk import Agent
from google.adk.tools import FunctionTool, agent_tool

from tools import MapGeneratorTool, PDFGeneratorTool
from domain.entities import PilgrimageSession
from utils.logger import get_logger, setup_logging
from config import get_settings
from adk_agents.seichijunrei_bot._workflows.pilgrimage_workflow import pilgrimage_workflow
from adk_agents.seichijunrei_bot.tools import (
    search_bangumi_subjects,
    get_bangumi_subject,
    get_anitabi_points,
    search_anitabi_bangumi_near_station,
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

# Initialize sub-components (removed old OrchestratorAgent)
_map_generator = MapGeneratorTool()
_pdf_generator = PDFGeneratorTool()


# === Core Orchestration Tools ===
# (Old plan_pilgrimage and plan_pilgrimage_with_bangumi functions removed -
#  replaced by pilgrimage_workflow via agent_tool)
# (Bangumi/Anitabi query tools moved to adk_agents.seichijunrei_bot.tools to avoid circular imports)

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


# === ADK Tools Definition ===
# (Bangumi & Anitabi query functions are imported from adk_agents.seichijunrei_bot.tools)

# Wrap the SequentialAgent workflow as an AgentTool.
# NOTE: The exposed tool name comes from the underlying agent's `name`
# (see `pilgrimage_workflow` definition). That agent MUST keep the
# name `plan_pilgrimage_workflow` to stay consistent with instructions.
pilgrimage_workflow_tool = agent_tool.AgentTool(agent=pilgrimage_workflow)

# Utility tools for map and PDF generation
generate_map_tool = FunctionTool(generate_map)
generate_pdf_tool = FunctionTool(generate_pdf)

# Bangumi and Anitabi query tools
search_bangumi_tool = FunctionTool(search_bangumi_subjects)
get_bangumi_tool = FunctionTool(get_bangumi_subject)
get_anitabi_points_tool = FunctionTool(get_anitabi_points)
search_anitabi_bangumi_tool = FunctionTool(search_anitabi_bangumi_near_station)


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
    你是 Seichijunrei Bot (圣地巡礼机器人)，一个热情的动漫圣地巡礼旅行助手。

    ## 核心能力

    **完整路线规划 (推荐方式):**
    - 工具: `plan_pilgrimage_workflow(request="用户的查询内容")`
    - 用途: 当用户想规划巡礼路线时（包含番剧名或车站名）
    - 示例: request="我在新宿想去你的名字的圣地" → 自动提取→搜索→天气→路线
    - 输出: 包含路线、天气、交通方式的完整计划
    - 重要: 参数名必须是 request，值为用户的原始查询文本

    **探索模式 (浏览用):**
    - `search_anitabi_bangumi_near_station(station_name)` - 查看车站附近的番剧
    - `search_bangumi_subjects(keyword)` - 搜索番剧信息
    - `get_anitabi_points(bangumi_id)` - 查看番剧的所有圣地

    **生成输出:**
    - `generate_map(session_data)` - 生成交互式地图
    - `generate_pdf(session_data)` - 生成PDF手册
    - 在规划完成后主动询问用户是否需要

    ## 交互风格

    - 热情友好，熟悉动漫文化
    - 自然使用中日双语（如"新宿駅"）
    - 清晰列出距离和时间
    - 如遇问题，提供替代方案

    优先使用 `plan_pilgrimage_workflow` 完成完整规划！
    """,
    tools=[
        pilgrimage_workflow_tool,  # Main workflow (replaces old plan_pilgrimage*)
        search_bangumi_tool,
        get_bangumi_tool,
        get_anitabi_points_tool,
        search_anitabi_bangumi_tool,
        generate_map_tool,
        generate_pdf_tool,
    ]
)


# Entry point for ADK CLI
if __name__ == "__main__":
    # This allows running with `adk run agent.py`
    pass
