# Memory & Compact 设计文档

**日期:** 2026-04-01
**状态:** LANDED（以代码为准）

> **更新说明（2026-04-03）：** compact（会话摘要）与 context 注入已在 `interfaces/public_api.py` 等处实现；本文件作为设计推导保留，细节以实现为准。

---

## 背景与问题

当前 planner 是**完全无状态**的——每次调用只收到当前用户消息和 locale，对本次对话的历史一无所知：

```python
# agents/planner_agent.py
async def create_plan(self, text: str, locale: str = "ja") -> ExecutionPlan:
    prompt = f"[locale={locale}] {text}"
    result = await self._agent.run(prompt)  # 无 message history
    return result.output
```

Session state（`interfaces/public_api.py`）虽然记录了交互历史，但从未注入 LLM。这导致：

- 用户说"再找几个那附近的景点"，planner 不知道"那附近"指哪里
- 用户跨会话回来，系统不记得他上次巡礼了什么动漫
- 无法做个性化推荐

---

## 为什么不用 LLM API 内置 compact（方案 C 被排除的原因）

多轮 API 模式（Pydantic AI `message_history` 参数）在语义上与本项目的架构错位：

| 维度 | 多轮对话模式 | 本项目 planner |
|------|------------|--------------|
| LLM 角色 | 对话伙伴 | 规划预言机（structured output） |
| 历史内容 | 自然语言来回 | `ExecutionPlan` JSON（对理解意图无用） |
| 需要的上下文 | 完整对话回放 | 精选世界状态（当前动漫、地点、路线） |
| 执行结果可见性 | 在 history 里 | 在 ExecutorAgent 里，planner 天然看不到 |

结论：planner 需要的是**世界状态摘要**，不是对话回放。

---

## 三方案对比

### 方案 A：结构化状态注入（推荐）

从 session state 提炼 `context_block`，注入 planner prompt 前缀：

```
[context]
current_anime: 轻音少归
last_location: 宇治
last_intent: search_bangumi
visited_bangumi_ids: [105, 372]
```

**优点：**

- 无额外 LLM 调用，确定性，零延迟增加
- context 大小可控（固定结构），永远不会撑爆 prompt
- 跨会话只需把 `user_memory` 持久化到 Supabase

**缺点：**

- 需要维护提炼规则（哪些字段有用）
- 自由文本的细节（"用户提到想避开太远的地方"）丢失

---

### 方案 B：滑动窗口原文 + 阈值 compact

把最近 N 轮原始用户消息拼入 prompt；超出 token 阈值时 LLM 压缩旧轮次为摘要。

**优点：**

- 保真度高，能捕捉自由文本里的细节
- compact 逻辑与 Claude Code 自身行为一致，符合直觉

**缺点：**

- compact 触发时需同步 LLM 调用，增加单次响应延迟
- 需要 token 计数逻辑（tokenizer 依赖）
- compact 结果质量依赖模型，不确定性更高

---

### 方案 C：多轮 API 模式（已排除）

见上节分析。架构语义错位，不适合 structured-output planner。

---

## 推荐迭代路线图（方案 A 为基础）

### Iter 1：会话内结构化上下文注入

**目标：** 解决同一会话内的指代问题（"那附近"、"同一部动漫"）。

**变更范围：**

- `interfaces/public_api.py` — `run_pipeline` 新增 `context` 参数
- `agents/pipeline.py` — 把 `context_block` 传入 planner
- `agents/planner_agent.py` — `create_plan(text, locale, context=None)` 在 prompt 前缀注入 context
- `interfaces/public_api.py` — `_build_context_block(session_state)` 提炼逻辑

`context_block` 字段：

```python
{
    "current_bangumi_id": str | None,   # 本会话最近一次 resolve_anime 的结果
    "last_location": str | None,         # 最近一次 search_nearby 的 location
    "last_intent": str | None,           # 上一轮 intent（已在 session state）
    "visited_bangumi_ids": list[str],    # 本会话所有已解析的 bangumi_id
}
```

**session state 小幅扩展（Iter 1 需要）：**

现有 `interactions` 记录 `intent` 和 `status`，但不记执行结果。`current_bangumi_id` 只在
`route_history` 里出现（有路线才有）；纯 `search_bangumi` 不存 `bangumi_id`。

因此 Iter 1 需要在 `interactions` 记录里补充一个 `context_delta` 字段，由 ExecutorAgent 的结果填充：

```python
# interactions 条目新增字段
{
    "text": str,
    "intent": str,
    "status": str,
    "success": bool,
    "created_at": str,
    "context_delta": {               # 新增，可为空
        "bangumi_id": str | None,    # resolve_anime / search_bangumi 结果
        "location": str | None,      # search_nearby 使用的 location
    }
}
```

`_build_context_block` 从最新 N 条 interactions 里反向扫描，取最近的非空值。

**不做：** 跨会话、LLM compact、新表（除 interactions 字段扩展外）。

---

### Iter 2：跨会话 user_memory 持久化 + 侧边栏历史持久化

**目标：** 用户下次回来，系统记得他巡礼过的动漫和地点；侧边栏历史刷新不丢。

#### 2a — 后端：user_memory 表

**变更范围：**

- Supabase 新表 `user_memory`：
  ```sql
  user_id        text  PK
  visited_anime  jsonb   -- [{bangumi_id, title, last_visited_at}]
  visited_points jsonb   -- [{point_id, name, visited_at}]
  preferences    jsonb   -- 未来扩展：偏好标签等
  updated_at     timestamptz
  ```

- `interfaces/public_api.py` — 每次响应后 upsert `user_memory`（本轮新出现的动漫/地点）
- `_build_context_block` — 合并 session state + `user_memory`（跨会话部分）

#### 2b — 前端：侧边栏历史持久化

**现状问题：**

侧边栏的 `routeHistory` 来自 React state（`useChat` 里的 `messages`），刷新即清空：

```typescript
// AppShell.tsx — 当前实现
const routeHistory = [...messages]
  .reverse()
  .find((m) => m.response?.route_history?.length)
  ?.response?.route_history ?? []
```

且它只显示"最近一次路线规划的结果"，不是真正的历史列表。

**目标实现：**

页面加载时从 Supabase `routes` 表按 `user_id` 拉取历史，存入独立 state；每次新路线完成后追加：

```typescript
// 新增 hooks/useRouteHistory.ts
function useRouteHistory(userId: string | null) {
  const [history, setHistory] = useState<RouteHistoryRecord[]>([]);

  useEffect(() => {
    if (!userId) return;
    // 从 Supabase routes 表拉取，按 created_at DESC 排序
    fetchRouteHistory(userId).then(setHistory);
  }, [userId]);

  const append = (record: RouteHistoryRecord) =>
    setHistory((prev) => [record, ...prev]);

  return { history, append };
}
```

**变更范围：**

- `frontend/hooks/useRouteHistory.ts` — 新 hook，封装 Supabase 查询
- `frontend/lib/api.ts` — `fetchRouteHistory(userId)` 查询 `routes` 表
- `frontend/components/layout/AppShell.tsx` — 用 `useRouteHistory` 替换当前 `useMemo` 推导
- 后端 `routes` 表需已有数据（`save_route` 已实现，无需改动）

**不做：** LLM 提炼、compact。

---

### Iter 3：LLM 提炼 + 会话内 compact（按需）

**目标：** 长会话（> 10 轮）历史压缩；user_memory 的语义提炼（从原始日志里提取偏好）。

**两个子任务：**

**3a — 会话内 compact**

触发条件：`len(session["interactions"]) >= COMPACT_THRESHOLD`（建议 8）

时机：**会话结束后异步触发**（不在请求链路内），避免增加延迟：
```
用户请求 → pipeline → 返回响应
                    ↓ (background)
              compact_interactions(session_id)
              → LLM 摘要旧轮次
              → 写回 session["summary"] 字段
```
下次会话开始时，把 `summary` 作为 context_block 的一部分注入。

**3b — user_memory 语义提炼**

定期（或每 N 次会话后）用 LLM 从 `request_log` 里提炼用户偏好，upsert 到 `user_memory.preferences`。
这是可选增强，不是核心路径。

---

## 架构图（最终态）

```
用户消息
    │
    ▼
_build_context_block(session_state, user_memory)
    │  current_anime, last_location,
    │  visited_ids, [session_summary]
    ▼
ReActPlannerAgent.create_plan(text, locale, context)
    │  prompt = [context]\n[locale] {text}
    ▼
ExecutionPlan
    │
    ▼
ExecutorAgent.execute(plan)
    │
    ▼
PipelineResult
    │
    ├─→ upsert session state
    └─→ (async, Iter 3) compact / upsert user_memory
```

---

## 不做的事

- **向量检索 / pgvector**：对结构化巡礼场景过度设计
- **多轮 API 模式**：见方案 C 排除原因
- **实时 user_memory 推理**：Iter 3b 是可选的，不是门控条件
