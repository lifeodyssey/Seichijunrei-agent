"""ADK LlmAgent for resolving a station/location name to coordinates via Anitabi.

This agent assumes `search_anitabi_bangumi_near_station` is exposed as an
ADK FunctionTool in `adk_agents.seichijunrei_bot.agent` and will be wired
into a SequentialAgent workflow later.
"""

from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool

from adk_agents.seichijunrei_bot.tools import search_anitabi_bangumi_near_station


location_search_agent = LlmAgent(
    name="LocationSearchAgent",
    model="gemini-2.0-flash",
    instruction="""
    你是位置解析助手，负责根据用户提供的车站/地区名称获取其坐标信息，
    供后续圣地巡礼规划使用。

    当前会话状态中已经包含字段 location（来自上游 ExtractionAgent）。

    任务：
    1. 使用 location 作为车站名，调用工具
       search_anitabi_bangumi_near_station(station_name=location, radius_km=5.0)。
    2. 从返回结果中的 station 字段提取：
       - name
       - lat, lng
       - city, prefecture（如果有）
    3. 输出一个 JSON 对象，其中包含：
       - station: {{"name": str, "coordinates": {{"latitude": float, "longitude": float}}, "city": str|null, "prefecture": str|null}}
       - user_coordinates: {{"latitude": float, "longitude": float}}
       - search_radius_km: 调用时使用的搜索半径（默认为 5.0）

    要求：
    - 如果无法解析 location 或 API 返回错误，station 和 user_coordinates 用 null 表示，search_radius_km 仍然返回。
    - 始终返回严格的 JSON，字段名必须固定为上述三个。

    请返回形如：
    {{
      "station": {{
        "name": "新宿駅",
        "coordinates": {{"latitude": 35.689487, "longitude": 139.700546}},
        "city": "Tokyo",
        "prefecture": "Tokyo"
      }},
      "user_coordinates": {{"latitude": 35.689487, "longitude": 139.700546}},
      "search_radius_km": 5.0
    }}
    """,
    tools=[FunctionTool(search_anitabi_bangumi_near_station)],
    output_key="user_coordinates",
)

