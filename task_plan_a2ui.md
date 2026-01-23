# Task Plan (A2UI): Route A — Official A2UI Stack (ADK A2A + Lit Shell)
<!--
  Date: 2026-01-23
  Goal: Migrate A2UI integration to Route A:
        - Backend: ADK agent served via A2A (Starlette/FastAPI) using ADK's A2A utilities
        - Frontend: Official A2UI client (Lit shell) rendering A2UI messages

  Why a separate plan?
  - This is a large, cross-cutting subproject (frontend + backend + protocol contract + deploy).
  - Keep the existing repo refactor plan in task_plan.md intact, while tracking A2UI Route A work here.
-->

## Success Criteria
- 本地开发可跑：一条命令起后端（A2A），一条命令起前端（Lit），可完成 2-stage 流程并交互式编辑路线（至少 remove point + replan）。
- 协议/契约稳定：A2UI message types + actions 有版本化约定（可回放/可测试）。
- 不破坏现有：`adk run` / `adk web` / unit tests 继续通过（A2A/A2UI 作为新增入口，不替换现有入口，除非明确切换）。
- 可部署：提供一个“最简单的 staging 部署方案”（优先 Cloud Run；是否继续 Agent Engine 作为执行面留到决策点）。

## Key Decisions (待确认/默认)
1. **MVP 部署形态（默认）**：A2A server 在 Cloud Run 内 **in-process** 运行 ADK agent（最快交付）。
2. **最终形态（候选）**：A2A server 变成 **gateway**，转发到 Vertex AI Agent Engine（更贴近你原先的 Agent Engine 目标，但实现更复杂）。
3. **A2UI message 生成策略（默认）**：先用 **deterministic presenter**（基于 session state），把 A2UI 当“UI 描述层”而不是“LLM 输出格式”；后续可加 LLM-driven UI 作为实验分支。

## Parallel Development (可以并行)
可以并行，前提是先把“契约”定下来：
- **契约先行**：先固定 A2UI message schema（我们要用哪些组件）+ action payload（点击后发什么回后端）。
- **前端并行**：用 mock A2A server / 录制 event stream 回放 UI（不依赖真实 agent）。
- **后端并行**：先把 A2A server + session 管理跑通，先返回最小 demo message（Hello + 1 个按钮），再逐步接入真实 agent/state。

---

## Workstreams & Tasks

### WS0 — Contract & Architecture (Owner: you+me)
- [ ] 定义 `contracts/a2ui/`：message types、action ids、payload、版本号（v0）。
- [ ] 决定“会话模型”：A2A task_id/context_id ↔ ADK session_id/user_id 的映射规则。
- [ ] 定义“错误呈现标准”：backend error -> UI error surface（可 reset / retry）。
- [ ] 决定“多语言策略”：UI 文案与 agent 文案的分工（前端 i18n vs 后端生成）。

Deliverables:
- `docs/a2ui/CONTRACT.md`
- `docs/a2ui/ACTIONS.md`
- `docs/a2ui/MESSAGE_CATALOG.md`

### WS1 — Backend: A2A Server (ADK → A2A) (Owner: backend)
Milestone: “可用 A2A 协议跑起来，并能承载我们的 root_agent”

#### WS1.1 Skeleton
- [ ] 新增 `interfaces/a2a_server/`：提供 `app`（Starlette）与 `main`（uvicorn 启动）。
- [ ] 使用 `google.adk.a2a.utils.agent_to_a2a.to_a2a(root_agent, ...)` 包装现有 `adk_agents/seichijunrei_bot/root_agent`。
- [ ] 提供本地启动命令：`make a2a`（host/port 可配置）。
- [ ] 增加 smoke：启动后健康检查 + agent card 可拉取（最小验证）。

#### WS1.2 Session & State strategy
- [ ] 明确 runner/session services：MVP 用 in-memory；为后续替换（Redis/Firestore）留 adapter 点。
- [ ] 支持“同一用户多 session”的策略（session_id 由前端保存/传回）。

#### WS1.3 A2UI event emission
- [ ] Spike：确认“如何在 ADK event -> A2A DataPart”里承载 A2UI messages（基于 ADK v1.23.0 的转换层）。
- [ ] 选一种实现：
  - [ ] A) 在 agent 内部产出 A2UI DataPart（最贴近官方 guide：LLM/logic 输出 A2UI JSON）。
  - [ ] B) 在 A2A server 侧做 presenter：拿到 ADK session_state 后生成 A2UI message，再塞回 A2A event stream（更 deterministic）。
- [ ] 实现最小 UI：Welcome message + 1 个 button action（验证端到端 action roundtrip）。

#### WS1.4 Wire Seichijunrei flows
- [ ] Stage 1：Bangumi candidates -> A2UI selectable cards（action = select_candidate_{i}）。
- [ ] Stage 2：Route -> A2UI route view（points list + remove_point_{i} action + replan）。
- [ ] 确保“remove point”不触发额外 LLM（deterministic replan）。

Deliverables:
- `interfaces/a2a_server/app.py`
- `interfaces/a2a_server/main.py`
- `Makefile` target: `make a2a`
- Unit tests: `tests/unit/test_a2a_server_*`

### WS2 — Frontend: Official A2UI Client (Lit Shell) (Owner: frontend)
Milestone: “能连上 A2A 后端并渲染 A2UI messages，支持 action 回传”

#### WS2.1 Scaffold & dev loop
- [ ] 引入 `interfaces/a2ui_lit/`（从官方 shell 思路对齐）：Node 工具链、dev server、env 配置。
- [ ] 配置 A2A endpoint（本地 `http://localhost:<port>/`），支持切换 staging URL。
- [ ] UI：Chat + A2UI renderer + connection status（断线/重试）。

#### WS2.2 Message rendering & action dispatch
- [ ] 支持我们 contract 里用到的组件（先从最小集开始）。
- [ ] action dispatch：点击 UI -> 形成 A2A request message -> 发到后端 -> 流式渲染返回 events。
- [ ] 录制/回放（可选）：把 event stream 保存成 JSONL，方便调试与回归。

Deliverables:
- `interfaces/a2ui_lit/`（package + README）
- `make a2ui-lit` / `pnpm dev` 指令

### WS3 — Integration & E2E (Owner: both)
- [ ] 写 “Golden path” E2E 手册（本地）：从输入城市+作品到得到路线，再 remove 一个点并更新路线。
- [ ] 加一条轻量 E2E（可选）：用 mock LLM（或录制 response）跑通 UI contract，不依赖真实外部 API。
- [ ] 性能/稳定性：大消息/多事件时前端不卡顿；后端 event queue 正确 flush。

### WS4 — Deploy (staging first) (Owner: infra)
- [ ] 决策点：MVP 是否先不走 Agent Engine（Cloud Run in-process agent）？
- [ ] Cloud Run 部署后端 A2A server（建议 `gcloud run deploy --source`，避免你维护 Dockerfile）。
- [ ] 前端部署（两种都行，择一）：
  - [ ] A) 单独 Cloud Run static hosting
  - [ ] B) GCS + Cloud CDN（更适合纯静态）
- [ ] IAM / secrets：GOOGLE_API_KEY / Vertex AI creds / third-party tokens（最小化权限）。

Deliverables:
- `docs/a2ui/DEPLOY_STAGING.md`
- `scripts/gcp/deploy_a2ui_staging.sh`

---

## Milestones (Suggested)
1. **M0 (Spike)**：跑通官方 A2UI lit shell + 一个最小 A2A backend（hello + button）。
2. **M1 (Backend ready)**：A2A server 能跑 root_agent（文本对话先通）。
3. **M2 (Contract v0)**：A2UI candidates cards + select action 通。
4. **M3 (Route v0)**：Route view + remove point + deterministic replan 通。
5. **M4 (Staging)**：Cloud Run staging 上线（前后端至少一个可用 URL）。

## Risks / Watchouts
- ADK 的 A2A/A2UI 支持仍标注为 experimental：要准备 API 变更的缓冲层（contract + adapters）。
- 如果坚持“最终必须 Agent Engine 作为执行面”，A2A gateway 需要把 A2A task/event 与 Agent Engine session/event 对齐（工作量显著上升，建议在 M3 后再做）。
- Node toolchain 引入后，需要在 CI 里明确“前端是否参与 CI”（建议先不阻断后端 CI，只做可选 job）。

