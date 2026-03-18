# Task Plan: Seichijunrei-Agent 全面重构

## Goal
去掉 Google ADK 依赖，迁移到 Pydantic AI + Supabase + Cloudflare 架构，引入 Plan-and-Execute 多 Agent 协作 + Agentic RAG + Generative UI，同时保留现有 A2A/A2UI 前端。

## Current Phase
Phase 1 — 数据爬取 + Evaluation 基线（ITER-0）

## Streams

| Stream | 职责 |
|--------|------|
| **S1: Data** | 数据爬取、Supabase、Agentic RAG |
| **S2: Agent** | Pydantic AI 框架、Plan-and-Execute |
| **S3: Interface** | A2A/A2UI、Generative UI |
| **S4: Platform** | CF 部署、可观测性、CI/CD、Code Sandbox |

## Phases

### Phase 1: ITER-0 — 数据爬取 + Evaluation 基线（前置）
- [ ] STORY 0.1: Anitabi 种子数据爬取（5-10 部常用动漫）
- [ ] STORY 0.2: Bangumi 元数据 + Supabase 建表 + embedding 生成
- [ ] STORY 0.3: Evaluation 框架（30+ test cases + 基线运行）
- **Status:** pending

### Phase 2: ITER-1 — 数据层 + Agent 骨架（S1+S2 并行）
- [ ] STORY 1.1: Supabase Python 客户端（asyncpg + pgvector + PostGIS）
- [ ] STORY 1.2: IntentAgent（regex + LLM + model-agnostic）
- [ ] STORY 1.3: PlannerAgent + ExecutorAgent（Plan-and-Execute 核心）
- **Status:** pending

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

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| (none yet) | | |

## Notes
- 完整技术方案见 `findings.md`（HLD、Schema、API I/O、数据流）
- Session 进度见 `progress.md`
- 详细故事卡含 AC + Test Cases 见 findings.md 下半部分
- 费用：开发 $0/月，生产 $30/月（CF $5 + Supabase $25）
