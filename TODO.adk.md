# TODO List (adk)

> 约定：本文件里的每条 TODO 都以 `(adk)` 结尾，方便 grep/过滤。

## Architecture
- [ ] 明确“部署单元”与“可复用库”边界：是否把 `adk_agents/` 纳入 wheel，或在 README 里明确其仅用于部署/运行入口。(adk)
- [ ] 为每个 workflow/skill 定义更严格的 state contract 校验（required/provided/reset + 运行前断言/测试），避免隐式依赖 key。(adk)
- [ ] 把所有“会话状态 key + 结构”的规范收敛成单一来源（建议以 `adk_agents/.../_state.py` + `adk_agents/.../_schemas.py` 为准），并在文档中只引用这一处。(adk)
- [ ] 统一 tool / BaseAgent 的错误契约：优先返回结构化 `{success,error}` 或统一的 app-level error 映射，避免异常穿透导致体验/可观测性不一致。(adk)
- [ ] 明确 SessionService 策略：本地/Agent Engine/自建 A2A gateway 三种模式下，session_id/user_id/state 的来源与一致性规则。(adk)

## Agent Engine / MCP
- [ ] 在 Agent Engine 真实环境验证 stdio MCP 子进程可用性与限制（`/mcp_probe`），记录结论与推荐拓扑（stdio vs SSE/streamable HTTP）。(adk)
- [ ] 若 Agent Engine 不允许 stdio：规划 MCP 独立服务化（streamable HTTP/SSE），并实现 application ports 的 MCP adapter（feature flag）。(adk)
- [ ] 为所有外部调用补齐超时/重试/熔断策略的统一入口（避免散落在 clients/services/tools）。(adk)

## Docs (keep small)
- [ ] 建立“文档最小集”规则：只保留 README + DEPLOYMENT +（可选）ARCHITECTURE + A2UI 相关；其余用代码与测试作为事实来源。(adk)
- [ ] 将文档中的“可变信息”（agent 数量、步骤数量、文件树）改为引用代码位置/命令输出，避免持续漂移。(adk)
- [ ] 将 README 的权威链接指向 `DOCS.adk.md`（文档索引/删除策略/更新责任人）。(adk)

## Testing / Quality
- [ ] 增加“skill contract”回归测试：Stage 1/2 运行后必须写入的 keys、reset/back 行为、以及关键 state shape 的 JSON schema 限制。(adk)
- [ ] 建立最小 `adk eval` 的可重复运行说明（evalset 维护策略、如何在 CI/本地跑）。(adk)

