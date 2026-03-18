# Progress Log

## Session: 2026-03-18 — 全面重构规划

### 完成的工作
- [x] 代码库全面探索（50+ 文件，ADK 依赖分析）
- [x] 10 个 Agent 框架对比研究 → 选定 Pydantic AI
- [x] 5 个向量数据库对比研究 → 选定 Supabase pgvector
- [x] 5 个可观测性方案对比 → 选定 OTel 为底 + UI 可插拔
- [x] Supabase vs Cloudflare 平台对比 + 费用分析
- [x] RAG vs Agentic RAG 分析 → 选定 Agentic RAG
- [x] pi-generative-ui 研究 → 融入 A2UI 的 Generative UI 方案
- [x] Code Sandbox 5 方案对比（E2B/Daytona/CF/Modal/Docker）
- [x] 完整 HLD 设计（系统上下文图 + 数据流）
- [x] Database Schema 设计（4 表 + 索引）
- [x] API I/O 定义（A2A JSON-RPC + Agent 内部 API + RAG API）
- [x] 数据存储策略（单一 Supabase + R2 截图）
- [x] DB Miss Fallback 策略（write-through cache）
- [x] 迁移策略（KEEP/REWRITE/DELETE/NEW）
- [x] Feature-Dev 迭代拆分（6 Iterations, 17 Stories, 60+ TCs）
- [x] 故事卡 AC + Test Cases 编写
- [x] 写入 task_plan.md + findings.md + progress.md

### V2 基础设施搭建（2026-03-18）
- [x] 清理 ralph loop（iteration 221 → 停止）
- [x] 添加 v2 依赖（pydantic-ai, supabase, asyncpg, pgvector, fastembed）
- [x] 创建 Supabase DDL 迁移脚本（5 个 SQL: extensions, bangumi, points, sessions/routes, indexes）
- [x] 创建 Supabase 异步客户端骨架（infrastructure/supabase/client.py）
- [x] 创建 Pydantic AI Agent 骨架（agents/base.py, agents/intent_agent.py）

### 关键决策
| 决策 | 时间 |
|------|------|
| 框架: Pydantic AI | 用户确认 |
| 数据库: Supabase pgvector (唯一) | 用户确认 |
| 部署: CF Workers + Supabase | 用户确认 |
| LLM: Model-agnostic | 用户确认 |
| 可观测性: OTel 为底 | 用户确认 |
| RAG: Agentic RAG | 用户确认 |
| 数据: 只抓 5-10 部种子 | 用户要求 |
| Fallback: write-through cache | 用户确认 |

### 下一步
- 开始 ITER-0: 数据爬取 + Evaluation 基线
  - STORY 0.1: Anitabi 种子数据爬取
  - STORY 0.2: Bangumi 元数据 + Supabase 建表 + embedding 生成
  - STORY 0.3: Evaluation 框架

### 费用
- 开发: $0/月 (Free tiers)
- 生产: $30/月 (CF $5 + Supabase $25)
