# Task Plan: Seichijunrei-Agent 全面重构

## Goal
去掉 Google ADK 依赖，迁移到 Pydantic AI + Supabase + Cloudflare 架构，引入 Plan-and-Execute 多 Agent 协作 + Agentic RAG + Generative UI，同时保留现有 A2A/A2UI 前端。

## Current Phase
Phase 2 — 数据层 + Agent 骨架（ITER-1）

## Streams

| Stream | 职责 |
|--------|------|
| **S1: Data** | 数据爬取、Supabase、Agentic RAG |
| **S2: Agent** | Pydantic AI 框架、Plan-and-Execute |
| **S3: Interface** | A2A/A2UI、Generative UI |
| **S4: Platform** | CF 部署、可观测性、CI/CD、Code Sandbox |

## Phases

### Phase 1: ITER-0 — 数据爬取 + Evaluation 基线（前置）
- [x] STORY 0.1: Anitabi 种子数据爬取 → 17 部动漫 + 2851 巡礼点
- [x] STORY 0.2: Bangumi 元数据 + Supabase 建表（embedding 降为 P2，见 Decisions）
- [x] STORY 0.3: Evaluation 框架 → 55-case pydantic_evals，可插拔模型
- **Status:** done ✅

### Phase 2: ITER-1 — 数据层 + Agent 骨架（S1+S2 并行）
- [x] STORY 1.1: Supabase Python 客户端（asyncpg + pgvector + PostGIS）
- [x] STORY 1.2: IntentAgent（regex fast-path + LLM fallback, model-agnostic）
- [x] STORY 1.2.1: Text-to-SQL Agent（参数化 PostGIS 查询）
- [ ] STORY 1.3: PlannerAgent + ExecutorAgent（Plan-and-Execute 核心）
- **Status:** in_progress

### Phase 3: ITER-2 — Agent 完整链路 + Agentic RAG（S2+S1）
- [ ] STORY 2.1: 8 个 Step Agents（Stage 1 搜索 + Stage 2 路线）
- [ ] STORY 2.2: Agentic RAG Retriever（4 种策略 + DB miss fallback）
- **Status:** pending

### Phase 4: ITER-3 — 接口联调 + Generative UI（S3）
- [ ] STORY 3.1: A2A Server 接入新 Runtime
- [ ] STORY 3.2: Generative UI Widget（show_widget + morphdom）
- **Status:** pending

### Phase 5: ITER-4 — Cloudflare 部署 + 可观测性（S4）
- [ ] STORY 4.1: Cloudflare Workers/Containers 部署
- [ ] STORY 4.2: OpenTelemetry 全链路追踪（model-agnostic）
- **Status:** pending

### Phase 6: ITER-5 — 清理 + Code Sandbox + 验收（ALL）
- [ ] STORY 5.1: ADK 依赖移除 + Code Sandbox
- [ ] STORY 5.2: 端到端验收（指标 ≥ 基线）
- **Status:** pending

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| Pydantic AI 替代 ADK | 轻量、类型安全、原生 Gemini/OpenAI/Anthropic 支持、与现有 Pydantic 生态契合 |
| Supabase 作为唯一数据库 | 一站式：pgvector + PostGIS + 关系数据 + session。数据一致性最重要 |
| CF Workers 做 compute | 边缘计算、$5/月。不兼容则 fallback 到 CF Containers |
| CF R2 做文件存储 | 截图存储，零出口费 |
| OTel 为可观测性基础 | 不绑定 LLM provider，UI 层可插拔（Phoenix/Grafana/Langfuse）|
| BGE-M3 做 embedding | 中日英三语最强，1024 维 |
| 只抓 5-10 部种子动漫 | 开发验证够用，miss 时走 API fallback + write-through cache |
| Agentic RAG（不是传统 RAG） | Agent 动态决定检索策略（SQL/语义/地理/混合）|
| pi-generative-ui 模式 | show_widget tool + morphdom DOM diffing，Agent 动态生成交互式地图/图表 |
| E2B 或 CF Sandboxes 做 Code Sandbox | 安全执行 Agent 生成的代码 |
| Model-agnostic LLM | 通过 config 切换 Gemini/OpenAI/Anthropic/Ollama |
| Text-to-SQL 为主力检索 | `scene_desc` 存的是时间戳（秒）不是语义描述，数据高度结构化，embedding 降为 P2 |
| pydantic-ai v1.69 API | `result_type` → `output_type`，`.data` → `.output`（breaking change） |
| Gemini 3.1 flash-lite 需 `-preview` | `gemini-3.1-flash-lite` 未 GA，必须用 `gemini-3.1-flash-lite-preview` |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| pydantic-ai `Unknown keyword arguments: result_type` | 用了旧 API | 改为 `output_type`，`.data` → `.output` |
| LM Studio 502 (并发>1) | `max_concurrency=3` | 降为 `max_concurrency=1` |
| `gemini-2.0-flash-lite` 404 | 模型已下线 | 用 `gemini-3.1-flash-lite-preview` |
| `gemini-3.1-flash-lite` 404 | 模型未 GA | 加 `-preview` 后缀 |

## Eval 发现的问题（待修复）

### Regex 优先级问题（3 case）
`route_llm_02/03/04` — 用户说"想走一遍/安排路线"，regex 匹配到 bangumi 标题后直接返回 `search_by_bangumi`，路线意图被吞掉。
- **根因**: bangumi 匹配优先级 > route 检测
- **修复**: 在 `classify_intent_regex()` 中扩展路线关键词检测（"走一遍"、"安排路线"、"プラン"）

### LLM 分类边界模糊（3 case）
`bangumi_llm_01/02/03` — "新海诚电影里出现过的地方" 被 LLM 分为 `search_by_location`。
- **根因**: 无明确动漫标题，LLM 倾向按地点搜索
- **修复**: 优化 system prompt few-shot examples，或调整 expected_output（`search_by_location` 也合理）

### 语义级 episode 提取（1 case）
`episode_llm_01` — "有一集在大吉山展望台" 被分为 `general_qa`。
- **根因**: episode 信息在语义层面，不是"第N集"格式
- **修复**: 调整 expected_output 为 `general_qa`（用户确实在问问题）

### Eval Baseline

| 模型 | Intent | Params | 延迟 | 稳定性 |
|------|--------|--------|------|--------|
| qwen3.5-9b (本地) | 87.3% | 96.4% | ~2s/case | 并发>1 时 502 |
| gemini-3.1-flash-lite-preview | 89.1% | 96.4% | ~400ms/case | 稳定 |

两个模型失败的 case 几乎一样 → 问题在 regex 优先级和 test case 设计，不在模型能力。

## Notes
- 完整技术方案见 `findings.md`（HLD、Schema、API I/O、数据流）
- Session 进度见 `progress.md`
- 详细故事卡含 AC + Test Cases 见 findings.md 下半部分
- 费用：开发 $0/月，生产 $30/月（CF $5 + Supabase $25）
- Eval 可通过 `/eval-model` skill 运行
