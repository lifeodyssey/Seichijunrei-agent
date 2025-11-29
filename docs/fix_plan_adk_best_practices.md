# Seichijunrei Bot 问题修复计划

**基于 ADK 官方文档最佳实践**

---

**创建日期**: 2025-11-29
**版本**: v1.0
**状态**: 待实施
**预计完成时间**: 1.5 小时

---

## 目录

1. [问题总结](#问题总结)
2. [ADK 官方最佳实践参考](#adk-官方最佳实践参考)
3. [修复方案详解](#修复方案详解)
4. [实施步骤](#实施步骤)
5. [测试验证](#测试验证)
6. [预期改进](#预期改进)
7. [参考资料](#参考资料)

---

## 问题总结

### 问题 1: `additionalProperties` 错误 (Critical)

**现象**:
```
ValueError: additionalProperties is not supported in the Gemini API
```

**位置**: `_schemas.py:128`

**根本原因**:
```python
class PointsSelectionResult(BaseModel):
    selected_points: list[dict] = Field(...)  # ❌ 问题所在
```

使用 `list[dict]` 时，Pydantic 会生成如下 JSON Schema：
```json
{
  "type": "array",
  "items": {
    "type": "object",
    "additionalProperties": true  // ❌ Gemini API 不支持
  }
}
```

**影响**:
- PointsSelectionAgent 无法正常运行
- 整个 Stage 2 workflow 失败
- 用户无法获得路线规划结果

---

### 问题 2: 用户交互延迟

**现象**:
- `BangumiCandidatesFormatter` 正确返回候选列表 JSON
- 但需要用户再次回复才能看到"请选择作品"的提示
- 用户体验不流畅

**当前流程**:
```
用户: 我在宇治 想巡礼京吹
Bot: { "candidates": [...], "query": "吹响！上低音号", "total": 9 }
[需要用户再次输入]
用户: [任意输入]
Bot: 找到以下动漫作品，请选择...
```

**根本原因**:
- `BangumiCandidatesFormatter` 使用 `output_schema`，只输出结构化 JSON
- 没有生成用户友好的自然语言展示
- Root agent 需要额外的 invocation 轮次才能处理展示逻辑

---

### 问题 3: State 传递验证

**需求**:
- 确认 `extraction_result.location` 在 Stage 2 的所有 agents 中都可访问
- 验证 Session State 在两个 workflow 之间正确传递

**当前状态**:
- 理论上应该通过 `ctx.session.state` 共享
- 但缺少日志和验证机制
- 无法确认实际运行时是否正常

---

## ADK 官方最佳实践参考

### 1. Gemini API Schema 限制

**官方文档**: [Gemini API Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output)

**支持的 JSON Schema 特性**:
- `type`: string, number, integer, boolean, object, array, null
- `properties`, `required`, `enum`, `format`
- `minimum`, `maximum`, `items`, `minItems`, `maxItems`

**不支持的特性**:
- ❌ `additionalProperties` (虽然文档列出，但 Python SDK 实际不支持)
- ❌ 泛型 `dict[str, Any]` 类型

**官方推荐解决方案** (来自 [StackOverflow](https://stackoverflow.com/questions/79225718)):

```python
# ❌ 错误做法
teams: dict[str, int]

# ✅ 正确做法
teams: list[KeyValuePair]

class KeyValuePair(BaseModel):
    key: str
    value: int
```

---

### 2. output_schema + tools 分离原则

**官方文档**: [ADK LLM Agents](https://google.github.io/adk-docs/agents/llm-agents/)

**核心约束**:

> **"Cannot use tools=[...] effectively here"** when `output_schema` is configured.

> When `output_schema` is set, the LLM becomes constrained to generating **only JSON** conforming to the specified schema, leaving **no room for tool invocations**.

**官方推荐模式**:

```python
# ❌ 违反约束
LlmAgent(
    tools=[some_tool],
    output_schema=MySchema  # ❌ 冲突
)

# ✅ 符合 ADK 最佳实践
SequentialAgent(
    sub_agents=[
        # Step 1: 调用工具
        LlmAgent(
            name="ToolCaller",
            tools=[some_tool],
            output_key="temp:results"
        ),
        # Step 2: 格式化输出
        LlmAgent(
            name="Formatter",
            output_schema=MySchema,
            output_key="final_result"
        ),
    ]
)
```

---

### 3. SequentialAgent State 管理

**官方文档**: [ADK State Management](https://google.github.io/adk-docs/sessions/state/)

**State 前缀和生命周期**:

| 前缀 | 作用域 | 持久化 | 用途示例 |
|------|--------|--------|---------|
| **无前缀** | 当前 session | 仅在持久化服务中 | `bangumi_candidates`, `selected_bangumi` |
| **`temp:`** | 当前 invocation | ❌ 不持久化 | `temp:raw_results` |
| **`user:`** | 同一用户的所有 sessions | ✅ 持久化 | `user:preferences` |
| **`app:`** | 所有用户和 sessions | ✅ 持久化 | `app:templates` |

**State 共享机制**:

> **"SequentialAgent passes the same InvocationContext to each of its sub-agents. This means they all share the same session state, including the temporary (`temp:`) namespace"**

**State Injection 语法**:

```python
instruction="""
从用户起点 {extraction_result.location} 出发，
为 {selected_bangumi.bangumi_title} 规划路线。
"""
```

---

### 4. Presentation Agent 模式

**最佳实践**: 使用专门的 LlmAgent 负责用户界面展示

**设计原则**:
- **数据处理 Agent**: 使用 `output_schema`，输出结构化 JSON
- **展示 Agent**: 不使用 `output_schema`，输出自然语言

**架构模式**:

```
SequentialAgent
├── DataProcessor (output_schema=MySchema)
└── Presenter (无 output_schema，自由输出)
```

---

## 修复方案详解

### 修复 1: 解决 `additionalProperties` 错误

#### 1.1 修改文件

**文件**: `adk_agents/seichijunrei_bot/_schemas.py`

#### 1.2 新增 `SelectedPoint` Model

```python
class SelectedPoint(BaseModel):
    """单个选中的巡礼点位 (从 all_points 中选择)

    这个 model 定义了 PointsSelectionAgent 输出的点位结构。
    使用显式的 Pydantic model 而不是 dict，以避免 Gemini API 的
    additionalProperties 限制。

    所有字段都是 Optional，因为不同来源的点位数据可能不完整。
    """

    id: str | None = None
    name: str | None = None
    cn_name: str | None = None
    lat: float | None = None
    lng: float | None = None
    episode: int | None = None
    time_seconds: int | None = None
    screenshot_url: str | None = None
    address: str | None = None

    # 可以根据实际 Anitabi API 返回的字段扩展
    # 但必须是显式定义的字段，不能使用 dict


class PointsSelectionResult(BaseModel):
    """LLM-driven intelligent selection over all available pilgrimage points.

    ✅ 修复: selected_points 从 list[dict] 改为 list[SelectedPoint]
    """

    selected_points: list[SelectedPoint] = Field(  # ✅ 显式类型
        default_factory=list,
        description="Selected pilgrimage points (8-12 items) taken from all_points.",
    )
    selection_rationale: str = Field(
        description="2-3 sentence explanation of why these points were chosen."
    )
    estimated_coverage: str = Field(
        description='Estimated episode coverage range, e.g. "第1-6集".'
    )
    total_available: int = Field(
        description="Total number of available points before selection.",
    )
    rejected_count: int = Field(
        description="Number of points not selected (total_available - len(selected_points)).",
    )
```

#### 1.3 验证修改

运行以下代码验证 schema 不包含 `additionalProperties`:

```python
from adk_agents.seichijunrei_bot._schemas import PointsSelectionResult

schema = PointsSelectionResult.model_json_schema()
print(schema)

# 确认输出中没有 additionalProperties
assert "additionalProperties" not in str(schema)
```

---

### 修复 2: 添加 Presentation Agent

#### 2.1 创建新文件

**文件**: `adk_agents/seichijunrei_bot/_agents/user_presentation_agent.py`

```python
"""ADK LlmAgent for generating user-friendly presentation text.

This agent reads structured data from session state and generates natural
language responses for the user. It does NOT use output_schema, allowing
it to produce conversational, free-form text.

Following ADK best practices, this agent is responsible for UI/UX concerns
(presentation), while other agents handle data processing (with output_schema).
"""

from google.adk.agents import LlmAgent


user_presentation_agent = LlmAgent(
    name="UserPresentationAgent",
    model="gemini-2.0-flash",
    instruction="""
    你是一个用户界面展示助手，负责将结构化数据转换为友好的对话文本。

    **你可以从 session state 中获取**:
    - bangumi_candidates: 搜索到的候选作品列表
      - candidates: [{ bangumi_id, title, title_cn, air_date, summary }, ...]
      - query: 原始搜索关键词
      - total: 找到的总数

    **你的任务**:
    生成一段清晰、友好的展示文本，帮助用户选择合适的动漫作品。

    **输出格式要求**:

    1. **开场白** (1句话):
       告诉用户找到了多少个相关作品，基于什么关键词。

       示例：
       "找到 3 个与「{query}」相关的动漫作品，请选择一个："

    2. **候选列表** (逐个展示，最多 3-5 个):

       格式：
       1. **{title_cn}** ({title}, {air_date})
          {summary}

       2. **{title_cn}** ({title}, {air_date})
          {summary}

       注意：
       - 使用 Markdown 粗体 ** 突出标题
       - 包含中文标题、日文标题、播出日期
       - 摘要保持简洁（1-2 句话）
       - 编号从 1 开始

    3. **选择提示** (2-3句话):
       明确告诉用户如何做出选择。

       示例：
       "请回复数字（如「1」）来选择第一个作品。
       也可以用描述（如「第一季」「2015年的」）来表达您的选择。"

    **语气和风格**:
    - 自然、友好、简洁
    - 不要使用 JSON 或代码格式
    - 直接输出对话文本，不要包裹在任何标记中
    - 使用「」而不是引号，更友好

    **特殊情况处理**:
    - 如果 bangumi_candidates.candidates 为空：
      "抱歉，没有找到与「{query}」匹配的动漫作品。
      请检查拼写或尝试使用其他名称（如日文原名或常用简称）。"

    **重要约束**:
    - 不使用 output_schema - 直接输出自然语言
    - 从 {bangumi_candidates} 读取数据（自动 state injection）
    - 输出会作为 workflow 的最终返回给用户
    """,
    # ✅ 不使用 output_schema - 让 LLM 自由生成自然语言
    # ✅ 不使用 output_key - 输出直接返回给用户，不持久化
)
```

#### 2.2 更新 Workflow

**文件**: `adk_agents/seichijunrei_bot/_workflows/bangumi_search_workflow.py`

**修改前**:
```python
bangumi_search_workflow = SequentialAgent(
    name="BangumiSearchWorkflow",
    sub_agents=[
        extraction_agent,
        bangumi_candidates_agent,
    ],
)
```

**修改后**:
```python
from google.adk.agents import SequentialAgent

from .._agents.extraction_agent import extraction_agent
from .._agents.bangumi_candidates_agent import bangumi_candidates_agent
from .._agents.user_presentation_agent import user_presentation_agent  # ✨ 新增


bangumi_search_workflow = SequentialAgent(
    name="BangumiSearchWorkflow",
    description=(
        "Stage 1 workflow for Seichijunrei: extract bangumi name and location "
        "from the user query, search Bangumi, format candidates, and present "
        "a user-friendly selection prompt."  # ✨ 更新描述
    ),
    sub_agents=[
        extraction_agent,              # Step 1: 提取 bangumi_name + location
        bangumi_candidates_agent,      # Step 2: 搜索 + 格式化候选列表
        user_presentation_agent,       # Step 3: ✨ 生成用户友好的展示文本
    ],
)
```

#### 2.3 预期效果对比

**修改前**:
```
用户: 我在宇治 想巡礼京吹

Bot: { "candidates": [ { "bangumi_id": 115908, "title": "響け！ユーフォニアム", ... } ], "query": "吹响！上低音号", "total": 9 }

[等待用户再次输入]

用户: hi

Bot: 找到以下动漫作品，请选择一个：
1. 吹响吧！上低音号 (響け！ユーフォニアム, 2015年4月)
   ...
```

**修改后**:
```
用户: 我在宇治 想巡礼京吹

Bot: 找到 4 个与「吹响！上低音号」相关的动漫作品，请选择一个：

1. **吹响吧！上低音号** (響け！ユーフォニアム, 2015年4月)
   京都府立北宇治高中吹奏乐部的青春故事。

2. **吹响吧！上低音号 第二季** (響け！ユーフォニアム2, 2016年10月)
   北宇治吹奏乐部向全国大赛进发的第二季。

3. **吹响吧！上低音号3** (響け！ユーフォニアム3, 2024年4月)
   最新一季，继续讲述吹奏乐部成员的成长。

请回复数字（如「1」）来选择第一个作品。
也可以用描述（如「第一季」「2015年的」）来表达您的选择。

[直接等待用户选择，无需额外轮次 ✅]
```

---

### 修复 3: 验证 Session State 传递

#### 3.1 在 PointsSelectionAgent 中添加 State Injection

**文件**: `adk_agents/seichijunrei_bot/_agents/points_selection_agent.py`

**修改点**: 在 instruction 中显式引用 `extraction_result.location`

```python
points_selection_agent = LlmAgent(
    name="PointsSelectionAgent",
    model="gemini-2.0-flash",
    instruction="""
    你是一个动漫巡礼规划助手，需要从所有候选巡礼点中智能选择最适合本次行程的 8-12 个点位。

    你可以从会话 state 中获得以下信息：
    - all_points: 当前番剧在 Anitabi 上的所有巡礼点列表（通常 10-50 个）
    - extraction_result.location: 用户的起点位置（例如 "宇治"、"东京"）✅ 验证 state injection
    - selected_bangumi.bangumi_title: 动漫的日文标题

    请选择点位时，请按下面的优先级思考：

    1. **地理合理性** (最高优先级)
       - 尽量选择距离用户起点 **{extraction_result.location}** 较近、相互之间也较集中的点位  ✅ 使用 state injection
       - 避免路线过于发散，导致一天内难以全部游览
       - 一个紧凑、可行的一日路线比覆盖所有点位更重要

    2. **剧情重要性**
       - 优先选择 OP/ED、重要剧情转折、经典场景的取景地
       - 尽量覆盖作品的主线剧情，而不是只集中在一两集

    3. **游览可行性**
       - 优先公共场所（公园、神社、街道、车站等）
       - 避免私人住宅、明显属于私有空间的地点
       - 若能从字段中看出有明显时间/费用限制，可以适度控制数量

    4. **数量平衡**
       - 最终选出 8-12 个点位
       - 数量太少体验不够丰富，太多则会导致行程过于紧张

    输出要求（必须严格遵守）：
    - selected_points:
        - 必须完全来自 all_points 中的元素
        - 不要创造新的点位，也不要修改原始字段
        - 直接复用原始点位对象（包含所有字段）
    - selection_rationale:
        - 用 2-3 句话解释这条路线的整体选择理由
        - 例如为什么集中在某个区域，或为什么选择这些经典场景
    - estimated_coverage:
        - 粗略说明覆盖的集数范围，如 "第1-6集"
        - 如果信息不足，可以用模糊表述，如 "主要覆盖前半部分剧情"
    - total_available:
        - all_points 的总数量
    - rejected_count:
        - 未被选入的点位数量 = total_available - len(selected_points)

    重要提示：
    - 你必须基于 all_points 的实际内容做出选择，而不是泛泛而谈。
    - 如果 all_points 很少（例如 <= 12 个），可以全部选上，仍要给出合理解释。
    - 如果 all_points 为空，selected_points 也应为空，并解释原因。
    """,
    output_schema=PointsSelectionResult,
    output_key="points_selection_result"
)
```

**关键改动**:
- ✅ 在 instruction 第 7 行显式引用 `{extraction_result.location}`
- ✅ 在优先级 1 中再次使用，强调地理合理性基于起点位置

#### 3.2 在 PointsSearchAgent 中添加日志

**文件**: `adk_agents/seichijunrei_bot/_agents/points_search_agent.py`

**在 `_run_async_impl` 开头添加验证日志**:

```python
async def _run_async_impl(self, ctx):  # type: ignore[override]
    state: Dict[str, Any] = ctx.session.state

    # ✅ 添加 state 验证日志
    extraction = state.get("extraction_result") or {}
    selected = state.get("selected_bangumi") or {}

    self.logger.info(
        "[PointsSearchAgent] Session state check",
        has_extraction_result=bool(extraction),
        has_location=bool(extraction.get("location")),
        location_value=extraction.get("location"),
        has_selected_bangumi=bool(selected),
        has_bangumi_id=bool(selected.get("bangumi_id")),
        bangumi_id_value=selected.get("bangumi_id"),
    )

    # Prefer the new Capstone state shape first: selected_bangumi.bangumi_id
    bangumi_id = selected.get("bangumi_id")

    # Backward-compatible fallback: older workflow uses bangumi_result.bangumi_id
    if bangumi_id is None:
        bangumi_result = state.get("bangumi_result") or {}
        bangumi_id = bangumi_result.get("bangumi_id")

    if not isinstance(bangumi_id, int):
        raise ValueError(
            f"PointsSearchAgent requires valid bangumi_id. "
            f"Got: {bangumi_id} (type: {type(bangumi_id).__name__})"
        )

    # ... 其余代码不变
```

**预期日志输出**:

```
[INFO] [PointsSearchAgent] Session state check
  has_extraction_result=True
  has_location=True
  location_value="宇治"
  has_selected_bangumi=True
  has_bangumi_id=True
  bangumi_id_value=115908
```

---

### 修复 4: 确认 output_schema + tools 分离 (无需修改)

#### 4.1 验证现有实现

**文件**: `adk_agents/seichijunrei_bot/_agents/bangumi_candidates_agent.py`

**当前实现**:

```python
_bangumi_searcher = LlmAgent(
    name="BangumiSearcher",
    model="gemini-2.0-flash",
    tools=[FunctionTool(search_bangumi_subjects)],  # ✅ 只使用 tools
    # ✅ 不使用 output_schema
)

_candidates_formatter = LlmAgent(
    name="BangumiCandidatesFormatter",
    model="gemini-2.0-flash",
    output_schema=BangumiCandidatesResult,  # ✅ 只使用 output_schema
    output_key="bangumi_candidates",
    # ✅ 不使用 tools
)

bangumi_candidates_agent = SequentialAgent(
    name="BangumiCandidatesAgent",
    sub_agents=[
        _bangumi_searcher,      # Step 1: 调用工具
        _candidates_formatter,  # Step 2: 格式化输出
    ],
)
```

**结论**: ✅ **符合 ADK 官方最佳实践，无需修改**

---

## 实施步骤

### Phase 1: 修复 additionalProperties 错误 (15分钟)

**目标**: 修复 Gemini API schema 验证错误

#### 步骤:

1. **修改 `_schemas.py`** (10分钟)
   ```bash
   # 编辑文件
   code adk_agents/seichijunrei_bot/_schemas.py

   # 在 PointsSelectionResult 之前新增 SelectedPoint class
   # 更新 PointsSelectionResult.selected_points 类型
   ```

2. **验证 Schema 生成** (5分钟)
   ```bash
   # 运行 Python 验证脚本
   python -c "
   from adk_agents.seichijunrei_bot._schemas import PointsSelectionResult
   import json

   schema = PointsSelectionResult.model_json_schema()
   print(json.dumps(schema, indent=2))

   # 确认没有 additionalProperties
   assert 'additionalProperties' not in json.dumps(schema)
   print('✅ Schema 验证通过')
   "
   ```

#### 验收标准:

- ✅ `SelectedPoint` class 定义正确
- ✅ `PointsSelectionResult.selected_points` 类型为 `list[SelectedPoint]`
- ✅ Schema 生成不包含 `additionalProperties`

---

### Phase 2: 添加 Presentation Agent (30分钟)

**目标**: 改进用户交互体验，实现一轮对话直接展示候选列表

#### 步骤:

1. **创建 `user_presentation_agent.py`** (15分钟)
   ```bash
   # 创建新文件
   touch adk_agents/seichijunrei_bot/_agents/user_presentation_agent.py

   # 编辑文件，复制上面的完整代码
   code adk_agents/seichijunrei_bot/_agents/user_presentation_agent.py
   ```

2. **更新 `bangumi_search_workflow.py`** (5分钟)
   ```bash
   # 编辑 workflow 文件
   code adk_agents/seichijunrei_bot/_workflows/bangumi_search_workflow.py

   # 添加 import: from .._agents.user_presentation_agent import user_presentation_agent
   # 在 sub_agents 列表末尾添加: user_presentation_agent
   ```

3. **测试 Stage 1 完整流程** (10分钟)
   ```bash
   # 运行测试
   pytest tests/integration/test_bangumi_search_workflow.py -v

   # 或手动测试
   python -m adk_agents.seichijunrei_bot.agent
   # 输入: "我在宇治 想巡礼京吹"
   # 验证: 直接看到候选列表，无需额外输入
   ```

#### 验收标准:

- ✅ `user_presentation_agent.py` 文件创建成功
- ✅ `bangumi_search_workflow` 包含 3 个 sub-agents
- ✅ 用户输入一次即可看到完整的候选列表展示
- ✅ 展示文本自然、友好，包含选择提示

---

### Phase 3: 验证 State 传递 (15分钟)

**目标**: 确认 `extraction_result.location` 在 Stage 2 正确传递

#### 步骤:

1. **更新 `points_selection_agent.py` instruction** (5分钟)
   ```bash
   code adk_agents/seichijunrei_bot/_agents/points_selection_agent.py

   # 在 instruction 中显式引用 {extraction_result.location}
   # 见上面修复 3.1 的详细代码
   ```

2. **在 `points_search_agent.py` 添加日志** (5分钟)
   ```bash
   code adk_agents/seichijunrei_bot/_agents/points_search_agent.py

   # 在 _run_async_impl 开头添加验证日志
   # 见上面修复 3.2 的详细代码
   ```

3. **运行端到端测试并检查日志** (5分钟)
   ```bash
   # 运行完整流程测试
   pytest tests/e2e/test_full_conversation.py -v -s

   # 查看日志输出，确认包含:
   # [PointsSearchAgent] Session state check
   #   has_extraction_result=True
   #   location_value="宇治"
   ```

#### 验收标准:

- ✅ `points_selection_agent` instruction 引用 `{extraction_result.location}`
- ✅ `points_search_agent` 日志输出 state 验证信息
- ✅ 日志确认 `location` 在 Stage 2 可访问
- ✅ PointsSelectionAgent 正确基于起点位置选择点位

---

### Phase 4: 集成测试 (20分钟)

**目标**: 验证所有修复综合生效，用户体验完整流畅

#### 步骤:

1. **运行完整的两阶段测试** (10分钟)
   ```bash
   # 完整端到端测试
   pytest tests/e2e/ -v -s

   # 或手动测试完整流程
   python -m adk_agents.seichijunrei_bot.agent

   # Round 1:
   # 输入: "我在宇治 想巡礼京吹"
   # 验证: 直接展示候选列表 ✅

   # Round 2:
   # 输入: "选择1"
   # 验证: 成功生成路线规划 ✅
   ```

2. **检查所有日志和输出** (5分钟)
   ```bash
   # 检查日志文件
   tail -f logs/seichijunrei_bot.log

   # 验证点:
   # ✅ 没有 additionalProperties 错误
   # ✅ State 传递日志正常
   # ✅ 用户体验流畅
   ```

3. **边界情况测试** (5分钟)
   ```bash
   # 测试无结果场景
   # 输入: "我想去不存在的动漫ABC"
   # 验证: 友好提示找不到结果

   # 测试无效选择
   # Round 1: "我在宇治 想巡礼京吹"
   # Round 2: "选择99"
   # 验证: 提示选择无效，重新展示列表
   ```

#### 验收标准:

- ✅ 完整的两轮对话流程正常运行
- ✅ 无 schema 验证错误
- ✅ State 正确传递
- ✅ 用户体验流畅，一轮对话看到候选
- ✅ 边界情况处理正确

---

## 测试验证

### 测试 1: Schema 验证

**目的**: 确认 PointsSelectionResult schema 不包含 additionalProperties

```python
# tests/unit/test_schemas.py

import json
from adk_agents.seichijunrei_bot._schemas import (
    PointsSelectionResult,
    SelectedPoint,
)


def test_selected_point_schema():
    """验证 SelectedPoint schema 正确生成"""
    schema = SelectedPoint.model_json_schema()

    # 确认是 object 类型
    assert schema["type"] == "object"

    # 确认包含所有必要字段
    assert "properties" in schema
    properties = schema["properties"]

    expected_fields = [
        "id", "name", "cn_name", "lat", "lng",
        "episode", "time_seconds", "screenshot_url", "address"
    ]
    for field in expected_fields:
        assert field in properties, f"Missing field: {field}"

    # 确认没有 additionalProperties
    schema_str = json.dumps(schema)
    assert "additionalProperties" not in schema_str, \
        "Schema should not contain additionalProperties"


def test_points_selection_result_schema():
    """验证 PointsSelectionResult schema 符合 Gemini API 要求"""
    schema = PointsSelectionResult.model_json_schema()

    # 验证 selected_points 字段
    selected_points_schema = schema["properties"]["selected_points"]
    assert selected_points_schema["type"] == "array"

    # 验证 items 是 SelectedPoint 的引用
    items = selected_points_schema["items"]
    # 可能是 $ref 或内联定义
    assert "$ref" in items or items["type"] == "object"

    # 确认整个 schema 不包含 additionalProperties
    schema_str = json.dumps(schema)
    assert "additionalProperties" not in schema_str, \
        "Schema should not contain additionalProperties"

    print("✅ Schema 验证通过")
```

**运行测试**:
```bash
pytest tests/unit/test_schemas.py -v
```

---

### 测试 2: Presentation Agent 输出

**目的**: 验证用户展示文本自然、友好

```python
# tests/integration/test_presentation_agent.py

import pytest
from google.adk.sessions import InMemorySessionService
from adk_agents.seichijunrei_bot._workflows.bangumi_search_workflow import (
    bangumi_search_workflow
)


@pytest.mark.asyncio
async def test_bangumi_search_with_presentation():
    """测试完整的 Stage 1 workflow 包含 presentation"""

    # 创建 session
    session_service = InMemorySessionService()
    session = await session_service.create_session(user_id="test_user")

    # 设置初始 state
    session.state["user_query"] = "我在宇治 想巡礼京吹"

    # 运行 workflow
    async for event in bangumi_search_workflow.run(session):
        if event.author == "UserPresentationAgent":
            # 验证展示文本
            response = event.content

            # 应该包含关键元素
            assert "找到" in response or "相关" in response
            assert "作品" in response
            assert "选择" in response

            # 应该包含数字编号
            assert "1." in response

            # 应该包含选择提示
            assert "回复" in response or "输入" in response

            # 不应该是 JSON
            assert "{" not in response
            assert "bangumi_id" not in response

            print(f"✅ Presentation output:\n{response}")
            return

    pytest.fail("UserPresentationAgent did not produce output")
```

**运行测试**:
```bash
pytest tests/integration/test_presentation_agent.py -v -s
```

---

### 测试 3: State 传递验证

**目的**: 确认 extraction_result.location 在 Stage 2 可访问

```python
# tests/integration/test_state_propagation.py

import pytest
from google.adk.sessions import InMemorySessionService
from adk_agents.seichijunrei_bot._workflows.route_planning_workflow import (
    route_planning_workflow
)


@pytest.mark.asyncio
async def test_state_propagation_to_stage2():
    """测试 extraction_result 从 Stage 1 传递到 Stage 2"""

    # 创建 session，模拟 Stage 1 完成后的 state
    session_service = InMemorySessionService()
    session = await session_service.create_session(user_id="test_user")

    # 设置 Stage 1 的输出
    session.state.update({
        "extraction_result": {
            "bangumi_name": "吹响！上低音号",
            "location": "宇治"
        },
        "bangumi_candidates": {
            "candidates": [
                {
                    "bangumi_id": 115908,
                    "title": "響け！ユーフォニアム",
                    "title_cn": "吹响吧！上低音号",
                    "air_date": "2015-04",
                    "summary": "Test summary"
                }
            ],
            "query": "吹响！上低音号",
            "total": 1
        },
        "user_query": "选择1"
    })

    # 运行 Stage 2 workflow
    events_collected = []
    async for event in route_planning_workflow.run(session):
        events_collected.append(event)

        # 检查 PointsSearchAgent 的事件
        if event.author == "PointsSearchAgent":
            # 验证 state 中仍然有 extraction_result
            assert "extraction_result" in session.state
            assert session.state["extraction_result"]["location"] == "宇治"

            print("✅ extraction_result.location 在 PointsSearchAgent 中可访问")

    # 验证 PointsSelectionAgent 也能访问
    assert any(e.author == "PointsSelectionAgent" for e in events_collected)

    # 检查 points_selection_result 中是否基于 location 做了选择
    if "points_selection_result" in session.state:
        result = session.state["points_selection_result"]
        assert "selection_rationale" in result

        # selection_rationale 应该提到起点位置
        rationale = result["selection_rationale"]
        assert "宇治" in rationale or "距离" in rationale or "集中" in rationale

        print(f"✅ PointsSelectionAgent 基于起点位置选择: {rationale}")
```

**运行测试**:
```bash
pytest tests/integration/test_state_propagation.py -v -s
```

---

### 测试 4: 端到端完整流程

**目的**: 验证用户完整的两轮对话体验

```python
# tests/e2e/test_full_conversation_flow.py

import pytest
from google.adk.sessions import InMemorySessionService
from adk_agents.seichijunrei_bot.agent import root_agent


@pytest.mark.asyncio
async def test_full_two_round_conversation():
    """测试完整的两轮对话流程"""

    session_service = InMemorySessionService()
    session = await session_service.create_session(user_id="test_user")

    # === Round 1: 搜索并展示候选 ===
    session.state["user_query"] = "我在宇治 想巡礼京吹"

    round1_response = None
    async for event in root_agent.run(session):
        if event.author == "UserPresentationAgent":
            round1_response = event.content
            break

    # 验证 Round 1 输出
    assert round1_response is not None, "Round 1 should produce response"
    assert "找到" in round1_response
    assert "吹响" in round1_response or "ユーフォニアム" in round1_response
    assert "选择" in round1_response

    # 验证 state 包含候选列表
    assert "bangumi_candidates" in session.state
    assert len(session.state["bangumi_candidates"]["candidates"]) > 0

    print(f"✅ Round 1 完成:\n{round1_response}\n")

    # === Round 2: 选择并生成路线 ===
    session.state["user_query"] = "选择1"

    round2_completed = False
    async for event in root_agent.run(session):
        if "route_plan" in event.content:
            round2_completed = True
            break

    # 验证 Round 2 完成
    assert round2_completed, "Round 2 should complete route planning"
    assert "selected_bangumi" in session.state
    assert "route_plan" in session.state

    route_plan = session.state["route_plan"]
    assert "recommended_order" in route_plan
    assert len(route_plan["recommended_order"]) > 0

    print(f"✅ Round 2 完成:")
    print(f"  选中作品: {session.state['selected_bangumi']['bangumi_title']}")
    print(f"  路线点位: {len(route_plan['recommended_order'])} 个")
    print(f"  预计时间: {route_plan.get('estimated_duration')}")

    # 验证没有错误
    assert "error" not in session.state

    print("\n✅ 完整流程测试通过")
```

**运行测试**:
```bash
pytest tests/e2e/test_full_conversation_flow.py -v -s
```

---

## 预期改进

### 改进对照表

| 问题 | 修复前 | 修复后 |
|------|--------|--------|
| **additionalProperties 错误** | ❌ `ValueError` 导致 PointsSelectionAgent 失败 | ✅ 正常运行，schema 验证通过 |
| **用户体验** | ⚠️ 需要 2 轮对话才能看到候选列表 | ✅ 1 轮对话直接展示，体验流畅 |
| **展示质量** | ⚠️ 原始 JSON 格式，不友好 | ✅ 自然语言，清晰的选择提示 |
| **State 传递** | ⚠️ 未验证是否可用 | ✅ 日志确认可访问，正常工作 |
| **代码规范** | ⚠️ `output_schema` + `tools` 分离未明确 | ✅ 符合 ADK 官方最佳实践 |

### 用户体验提升

**修复前的对话流程**:
```
[轮次 1]
用户: 我在宇治 想巡礼京吹
Bot: { "candidates": [...], "query": "...", "total": 9 }  ← 原始 JSON

[需要用户额外输入]
用户: [任意输入]

[轮次 2]
Bot: 找到以下动漫作品，请选择...  ← 终于看到展示

用户: 选择1

[轮次 3]
Bot: [路线规划结果]
```
**总轮次**: 3 轮

---

**修复后的对话流程**:
```
[轮次 1]
用户: 我在宇治 想巡礼京吹
Bot: 找到 4 个与「吹响！上低音号」相关的动漫作品，请选择一个：

1. **吹响吧！上低音号** (響け！ユーフォニアム, 2015年4月)
   京都府立北宇治高中吹奏乐部的青春故事。

2. ...

请回复数字（如「1」）来选择第一个作品。  ← 直接友好展示

用户: 选择1

[轮次 2]
Bot: [路线规划结果]
```
**总轮次**: 2 轮 ✅ **减少 1 轮交互**

---

### 技术质量提升

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| **Schema 合规性** | ❌ 不符合 Gemini API 要求 | ✅ 完全符合 |
| **ADK 最佳实践** | ⚠️ 部分符合 | ✅ 完全符合官方文档 |
| **可观测性** | ⚠️ 缺少 state 验证日志 | ✅ 完整日志覆盖 |
| **代码可维护性** | ⚠️ 隐式依赖，难以调试 | ✅ 显式 state injection，易于追踪 |
| **用户体验** | ⚠️ 需要额外轮次 | ✅ 流畅自然 |

---

## 参考资料

### ADK 官方文档

1. **LLM Agents**
   https://google.github.io/adk-docs/agents/llm-agents/
   - output_schema 约束说明
   - tools 使用限制

2. **Sequential Agents**
   https://google.github.io/adk-docs/agents/workflow-agents/sequential-agents/
   - SequentialAgent 数据传递机制
   - Output Key 模式

3. **State Management**
   https://google.github.io/adk-docs/sessions/state/
   - State 前缀和生命周期
   - State Injection 语法
   - 跨 agent 共享机制

4. **Session Management**
   https://google.github.io/adk-docs/sessions/session/
   - DatabaseSessionService 配置
   - 持久化最佳实践

### Gemini API 文档

5. **Structured Outputs**
   https://ai.google.dev/gemini-api/docs/structured-output
   - JSON Schema 支持特性
   - Schema 限制说明

### GitHub Issues

6. **additionalProperties 不支持**
   https://github.com/googleapis/python-genai/issues/70
   https://github.com/googleapis/python-genai/issues/1113
   - 问题讨论和官方回应
   - 社区解决方案

7. **Dict 类型使用建议**
   https://stackoverflow.com/questions/79225718
   - 官方推荐的 KeyValuePair 模式

### 本地文档

8. **Capstone Implementation Plan**
   `docs/capstone_implementation_plan.md`
   - 整体架构设计
   - PointsSelectionAgent 设计理念

9. **ADK Migration Spec**
   `docs/adk_migration_spec.md`
   - Session State Schema 定义
   - Agent 读写矩阵

---

## 附录: 完整修改清单

### 新增文件

1. `adk_agents/seichijunrei_bot/_agents/user_presentation_agent.py`
   - UserPresentationAgent 完整实现

### 修改文件

2. `adk_agents/seichijunrei_bot/_schemas.py`
   - 新增 `SelectedPoint` class
   - 更新 `PointsSelectionResult.selected_points` 类型

3. `adk_agents/seichijunrei_bot/_workflows/bangumi_search_workflow.py`
   - 添加 `user_presentation_agent` import
   - 在 `sub_agents` 列表中添加 `user_presentation_agent`

4. `adk_agents/seichijunrei_bot/_agents/points_selection_agent.py`
   - 更新 instruction，显式引用 `{extraction_result.location}`

5. `adk_agents/seichijunrei_bot/_agents/points_search_agent.py`
   - 在 `_run_async_impl` 开头添加 state 验证日志

### 测试文件 (新增)

6. `tests/unit/test_schemas.py`
   - Schema 验证测试

7. `tests/integration/test_presentation_agent.py`
   - Presentation Agent 输出测试

8. `tests/integration/test_state_propagation.py`
   - State 传递验证测试

9. `tests/e2e/test_full_conversation_flow.py`
   - 端到端完整流程测试

---

**文档版本**: v1.0
**创建日期**: 2025-11-29
**最后更新**: 2025-11-29
**作者**: Development Team
**状态**: ✅ Ready for Implementation

---

*This fix plan is based entirely on official ADK documentation and Gemini API specifications, ensuring compliance with Google's best practices and avoiding implementation-specific workarounds.*
