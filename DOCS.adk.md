# Docs Policy (adk)

目标：文档保持“少而准”。以代码与测试为事实来源，文档只描述稳定边界与使用方式，避免维护成本。

## Canonical Docs（建议保留）

- `README.md`：用户入口（安装/运行/常用命令/最小架构概览）。
- `DEPLOYMENT.md`：部署到 Vertex AI Agent Engine 的操作指南（与 `.github/workflows/deploy.yml` 对齐）。
- `docs/ARCHITECTURE.md`：可选；当且仅当你希望保留“单一架构深度文档”时保留它（否则可把关键段落合并进 README 后删除）。
- `task_plan.md` / `findings.md` / `progress.md`：planning-with-files 的工作记忆（允许偏工程化/偏过程）。
- `task_plan_a2ui.md`：A2UI 子项目计划（必须保留，按你的要求）。
- `TODO.adk.md`：ADK 相关 backlog（本文件同级）。

## Docs To Remove（本次建议删除）

以下内容要么与 `docs/ARCHITECTURE.md` 重复，要么包含高漂移信息（图/步骤/agent 类型），维护成本高：

- `WRITEUP.md`：比赛/介绍型长文，信息与实现容易漂移，且与 README/ARCHITECTURE 重复。
- `docs/architecture/*`：mermaid/plantuml/html 这类“生成物/可视化”需要持续同步实现；当前 repo 已有文字与内嵌 diagram 足够表达核心结构。
- `docs/architecture/REFACTOR_ROADMAP.md`：与 `task_plan.md` / `findings.md` 高度重叠，建议用 planning 文件替代。

## Writing Rules（减少漂移的写法）

- 避免硬编码“agent 数量/步骤数量/工具数量”等易变指标；改为引用代码位置或命令（例如 `adk run ...` / `pytest ...`）。
- 所有 state key 名称只引用 `adk_agents/seichijunrei_bot/_state.py`；所有 schema 只引用 `adk_agents/seichijunrei_bot/_schemas.py`。
- 文档不要复制粘贴大段流程图；最多保留一个“高层图 + 关键决策点”，其余用链接/代码引用。
- A2UI 相关文档独立维护（`task_plan_a2ui.md`），避免掺进主 README 造成主线膨胀。

