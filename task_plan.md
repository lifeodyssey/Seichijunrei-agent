# Task Plan: Repo 架构升级 + 全面重构（Seichijunrei）
<!--
  目标：对当前仓库做一次“可持续演进”的架构升级与重构。
  原则：保持可运行/可测试；用小步迁移替代一次性推倒重来；每个阶段都可回滚/验证。
-->

## Goal
在不破坏现有核心功能与测试的前提下，将该 Python 项目重构为边界清晰、可测试、可扩展的模块化架构（明确 domain / application / infrastructure / interfaces），并补齐工程化（配置、日志、错误处理、依赖管理、类型、测试与文档）。

## Current Phase
Phase 4

## Phases

### Phase 1: Requirements & Discovery
- [x] 明确用户期望：目标形态、必须保留的 API/行为、时间/风险约束、发布方式（库/服务/CLI）
- [x] 盘点入口：运行方式、服务端/CLI/脚本、agent 运行链路、外部依赖（LLM/工具/存储）
- [x] 盘点当前结构：domain/services/clients/utils/adk_agents 等职责是否清晰，耦合点在哪里
- [x] 盘点工程：测试/CI、类型检查、lint/format、配置管理、日志与可观测性
- [x] 将关键发现写入 findings.md（2-Action Rule）
- **Status:** complete

### Phase 2: Target Architecture & Migration Plan
- [x] 定义目标架构与模块边界（推荐：domain / application / infrastructure / interfaces）
- [x] 定义“公共 API”与稳定边界（哪些模块对外暴露、哪些仅内部）
- [x] 制定迁移策略（薄切片迁移、重命名/移动策略、兼容层、分阶段 PR）
- [x] 定义编码规范（错误/日志/配置/依赖注入/IO 边界/异步策略）
- [x] 依赖升级策略：Python 版本基线（CI=3.11）、升级顺序、回滚策略
- [x] 前端探索：A2UI 可行性与最小集成方案（不破坏 Agent Engine 部署）
- [x] 编排升级：将 workflow 抽象为“skills”，定义路由/触发/状态重置策略
- [x] 将 Stage 2 规划 agent 拆分为工具执行 + schema 格式化（避免 tools + output_schema 混用）
- [x] 引入确定性路由（Stage 1/2 + reset/back）降低误触发与成本
- **Status:** complete

### Phase 3: Foundation Refactor（先打地基）
- [ ] 统一配置加载（.env / config 模块），区分 runtime config 与 secrets
- [ ] 统一日志/追踪（结构化日志、request/trace id、可选 OpenTelemetry）
  - [x] 修复 structlog contextvars：`merge_contextvars` + 正确恢复 token（避免上下文泄漏）
  - [x] 定义 request/trace id 的来源与注入点：绑定 ADK `invocation_id` + `session_id`（root router）
- [ ] 统一错误模型（domain error / app error / infra error + 映射策略）
  - [x] 将 `APIError` 从 domain 迁移到 `clients/errors.py`；domain errors 收敛到 `domain/errors.py`
  - [x] 引入 app-level errors（`application/errors.py`）并实现 infra → app 的映射策略（gateways）
- [ ] 收敛依赖方向（禁止 domain 依赖 infra；interfaces 仅依赖 application）
  - [x] 已将 Bangumi/Anitabi points/route planner 的核心调用迁移到 `application`（通过 gateways），减少 `adk_agents` 对 `clients/services` 的直接依赖
  - [ ] 继续迁移剩余 tools（如翻译、更多 Anitabi 能力）并引入更清晰的 infrastructure 命名/目录
- [x] 建立清晰的“入口层”（CLI / API / worker）与“用例层”（application）（已引入 application ports/use cases 并开始迁移首批 slice）
- **Status:** in_progress (carry-over items continue in Phase 4)

### Phase 4: Incremental Refactor（模块化迁移）
- [ ] 按边界逐步迁移：clients → infrastructure；services → application；domain 保持纯净
- [x] 引入 `infrastructure/` 并将 application ports 的 adapters（gateways）迁移到该目录，保留旧路径兼容 wrapper
- [ ] MCP 接入策略（可选能力，不破坏 Agent Engine 部署）
  - [x] 调研第三方 MCP：`anitabi-mcp-server` / `Bangumi-MCP` 的 tool 覆盖与部署形态
  - [x] 核实 ADK 原生支持 MCP tools：`google.adk.tools.mcp_tool.mcp_toolset.McpToolset`（支持 stdio / SSE / streamable HTTP）
  - [x] 实现 stdio MCP “探针”（最小 ping server + `/mcp_probe` 诊断入口）用于验证 Agent Engine 是否允许本地子进程
  - [x] 自建（Python）Bangumi/Anitabi MCP server 雏形（FastMCP + JSON 输出，对齐现有 tool 返回结构）
  - [x] 增加 MCP toolset feature flag：Stage 1 Bangumi 搜索可切换到 MCP（默认仍走原 Python tool/HTTP）
  - [ ] （defer）核实 Agent Engine 运行环境约束：是否允许子进程（stdio MCP）、是否内置 Node、是否允许出站 HTTP（远程 MCP）
  - [ ] （defer）在 Agent Engine 上执行 `/mcp_probe` 并记录结论（通过/失败原因、stderr 日志、是否需要改走远程 MCP）
  - [ ] 评估 stdio MCP close 警告的影响：是否会导致子进程无法回收；必要时改为 long-lived MCP session 或切到远程 MCP
  - [ ] 决策：主链路继续直连 HTTP clients，还是切到 MCP；若切到 MCP，选择运行形态（dev/prod；stdio vs SSE/streamable HTTP）
  - [ ] 对第三方 MCP 做 gap analysis：输出格式（XML/JSON）、缺失能力（station/near）、鉴权/env 命名、稳定性与维护
  - [ ] 如采用 MCP：实现 `application` ports 的 MCP-based adapter（feature flag），并补齐 schema/错误映射
  - [ ] 如自建 MCP：以现有 `application` use cases 为后端，暴露稳定 MCP tools（JSON 输出 + station/near 等缺口）
- [ ] 提升可测试性：引入 ports/adapters（接口 + 实现），用依赖注入替代全局单例
- [ ] 清理 utils：只保留真正通用的、无副作用的 helper
- [ ] 添加/修复关键测试：用例层（application）为主，adapter 用契约测试
- [x] 完成 “本地可交付 MVP”：补齐 README 示例对话/命令 + 最小 smoke test（不依赖真实外部 API）
- [x] A2UI（面向最终用户）PoC：本地 web UI（aiohttp server + 最小 renderer），从 session state 生成 A2UI messages（候选卡片选择 + 路线/点位视图）
- [x] A2UI UX 小幅打磨：busy/loading 状态、路线“一键在 Google Maps 打开”、展示路线描述与选点理由/统计
- [x] A2UI 可部署形态准备：抽象 backend（local vs Agent Engine），支持通过 Vertex AI Agent Engine 远程会话 state 渲染 UI（默认仍为本地 in-process）
- [ ] 对齐官方 A2UI best practice：参考 `google/A2UI` demos（ADK `restaurant_finder`）与 a2ui.org guides，决定是否切换到官方 Lit/Angular renderer（或保留最小 renderer，但补齐 schema 校验与 message contract）
- **Status:** in_progress

### Phase 5: Verification & Delivery
- [ ] 全量跑测试 + 静态检查（ruff/mypy/pytest 等）并记录到 progress.md
- [ ] 文档收敛与清理：只保留“最小文档集”，删除高漂移/重复文档（保留 A2UI 相关）。(adk)
- [ ] 更新 README/DEPLOYMENT/docs：运行方式、模块职责、文档索引（指向 `DOCS.adk.md`）。(adk)
- [ ] 输出迁移总结：破坏性变更、兼容层、后续 roadmap
- **Status:** pending

## Key Questions
1. 本项目的“产品形态”是什么：库、服务端、CLI、还是多者并存？对外稳定 API 是哪些？
2. 目前最关键的执行链路（agent → tools → clients/services → 输出）是什么？哪里最脆弱？
3. 是否需要引入 `src/` 布局与包名标准化（避免顶层模块污染）？
4. 配置/密钥/环境变量如何管理（本地、CI、部署）？有哪些必须兼容？
5. 异步/并发模型是什么（asyncio / threads / sync）？是否需要统一？
6. “a2ui” 在本仓库扮演什么角色（依赖、子模块、或者只是概念）？
7. 依赖升级以 CI Python 3.11 为基线：是否允许 lockfile 以 3.11 resolve 并在本地也切到 3.11？
8. A2UI 的目标是：替换 ADK Web UI、还是提供一个可选的更强交互前端？
9. “skills” 的粒度希望到什么程度：阶段性 workflow（大技能）还是可复用能力块（小技能）？
10. Agent Engine 是否允许启动子进程（stdio MCP）？如果不允许，是否必须走远程 MCP（streamable HTTP/SSE）？
11. 若采用 Node MCP（例如 `anitabi-mcp-server`），部署环境是否允许 Node runtime / npx 下载？是否需要把 MCP 拆成独立服务？

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| 以部署简单为第一优先（`adk_agents/` 作为部署单元） | deploy workflow 直接部署 `adk_agents` 到 Agent Engine，保持最小变更面 |
| 依赖升级以 Python 3.11 为 resolve 基线 | 与 CI/Agent Engine 环境对齐，避免 lockfile 选到仅支持更高版本 Python 的依赖 |
| 翻译 SDK 从 `google-generativeai` 迁移到 `google-genai` | 官方已弃用旧包，避免未来 breakage 与告警 |
| 路由改为确定性状态机（不再用 LLM router prompt） | 防止误入 Stage 2、降低 token/工具浪费、提升可测试性 |
| Stage 2 `RoutePlanningAgent` 采用 planner/executor 拆分 | 对齐 ADK 最佳实践：工具调用与 schema 输出分离，更稳定可观测 |
| 引入 `application/`（ports + use cases）并逐步迁移 ADK agents | 建立清晰依赖方向，为后续 clients/services → infrastructure 的迁移打基础 |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| `uv run` tried to access `~/.cache/uv` (sandbox denied) | 1 | Run with `UV_CACHE_DIR="$(pwd)/.uv_cache"` |
| `uv python install` tried to write to `~/.local/share/uv/python` (sandbox denied) | 1 | Use `uv python install --install-dir "$(pwd)/.uv_python" 3.11` |
| `uv lock/sync` 无法访问 PyPI（DNS/网络受限） | 1 | 使用需要网络的命令时申请 escalated 权限执行 |
| `uv build` 无法拉取 `hatchling`（DNS/网络受限） | 1 | 使用需要网络的命令时申请 escalated 权限执行（或提前缓存 build backend） |

## Notes
- 每次重构优先：先建边界与契约，再搬迁实现；避免一次性大重命名导致不可控。
- 任何会影响行为的改动必须伴随测试/契约或最小可验证的回归手段。
