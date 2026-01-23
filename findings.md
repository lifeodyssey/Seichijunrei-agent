# Findings & Decisions
<!--
  规则：每进行 2 次“查看/搜索/浏览”操作，就把关键发现写进来（2-Action Rule）。
-->

## Requirements
- 用户要求：对该 repo 做“重新的架构升级 + 全面重构”，并希望我先全面理解当前代码库。
- 约束：尽量可增量迁移；保持可运行/可测试；尽可能利用现有结构与工具链。
- 目标取舍（用户确认）：
  - 以“部署简单”为第一优先（最终要部署）。
  - 允许目录/包结构重命名与迁移（包括新增 application/infrastructure 等层）。
  - 允许引入新依赖（例如 DI/可观测性/HTTP 客户端等）。
- 新增需求：
  - 升级/更新当前所有依赖（并保持 CI 兼容）。
  - 探索前端是否可使用 A2UI（Agent-to-UI）提升交互体验。
  - 评估并迭代升级 agent 编排：是否合理、如何用“skills”式模块化能力来扩展。

## Research Findings
- README 描述了一个基于 Google ADK 的 2-stage 会话工作流（Stage1: Bangumi 搜索与候选呈现；Stage2: 选定作品后从 Anitabi 拉点、LLM 选点、工具规划路线、最终呈现）。
- Root agent `adk_agents/seichijunrei_bot/agent.py` 使用确定性的 `RouteStateMachineAgent` 基于 session state + 用户输入规则路由 Stage 1/2，并支持 `reset/back`。
- 当前仓库已具备“分层雏形”：`domain/`（Pydantic entities）、`clients/`（HTTP clients）、`services/`（cache/retry/session/route planner）、`adk_agents/`（ADK agents + workflows + tools）、`utils/logger.py`（结构化日志）。
- 运行方式：`uv` 管理依赖；`make web` / `uv run adk web adk_agents` 启动 ADK Web UI；`make run` / `uv run adk run adk_agents/seichijunrei_bot` CLI 运行。
- `pyproject.toml` 显示该项目为 Python 3.11+；依赖包含：Pydantic v2、aiohttp/httpx、structlog/rich、google-adk、google-cloud-aiplatform[adk,agent_engines]、google-genai、googlemaps、GCS 等。
- 工程化：ruff/black/mypy/pytest 已配置；mypy `disallow_untyped_defs=true`（整体倾向强类型/显式注解）。
- 打包：wheel 仅包含 `clients/config/domain/services/utils`（`adk_agents/` 未作为包进入 wheel），意味着“运行入口”与“可复用库代码”目前是分离的。
- 已开始引入 `application/` 层（ports + use cases），并新增 `clients/anitabi_gateway.py` 作为 `AnitabiGateway` 的基础设施适配器（为后续 Clean Architecture 迁移打基础）。
- `application/` 已扩展到 Bangumi（`BangumiGateway` + `SearchBangumiSubjects`/`GetBangumiSubject`），ADK tools 通过 gateway 调用用例（保持 tools 签名不变，方便 agents 渐进迁移）。
- route planning（deterministic）也开始走 `application/`：`PlanRoute` + `RoutePlanner` port（由 `services/route_planner_gateway.py` 适配），ADK tool 不再直接 import `services.simple_route_planner`。
- `Makefile` 已提供 `make test/lint/format/check/web/run/health` 等常用命令。
- `adk_agents/seichijunrei_bot/` 下包含 root `agent.py`、`_agents/`（各 stage agent）、`_workflows/`（编排）、`tools/`（FunctionTools）。
- 工作区存在一些运行产物目录/文件（例如根目录与 `adk_agents/.../__pycache__`、`.DS_Store`），不过 `.gitignore` 已配置忽略它们；需要确认是否有误提交/应清理。
- Root `agent.py` 在 import 时执行 `setup_logging()`、`get_settings()` 并打印启动日志（存在一定副作用/初始化时机耦合）；root agent 为 `RouteStateMachineAgent`（BaseAgent），并通过 `skills.py` 声明 workflow 合约（输入/输出 state key）。
- Stage 1 workflow (`BangumiSearchWorkflow`) 使用 `SequentialAgent` 组合：`extraction_agent` → `bangumi_candidates_agent` → `user_presentation_agent`，遵循“处理/呈现分离”的 ADK 习惯用法。
- Stage 2 workflow (`RoutePlanningWorkflow`) 组合：`user_selection_agent` → `points_search_agent` → `points_selection_agent` → `route_planning_agent` → `route_presentation_agent`；其中 workflow 文件的 docstring 仍保留“未来再加 route planning”的旧描述（小的文档漂移）。
- `adk_agents/seichijunrei_bot/_schemas.py` 定义了多段 LlmAgent 的 `output_schema`（Pydantic v2），用于在 session state 中传递结构化数据（ExtractionResult、Candidates、Selection、PointsSelection、RoutePlan 等）。
- `config/settings.py` 使用 `pydantic-settings` 读取 `.env`；已移除对 `output_dir/template_dir` 的自动 `mkdir`（避免配置加载时的 IO side effect）。
- `utils/logger.py` 的 `setup_logging()` 会读取 `get_settings()` 决定日志级别/渲染器，并对第三方库日志做统一降噪；目前 root agent 在 import 时调用它（初始化时机与运行方式耦合）。
- `utils/logger.py` 原先 `LogContext` 误用 structlog contextvars API（`bind_contextvars` 返回 token map，`unbind_contextvars` 需要 keys），且 processor 缺少 `merge_contextvars` 导致上下文不入日志并可能泄漏；已修复并补充单测（`tests/unit/test_logger.py`）。
- Root router（`RouteStateMachineAgent`）在每次 invocation 里绑定 `invocation_id/session_id/user_id/app_name` 到 structlog contextvars，使下游 tools/agents 日志可关联同一次会话调用。
- `clients/base.py` 提供 `BaseHTTPClient`（aiohttp）并组合了 `services.retry.RateLimiter` 与 `services.cache.ResponseCache`；重试逻辑通过解析异常字符串判断 4xx（偏脆弱，后续可改为基于 status/错误类型）。
- `clients/bangumi.py` 基于 `BaseHTTPClient` 实现 Bangumi API 查询；已将 `APIError` 从 domain 迁移到 `clients.errors`，初步收敛 domain/infra 边界。
- 新增 `application/errors.py` 并在 gateway adapters（`infrastructure/gateways/*`，旧 `clients/*_gateway.py`/`services/route_planner_gateway.py` 为兼容 wrapper）中将 infra 异常（`APIError`/`ValueError`）映射为 app errors（避免 `adk_agents` 依赖 infra exception）；`PointsSearchAgent` 已不再 import `clients.errors`。
- `services/cache.py` 提供带 TTL + LRU 的内存缓存（`OrderedDict` + `threading.Lock`）；会尝试在有 running loop 时启动后台 cleanup task（否则退化为手动清理）。
- `services/retry.py` 同时提供通用 `retry_async` 装饰器与 `RateLimiter`（token bucket）；但 `BaseHTTPClient` 当前实现了另一套手写 retry/backoff（存在重复/可收敛空间）。
- README 中提到的 `services/session.py` 在当前仓库不存在（文档与代码有漂移，需要在重构阶段同步修正）。
- `services/simple_route_planner.py` 提供 deterministic 的启发式路线规划（按 episode/time_seconds 排序、取前 N 个点、生成粗略时间/距离与文本描述）；实现中对 `name/cn_name` 的偏好与注释存在轻微不一致（可作为小型质量修复点）。
- ADK 工具 `plan_route` 已迁移为调用 `application.PlanRoute` use case（`RoutePlanner` port 由 `services/route_planner_gateway.py` 适配），返回 dict 以匹配 `RoutePlan` schema。
- ADK 工具 `search_anitabi_bangumi_near_station` 已迁移为调用 `application` use case（通过 `AnitabiGateway`），减少 `adk_agents` 对 `clients` 的直接耦合。
- ADK 工具 `translate_text`（`adk_agents/.../tools/translation.py`）已迁移到 `google-genai` SDK，并通过 `asyncio.to_thread` 调用同步 API，避免阻塞事件循环。
- `ExtractionAgent`（LlmAgent）使用 `ExtractionResult` schema 输出 `extraction_result`；其 instruction 已对齐 schema（字段始终为字符串，不再要求输出 null）。
- `BangumiCandidatesAgent` 用 `SequentialAgent` 拆分“工具调用 + 结构化输出”：`BangumiSearcher`（tools）→ `BangumiCandidatesFormatter`（output_schema），符合 ADK best practice（避免 tools + output_schema 混用）。
- `UserPresentationAgent` 负责把 `bangumi_candidates` 变成多语言对话输出，并在 zh-CN 且缺少 `title_cn` 时调用 `translate_tool` 补齐标题翻译（呈现层承担 UI/UX）。
- `UserSelectionAgent` 解析用户输入（数字/描述/标题）并输出结构化 `selected_bangumi`（UserSelectionResult）。
- `PointsSearchAgent`（BaseAgent）负责确定性 I/O：基于 `selected_bangumi.bangumi_id`（并兼容旧字段 `bangumi_result.bangumi_id`）调用 `clients.AnitabiClient` 拉取全部点位并写入 state（`all_points`、`points_meta`）。
- `PointsSearchAgent` 写入的 `all_points` 已改为与 schema 对齐的扁平结构（包含 `lat/lng/screenshot_url` 等），更利于后续 `PointsSelectionAgent` 复用原始点对象并输出 `SelectedPoint`。
- `PointsSelectionAgent`（LlmAgent + output_schema）在不调用工具的前提下，从 `all_points` 中选择 8–12 个点并产出 `points_selection_result`（强调“必须复用原始点对象、不要编造”）。
- `RoutePlanningAgent` 已改为 `SequentialAgent`：`RouteToolRunner`（tools-only）→ `RoutePlanFormatter`（schema-only），避免 tools + output_schema 混用。
- `RoutePresentationAgent` 负责把 `route_plan` 组织成多语言、结构化的最终用户输出，并在中文且缺少中文标题时调用 `translate_tool` 做标题翻译。
- `clients/anitabi.py` 负责 Anitabi API：`search_bangumi`（near）、`get_bangumi_points`（points/detail，兼容多种返回结构）、`get_station_info`；并将响应映射为 `domain.entities`（Bangumi/Point/Station）。
- `AnitabiClient` 不再在模块 import 时执行 `get_settings()`；仅在未显式传入 `base_url` 时，构造函数内读取 `settings.anitabi_api_url`（默认含 `/bangumi`），降低 import-time side effects。
- `.env.example` 中 `ANITABI_API_URL=https://api.anitabi.cn/bangumi`（与 `AnitabiClient` 的 endpoint 拼接一致；README 里的示例需要同步）。
- `tests/` 当前实际存在的单测主要覆盖：clients（Bangumi/Anitabi/Base）、services（cache/retry/simple_route_planner）、domain entities、ADK schemas；同时工作区里有不少旧测试的 `__pycache__` 产物（不影响 git，但说明历史上结构/功能有过较大调整）。
- 已新增 A2UI（面向最终用户）的本地 PoC：`interfaces/a2ui_web/`（aiohttp server + 最小 renderer），把 ADK session state 渲染成 A2UI v0.8 messages（候选卡片选择 + 路线/点位视图），用于验证“可操作 UI”体验而不影响 Agent Engine 部署单元（`adk_agents/`）。
- A2UI（Agent-to-UI）是 Google 发起的开放协议/SDK（a2ui.org / github.com/google/A2UI），用于让 agent 返回结构化 UI 组件并由前端渲染；其 quickstart 建议用 `a2a-sdk` + `google-adk` 在后端提供 A2A agent 服务、前端用 `@a2ui/client`（Lit/Angular）渲染。
- A2UI repo 提供了 ADK 的 sample agent（例如 `samples/agent/adk/restaurant_finder`）展示了“planner/executor + remote agent”的编排方式，以及如何让 LLM 产出 A2UI 交互结构。
- A2UI 官方 agent development guide 提供了基于 ADK 的“生成 A2UI messages”的推荐流程：先把 A2UI schema+examples 作为上下文给模型，再让模型输出“对话文本 + A2UI JSON（用 delimiter 分隔）”，并对 JSON 做解析/校验；同时明确提示该部分仍在快速演进（未最终定型），更建议复用官方 renderer/SDK 处理渲染与交互。
- MCP 生态补充（第三方服务评估）：
  - Anitabi：发现社区 MCP `@qiyuor2/anitabi-mcp-server`（Node/stdio）。暴露 3 个 tools：`search_animate_subject(keyword)`（Bangumi 搜索）、`get_bangumi_stage_lite_by_id(id)`（Anitabi `/bangumi/{id}/lite`）、`get_bangumi_stage_point_detail_by_id(id)`（Anitabi `/bangumi/{id}/points/detail?haveImage=true`）。输出为 **XML 字符串**（`objectToXML`），且缺少我们当前用到的 **station resolve / near** 能力；如果纳入 Agent Engine 主链路，会引入 Node/npx/子进程或远程服务的部署复杂度。
  - Bangumi：发现社区 MCP `etherwindy/Bangumi-MCP`（Python）。工具覆盖面很广（`search_subjects`、`get_subject_info` 等）并支持 `stdio`/`sse`/`streamable_http` 运行模式；可作为未来“可选工具源”或扩展能力的基础。注意其 token env 变量在 README 示例与代码中存在不一致迹象（需要集成时校对并统一）。
- ADK（`google-adk 1.22.1`）已原生支持 MCP tools：`google.adk.tools.mcp_tool.mcp_toolset.McpToolset` 可通过 `connection_params` 对接 MCP server，并将 MCP tools 转成 ADK tools（可直接挂到 agent）。
  - `connection_params` 支持：`StdioServerParameters`（启动本地子进程）/ `StdioConnectionParams` / `SseConnectionParams` / `StreamableHTTPConnectionParams`（远程）。
- MCP transport 简析（与“部署简单”强相关）：
  - `stdio`：agent 启动本地 MCP server 子进程，协议走 stdin/stdout。优点是无需额外网络服务（适合本地开发/CI）；缺点是部署到 Agent Engine 可能受限（子进程是否允许、Node 是否可用），且需要考虑进程生命周期/超时/并发/日志收集。
  - `SSE`：agent 通过 HTTP 连接远程 MCP server，并用 Server-Sent Events 接收流式事件。优点是无需本地子进程；缺点是需要额外服务与网络可达/鉴权。
  - `streamable HTTP`：agent 通过 HTTP 与远程 MCP server 通信（通常也会维持长连接）。优点是更贴合云部署与扩缩容；缺点是引入额外服务部署、网络与鉴权配置。
- 已在 repo 内实现 MCP stdio 探针与自建 MCP servers（便于验证与替换第三方实现）：
  - `infrastructure/mcp_servers/ping_server.py`：最小 ping MCP server（stdio）
  - `adk_agents/.../McpProbeAgent` + router command：对话里输入 `/mcp_probe` 触发探针（spawn 子进程 → list tools → call ping）
  - `infrastructure/mcp_servers/bangumi_server.py` / `infrastructure/mcp_servers/anitabi_server.py`：自建（Python/FastMCP）服务雏形，输出 JSON 且对齐现有 tool 结构（success/error）
- 已增加 MCP toolset 开关（feature flag），可让 Stage 1 Bangumi 搜索从“Python tool (HTTP)”切换为“ADK McpToolset (MCP)”，方便逐步验证与迁移（默认关闭）。
- ADK 官方文档给出的 MCP 部署形态主要有两类：1）**本地 stdio**（agent 内 spawn 子进程）更适合开发/自包含；2）**远程 streamable HTTP**（MCP server 独立服务化）更适合生产部署（尤其是 Agent Engine 这类运行环境对 Node/子进程/文件系统权限存在不确定性时）。
- `McpToolset` 负责连接的生命周期管理（建立连接、列工具、调用、关闭），但不会替你“打包/安装”MCP server 的运行时与依赖；因此把 MCP 接在 feature flag 后面，能保证主链路稳定，并允许在不同环境按需切换（stdio ↔ SSE/streamable HTTP）。
- 依赖升级已完成（以 CI 的 Python 3.11 为 resolve 基线）：`uv.lock` 已刷新，`google-adk` / `google-cloud-aiplatform` / `pydantic` / `ruff` / `black` / `pytest` 等均已升级到较新版本（目前 `google-adk` 已升级到 v1.23.0）。
- ADK v1.23.0 release notes 提到新增对 A2UI 的协议层支持：在 A2A 集成场景下，可在 A2A DataPart metadata 与 ADK events 之间转换 A2UI messages（意味着“能把 A2UI message 作为事件传出来”，但渲染仍由前端/客户端负责）。
- `google-generativeai` 已被官方弃用；仓库内翻译工具已迁移到 `google-genai` SDK（并从依赖中移除 `google-generativeai`），避免未来 breakage。
- A2UI Web UI 除了本地 in-process 跑 ADK agent 外，还可以通过 Vertex AI SDK 调用已部署的 Agent Engine：创建远程 session、query 后拉取 `session_state`，从而继续用“确定性 presenter”渲染 UI（避免让 LLM 直接输出 UI JSON）。
- 由于 sandbox 限制无法写入用户级目录，uv-managed Python 3.11 被安装在项目内 `.uv_python/`；因此 coverage 配置需要显式忽略该目录，避免把标准库计入覆盖率统计。
- CI（`.github/workflows/ci.yml`）使用 `uv`：black/ruff/mypy（mypy 目前 `continue-on-error`），单测覆盖率阈值 `--cov-fail-under=75`；Build job 会验证可 import `root_agent`/domain/entities/clients 并尝试 `uv build`。
- 部署（`.github/workflows/deploy.yml`）通过 `adk deploy agent_engine ... adk_agents` 发布到 Vertex AI Agent Engine；说明 `adk_agents/` 是部署“可运行单元”的核心目录，重构时需保持其可部署性与目录结构约束。
- `health.py` 的健康检查主要做 import/断言校验，但组件计数等信息是硬编码且可能已过期；重构后应改为基于真实模块/agent 列表的动态统计或直接移除计数。
- `DEPLOYMENT.md` 与 deploy workflow 一致，核心是 GitHub Actions 部署 `adk_agents` 到 Agent Engine；架构升级应避免引入需要额外部署步骤的耦合（除非明确要升级部署形态）。
- 单测重点之一是 Gemini schema 兼容性：`tests/unit/test_schemas.py` 会递归检查 schema JSON 中不得出现 `additionalProperties`（因此 points 选择结果用显式模型而不是 `dict`）。
- `tests/unit/test_simple_route_planner.py` 明确了当前 planner 的行为契约（排序/截断/估算/字段存在性），并接受“recommended_order 用 name、description 用 cn_name”的不一致（如果要统一偏好，需要同步调整测试与呈现逻辑）。
- `docs/ARCHITECTURE.md` 已存在且描述了两阶段 ADK 工作流、session state、以及“tools + output_schema 不推荐”的注意事项；但结合代码现状（如 README/health/docstring 漂移、Extraction schema mismatch 等），该文档需要在重构期一起对齐更新。

## Docs Audit (2026-01-23)
- 本次 review 前，repo 的 Markdown 文档主要集中在：`README.md`、`DEPLOYMENT.md`、`docs/ARCHITECTURE.md`、`WRITEUP.md`、`docs/architecture/*`、以及 planning-with-files 产物（`task_plan.md`/`findings.md`/`progress.md`）和 A2UI 计划（`task_plan_a2ui.md`）。
- `WRITEUP.md` 与 `README.md`/`docs/ARCHITECTURE.md` 重复且更容易漂移（例如 root router / RoutePlanningAgent 类型描述随实现变化），属于“可删冗余”。
- `docs/architecture/*`（mermaid/plantuml/html）属于“高维护生成物”，与 `docs/ARCHITECTURE.md` 的内嵌说明重复；更适合删掉以降低漂移成本。
- `docs/architecture/REFACTOR_ROADMAP.md` 与 `task_plan.md`/`findings.md` 内容高度重叠，建议用 planning 文件承载 roadmap。

结论（keep small）：
- 保留：`README.md`、`DEPLOYMENT.md`、（可选）`docs/ARCHITECTURE.md`、planning files、`task_plan_a2ui.md`。
- 删除（已执行）：`WRITEUP.md`、`docs/architecture/*`、`docs/architecture/REFACTOR_ROADMAP.md`。

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| 以部署简单为第一优先（`adk_agents/` 为部署单元） | deploy workflow 直接部署 `adk_agents` 到 Agent Engine，保持最小变更面 |
| Root 路由使用确定性状态机（`RouteStateMachineAgent`） | 降低误触发 Stage 2 的成本与风险；行为可预测、可测试 |
| Stage 2 拆分为 tools runner + schema formatter | 对齐 ADK best practice：避免 tools + output_schema 混用，提升稳定性与可观测性 |
| 引入 `application/`（ports + use cases） | 明确 IO 边界与依赖方向，便于测试与渐进迁移 |
| 错误模型分层（domain/app/infra）并在 gateway 做映射 | 让 agents 只依赖 app-level errors，减少外部实现泄漏与耦合 |
| structlog contextvars 统一与 log correlation（invocation/session id） | 保障并发日志上下文正确，便于排障与追踪 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 第三方 `anitabi-mcp-server` 的 tools/输出格式在 README 中不够明确（需要 code review 确认覆盖范围） | 若要 MCP 化：更倾向自建 MCP（JSON + 补齐 station/near 等缺口）或继续保留直连 HTTP |
| 第三方 `Bangumi-MCP` token env 命名在 README 中存在不一致（`BANGUMI_TOKEN` vs `BANGUMI_API_TOKEN`） | 集成前在 adapter 层统一 env 命名（避免部署时踩坑） |
| Agent Engine 对子进程（stdio MCP）/Node 支持不确定 | 需要先验证；若受限则优先考虑远程 streamable HTTP（服务化 MCP） |
| ADK stdio MCP `close()` 会在 stderr 打印 `Attempted to exit cancel scope in a different task` | 目前不影响 tool 调用，但可能影响子进程回收；推测与 ADK 内部 `asyncio.wait_for(enter_async_context(...))` 创建 task 有关，需在 Agent Engine 上观测并决定是否改为 long-lived session / 远程 MCP |

## Resources
- `README.md`
- `pyproject.toml`
- `domain/`, `services/`, `clients/`, `adk_agents/`, `utils/`, `config/`, `tests/`
- https://google.github.io/adk-docs/tools-custom/mcp-tools/
- https://github.com/QiYuOr2/anitabi-mcp-server
- https://github.com/etherwindy/Bangumi-MCP

## Visual/Browser Findings
-
