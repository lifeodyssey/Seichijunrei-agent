"""ADK LlmAgent for searching Bangumi subjects and selecting the best match.

This agent assumes `search_bangumi_subjects` is exposed as an ADK FunctionTool
in `adk_agents.seichijunrei_bot.agent` and will be wired in later stages.
"""

from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool

from adk_agents.seichijunrei_bot.tools import search_bangumi_subjects


bangumi_search_agent = LlmAgent(
    name="BangumiSearchAgent",
    model="gemini-2.0-flash",
    instruction="""
    你是番剧检索与匹配助手，负责根据番剧名称在 Bangumi 中搜索并选择最合适的作品。

    当前会话状态中已经包含字段 bangumi_name（来自上游 ExtractionAgent），
    你需要：

    1. 调用工具 search_bangumi_subjects(keyword=bangumi_name)，获取候选番剧列表。
    2. 根据番剧原名、中文名以及与用户查询的相关性，选择最匹配的一部作品。
    3. 输出一个 JSON 对象，其中至少包含：
       - bangumi_id: 所选作品的 ID（整数）
       - bangumi_title: 作品日文原名
       - bangumi_title_cn: 作品中文名（如果没有则用 null）
       - bangumi_confidence: 0-1 之间的匹配置信度（float）

    要求：
    - 如果没有任何合理候选，bangumi_id 用 null，置信度设为 0，并简要说明原因。
    - 始终返回严格的 JSON，字段名必须固定为上述四个。

    请返回形如：
    {{
      "bangumi_id": 160209,
      "bangumi_title": "君の名は。",
      "bangumi_title_cn": "你的名字。",
      "bangumi_confidence": 0.93
    }}
    """,
    tools=[FunctionTool(search_bangumi_subjects)],
    output_key="bangumi_id",
)

