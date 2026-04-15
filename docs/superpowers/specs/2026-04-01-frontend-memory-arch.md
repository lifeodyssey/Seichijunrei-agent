# Seichijunrei — Frontend & Memory Architecture Spec

**日期:** 2026-04-01
**状态:** LANDED（以 `docs/ARCHITECTURE.md` 与代码为准）
**关联:** `2026-04-01-memory-compact-design.md`（保留，本文件扩展并取优先）

> **更新说明（2026-04-03）：** 本 spec 里关于 context_block、route origin、SSE step trace、user_memory、compact 等核心能力已经落地；个别 UI/数据字段可能按实现做了调整。阅读时请以代码为准。

---

## Problem Inventory

| ID | 问题 | 来源 |
|----|------|------|
| P1 | Planner 完全无状态，每轮只收到当前消息 | 代码审查 |
| P2 | `plan_route` 无出发地，路线起点随机取 `rows[0]` | 代码审查 + 用户反馈 |
| P3 | `ThinkingBar` 只是动画，用户看不到执行步骤 | 用户反馈 |
| P4 | 侧边栏历史是 React state，刷新即丢 | 代码审查 |
| P5 | DB-first 无刷新机制，景点数据永久过时 | 代码审查 |
| P6 | 侧边栏显示路线记录而非对话历史 | 用户反馈 |

---

## Architecture Decisions

### Memory: 结构化状态注入（方案 A）

**不用多轮 API 模式（方案 C 已排除）：**
Planner 是 structured-output oracle，不是对话伙伴。多轮模式下 LLM 的 message history 会是 `ExecutionPlan` JSON——对理解用户意图无用。且 ExecutorAgent 的执行结果在 `PipelineResult` 里，planner 天然看不到。

**不用 RAG / pgvector：**
巡礼场景的状态天然结构化（当前动漫、最近地点、已访问 ID），向量检索是过度设计。

**做法：** 从 session state 提炼精选 `context_block`，以固定格式前缀注入 planner prompt。

### Step Visibility: 直接 SSE（跳过 Layer A 过渡）

不做"事后展示"的过渡方案，直接实现 SSE 实时流式推送。aiohttp 原生支持 SSE；前端用 `fetch` + `ReadableStream`（比 `EventSource` 灵活，可带 Authorization header）。

### Sidebar: 对话历史（LLM 生成标题 + 用户可改名）

**不用路线历史：** 一次对话可能产生多条路线，路线维度割裂了上下文。用户想做的是"继续上次的巡礼计划"，对话是更自然的组织维度。

**标题生成：** 第一次响应返回后，后台异步触发 LLM 生成简短标题（≤15字）。失败时 fallback 到截断第一条用户消息。标题存入 `conversations` 表，用户点击可改名。

---

## Feature Designs

### F1: Memory Pipeline（解决 P1）

#### Session state 扩展

`interactions` 条目新增 `context_delta`（由 `public_api.py` 从 `PipelineResult` 提取后写入）：

```python
{
    "text": str,
    "intent": str,
    "status": str,
    "success": bool,
    "created_at": str,
    "context_delta": {                 # NEW
        "bangumi_id": str | None,      # resolve_anime / search_bangumi 结果
        "anime_title": str | None,
        "location": str | None,        # search_nearby 使用的 location
    }
}
```

`context_delta` 提取规则（`public_api.py` 中实现 `_extract_context_delta`）：

- `resolve_anime` step 成功 → 取 `step.data["bangumi_id"]` 和 `step.data["title"]`
- `search_bangumi` step 成功且无 resolve step → 取 `step.data.get("bangumi_id")`
- `search_nearby` step → 取 `step.params["location"]`

#### context_block 格式

```
[context]
anime: 響け！ユーフォニアム (bangumi_id: 253)
last_location: 宇治
last_intent: search_bangumi
visited_ids: 253, 105
```

`_build_context_block(session_state)` 反向扫描最近 N 条 interactions 取最近非空值。

#### Planner prompt 注入

```python
# agents/planner_agent.py
async def create_plan(self, text: str, locale: str = "ja", context: dict | None = None) -> ExecutionPlan:
    context_prefix = _format_context_block(context) + "\n" if context else ""
    prompt = f"{context_prefix}[locale={locale}] {text}"
    result = await self._agent.run(prompt)
    return result.output
```

#### 跨会话 user_memory（Iter 2）

```sql
CREATE TABLE user_memory (
    user_id        text PRIMARY KEY,
    visited_anime  jsonb DEFAULT '[]',  -- [{bangumi_id, title, last_at}]
    visited_points jsonb DEFAULT '[]',  -- [{point_id, name, visited_at}]
    updated_at     timestamptz DEFAULT now()
);
```

每次响应后 upsert，`_build_context_block` 在 Iter 2 后合并 session + user_memory。

#### LLM compact（Iter 3，异步）

触发条件：`len(interactions) >= 8`，响应返回后后台 asyncio.create_task。
摘要写入 `session["summary"]`，下轮 context_block 第一行注入。

---

### F2: Route Planning Origin（解决 P2）

**根本原因：**
```python
# executor_agent.py — 现在
def _nearest_neighbor_sort(rows):
    ordered = [with_coords[0]]  # 任意起点
```
Planner system prompt 里 `plan_route(params: {})` 无 origin 参数，整条链路没有出发地概念。

**改动：**

1. Planner system prompt 新增 origin 说明：
```
- plan_route(origin: str | None)
  Sort results into an optimal walking route starting from origin.
  Infer origin from context last_location if user hasn't specified one.
  If no origin available, leave null.
```

2. `_execute_plan_route` 提取 origin 并传入排序：
```python
origin_str = step.params.get("origin") or context.get("last_location")
ordered = await _nearest_neighbor_sort(rows, origin=origin_str)
```

3. `_nearest_neighbor_sort` 改为 async，接受 origin：
```python
async def _nearest_neighbor_sort(rows: list[dict], origin: str | None = None) -> list[dict]:
    start_coords = None
    if origin:
        start_coords = await resolve_location(origin)  # 复用 agents/sql_agent.py
    if start_coords:
        # 以 start_coords 为虚拟起始节点插入 nearest-neighbor 算法
        ...
    else:
        # 现有行为：取 with_coords[0]
```

**出发地不明时的交互（Clarification）：**
Planner 识别到 `plan_route` 且 context 里无 location 时，可在 plan_route 前插入
`answer_question(answer="请问您从哪里出发？")` — 前端已有 Clarification 组件处理。
下一轮用户回复后，planner 带着 context 里的 `last_location` 重新规划。

---

### F3: SSE Pipeline Step Visibility（解决 P3）

**后端：新 SSE 端点**

`GET /v1/runtime` 保持现有行为（向后兼容）。
新增 `POST /v1/runtime/stream`，返回 `text/event-stream`：

```
event: step
data: {"tool": "resolve_anime", "status": "running"}

event: step
data: {"tool": "resolve_anime", "status": "done", "result": {"bangumi_id": "253"}}

event: step
data: {"tool": "search_bangumi", "status": "running"}

event: step
data: {"tool": "search_bangumi", "status": "done", "result": {"row_count": 20}}

event: done
data: {<完整 PublicAPIResponse JSON>}
```

**ExecutorAgent progress callback：**
```python
class ExecutorAgent:
    async def execute(
        self,
        plan: ExecutionPlan,
        on_step: Callable[[str, str, dict], Awaitable[None]] | None = None,
    ) -> PipelineResult:
        ...
        if on_step:
            await on_step(step.tool.value, "running", {})
        result = await handler(step, context)
        if on_step:
            await on_step(step.tool.value, "done", result.data or {})
```

**前端：SSE client**

```typescript
// frontend/lib/api.ts
export async function sendMessageStream(
  text: string,
  sessionId: string | null,
  locale: string,
  onStep: (tool: string, status: string) => void,
): Promise<RuntimeResponse> {
  const res = await fetch("/v1/runtime/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await getAccessToken()}`,
    },
    body: JSON.stringify({ text, session_id: sessionId, locale }),
  });
  const reader = res.body!.getReader();
  // parse SSE events, call onStep for each step event
  // resolve with final "done" event payload
}
```

**前端：StepTrace 组件（替换 ThinkingBar）**

```tsx
function StepTrace({ steps }: { steps: { tool: string; status: "running" | "done" }[] }) {
  return (
    <div className="flex flex-col gap-1">
      {steps.map(s => (
        <span key={s.tool} className="text-[10px] text-[var(--color-muted-fg)]">
          {s.status === "done" ? "✓" : "●"} {STEP_LABELS[s.tool]}
        </span>
      ))}
    </div>
  );
}

const STEP_LABELS: Record<string, string> = {
  resolve_anime: "动漫识别中",
  search_bangumi: "搜索取景地",
  search_nearby: "搜索附近景点",
  plan_route: "规划路线",
  answer_question: "生成回答",
};
```

---

### F4: Sidebar 对话历史（解决 P4 + P6）

**conversations 表：**
```sql
CREATE TABLE conversations (
    session_id   text PRIMARY KEY,
    user_id      text NOT NULL,
    title        text,                    -- LLM 生成或用户手动修改
    first_query  text NOT NULL,           -- 用于 fallback
    created_at   timestamptz DEFAULT now(),
    updated_at   timestamptz DEFAULT now()
);
```

**LLM 标题生成（异步，首次响应后触发）：**
```python
async def _generate_conversation_title(first_query: str, response_message: str) -> str:
    """Use LLM to generate a short conversation title (≤15 chars)."""
    # Single-turn call with a cheap model
    # Fallback: first_query[:20] + "..."
```

**前端 useConversationHistory hook：**
```typescript
// frontend/hooks/useConversationHistory.ts
export function useConversationHistory(userId: string | null) {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  useEffect(() => {
    if (!userId) return;
    fetchConversations(userId).then(setConversations);
  }, [userId]);
  const upsert = (record: ConversationRecord) => ...;
  const rename = (sessionId: string, title: string) => ...;
  return { conversations, upsert, rename };
}
```

**Sidebar 改动：**

- 显示 `conversations` 列表（title + created_at）
- 点击标题可 inline 编辑（blur 触发 PATCH `/v1/conversations/:id`）
- 移除现有 `routeHistory` props

---

### F5: Data Freshness（解决 P5）

```python
# agents/models.py
class RetrievalRequest(BaseModel):
    ...
    force_refresh: bool = False   # NEW
```

```python
# agents/retriever.py — _execute_sql_with_fallback
if sql_result.row_count > 0 and not request.force_refresh:
    return sql_result, metadata  # 有数据且不强制刷新才短路
```

触发方式：Planner 识别到"刷新XX数据"意图时，在 `search_bangumi` 的 `params` 加 `force_refresh: true`。

---

## Iteration Roadmap

### Iter 1 — 核心 UX（P1 会话上下文 + P2 路线出发地 + P3 SSE）

**Feature 清单（feature-dev 拆分）：**

| Feature | 描述 | 文件 |
|---------|------|------|
| F1a | context_delta schema + `_build_context_block` + planner 注入 | `agents/models.py`, `interfaces/public_api.py`, `agents/planner_agent.py`, `agents/pipeline.py` |
| F1b | plan_route origin + async `_nearest_neighbor_sort` | `agents/executor_agent.py`, planner system prompt |
| F1c | SSE 端点 + ExecutorAgent progress callback | `interfaces/http_service.py`, `agents/executor_agent.py` |
| F1d | 前端 SSE client + StepTrace 组件 | `frontend/lib/api.ts`, `frontend/hooks/useChat.ts`, `frontend/components/chat/MessageBubble.tsx`, `frontend/lib/types.ts` |

### Iter 2 — 持久化（P4 侧边栏 + P1 跨会话 + P5 数据刷新）

| Feature | 描述 | 文件 |
|---------|------|------|
| F2a | conversations 表 + LLM 标题生成 + 改名 API | migration, `infrastructure/supabase/client.py`, `interfaces/http_service.py` |
| F2b | user_memory 表 + 跨会话 context_block | migration, `infrastructure/supabase/client.py`, `interfaces/public_api.py` |
| F2c | sidebar 对话历史 UI | `frontend/hooks/useConversationHistory.ts`, `frontend/lib/api.ts`, `frontend/components/layout/Sidebar.tsx`, `frontend/components/layout/AppShell.tsx` |
| F2d | force_refresh | `agents/models.py`, `agents/retriever.py`, planner system prompt |

### Iter 3 — 进阶（按需）

| Feature | 描述 |
|---------|------|
| F3a | 选点 UI（搜索→展示→多选→出发地→路线） |
| F3b | LLM compact（异步，会话结束触发，写入 session["summary"]） |

---

## 不变的文件

- `infrastructure/session/` — in-memory 不动
- `infrastructure/gateways/` — 不动
- `frontend/components/generative/` — 不动（注册新组件除外）
- `agents/sql_agent.py` — 只复用 `resolve_location()`，不改动
- `agents/retriever.py` — Iter 1 不动（Iter 2 加 force_refresh）

---

## Acceptance Criteria（顶层）

**Iter 1 完成标准：**

- [ ] 用户说"再找几个那附近的景点"，planner 能理解"那附近"指上轮 location
- [ ] 规划路线时，系统自动以 context 里的 last_location 作为出发地
- [ ] 前端发送请求后，聊天区域实时显示每个执行步骤（SSE）
- [ ] `make test` 全绿

**Iter 2 完成标准：**

- [ ] 刷新页面后侧边栏仍然显示历史对话列表
- [ ] 首次对话后，侧边栏标题由 LLM 自动生成
- [ ] 用户可以点击标题修改
- [ ] 用户下次回来，context_block 包含跨会话访问过的动漫信息
