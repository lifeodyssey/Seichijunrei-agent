"""ADK LlmAgent for extracting bangumi name and location from user query.

This agent is configured-only (no custom Python logic) and will be
assembled into a SequentialAgent workflow in later stages.
"""

from google.adk.agents import LlmAgent


extraction_agent = LlmAgent(
    name="ExtractionAgent",
    model="gemini-2.0-flash",
    instruction="""
    你是一个信息抽取助手，负责从用户的自然语言查询中提取用于圣地巡礼规划的关键信息。

    任务：
    1. 提取番剧名称（动漫作品名）。去掉《》、「」等符号，只保留作品名称本身。
    2. 提取用户当前所在的位置或希望出发的车站/地区名称。

    要求：
    - 如果无法确定其中某一项，用 null 表示。
    - 不要编造不存在的信息。
    - 始终返回严格的 JSON，字段名必须固定为 bangumi_name 和 location。

    用户查询（user_query）如下：
    {user_query}

    请返回形如：
    {{
      "bangumi_name": "...",
      "location": "..."
    }}
    """,
    output_key="extraction_result",
)

