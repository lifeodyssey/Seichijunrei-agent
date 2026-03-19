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

## Session: 2026-03-19 — IntentAgent + SQLAgent + Eval 框架

### 完成的工作
- [x] IntentAgent 实现：regex fast-path（17 bangumi title map, CJK 正则）+ pydantic-ai LLM fallback
- [x] SQLAgent 实现：参数化 PostGIS 查询（bangumi/location/route 三种 intent）
- [x] 修复 pydantic-ai v1.69 breaking change：`result_type` → `output_type`，`.data` → `.output`
- [x] 55-case pydantic_evals 集成测试（31 regex + 24 LLM，覆盖 5 种 intent，cn/ja 双语）
- [x] 可插拔模型支持：`EVAL_MODEL` 环境变量切换 lm-studio/gemini/openai
- [x] 真实 LLM 验证：qwen3.5-9b (本地) + gemini-3.1-flash-lite-preview
- [x] 40 unit tests (intent) + 13 unit tests (sql)，全部通过
- [x] 创建 `/eval-model` skill

### Eval Baseline

| 模型 | Intent | Params | 延迟 | 稳定性 |
|------|--------|--------|------|--------|
| qwen3.5-9b (本地) | 87.3% | 96.4% | ~2s/case | 并发>1 时 502 |
| gemini-3.1-flash-lite-preview | 89.1% | 96.4% | ~400ms/case | 稳定 |

### 发现的问题
1. **Regex 路线优先级**: bangumi 匹配吞掉了路线意图（3 case 失败）
2. **LLM 边界模糊**: 无明确标题时 LLM 倾向 search_by_location（3 case）
3. **语义级 episode**: "有一集在大吉山展望台" 无法用正则提取（1 case）
4. **LM Studio 并发**: 并发>1 时 502，需 max_concurrency=1
5. **Gemini 模型名**: `gemini-3.1-flash-lite` 未 GA，需用 `-preview` 后缀

### 关键决策
| 决策 | 时间 |
|------|------|
| Text-to-SQL 为主力检索（embedding 降 P2） | 数据分析后确认 |
| pydantic_evals 替代自写 eval harness | 发现 pydantic-ai 自带 |
| 可插拔模型（EVAL_MODEL env var） | 用户要求 |

### 下一步
- STORY 1.3: PlannerAgent + ExecutorAgent（Plan-and-Execute 核心）
- 修复 regex 路线优先级问题（提升 eval 到 >93%）
- 优化 LLM system prompt（few-shot examples）

### 费用
- 开发: $0/月 (Free tiers)
- 生产: $30/月 (CF $5 + Supabase $25)
