# Workflow — Matt 流程 × Policy C 编排(每阶段显式触发)

本仓工作流 = [mattpocock/skills](https://github.com/mattpocock/skills) 主流程 + 本仓执行政策。
**每个阶段显式调用对应 skill,不靠隐式判断**;skill 双侧安装(Claude Code `~/.claude/skills/`
+ opencode `npx skills add mattpocock/skills`),两个执行者读同一套定义。

## 主流程(idea → ship)

| 阶段 | 显式触发 | 本仓执行细则 |
|---|---|---|
| 0. 仓库初始化 | `/setup-matt-pocock-skills` | 每仓一次(tracker=GitHub Issues,label `ready-for-agent`) |
| 1. 磨想法 | `/grill-with-docs`(有代码库)或 `/grill-me` | **一次一问、每问带推荐、事实自查环境、共识前不动手**;产出沉进 CONTEXT/ADR |
| 1.5 可运行问题 | `/handoff` → `/prototype` → `/handoff` 回 | 原型答问,不留生产代码 |
| 2. 成 spec | `/to-spec` | 模板七段;Implementation Decisions 不写实现文件路径;**接缝向 owner 确认**;发 tracker issue + `ready-for-agent`;**spec 双席评审 = Fable + Codex GPT Sol(xhigh,`adversarial-review` 命令)→ 回修 → 复核 → owner 签核** |
| 3. 拆卡 | `/to-tickets` | 每卡:AC 带 test-type + **blocking edges 写进卡目录 `needs` 文件**;卡=一个 worktree 一个小 PR |
| 4. 实施 | `/implement`(内驱 `/tdd`) | **执行者=opencode**(serve 通道,ds-max→luna-max;见 use-opencode skill);状态机 `card.sh` 推进:QUEUED→EXECUTING→GATES→REVIEW→PR_OPEN→WAIT_GREEN→TRIAGE→MERGE→CLEANUP→DONE |
| 5. 评审 | `/code-review` | **卡级终审**:读 `origin/main...HEAD` 候选提交 vs 任务书;**候选提交协议**:gates 后先打本地候选 commit(不 push),评审绑定该 commit,REJECT → 修复 + 新候选提交 → 完整重审,批准后才 push/open PR;变异检验是绿灯唯一效力证明;合并闸的单一来源 → `docs/ops/review-gate.md` |
| 6. 合并 | 状态机 TRIAGE→MERGE | 行级线程必须 resolve(native ruleset)+ 顶层 bot 发现逐条 ack(全局 hook 强制);有 findings 落 HUMAN 态归人 |
| 日常保养 | `/improve-codebase-architecture` | 隔几天跑,产出想法回到阶段 1 |

## Native Agent 交付修订（owner 批准，2026-09-10）

代码交付与真实发布验收分别记录。#1541 先交付完整原生存储代码；不可拆开的服务、领域、
宿主与消费链切换由 [#1582](https://github.com/lifeodyssey/animichi/issues/1582) 作为一个完整 Story、一个 PR 交付。
原卡保留逐 AC 来源；不靠兼容层拼出中间版本，也不批量关闭原卡。独立 Eval CLI、语料、统计和基线仍归原 Eval 卡。
代码 PR 必须具备全部可在本地/PR 执行的功能测试、相关变异证明、类型、覆盖率、独立评审和合并门禁。
仅必须部署后测量的原 AC 移入 [#1583](https://github.com/lifeodyssey/animichi/issues/1583)，保留原文、测试类型及阈值。
代码合并不等于这些 AC 通过。仍只由 main CD 部署 staging；native 生产 promotion 须具备所有适用发布证据、
原有 production 人工批准并复用同一不可变产物。缺失发布门接线本身也是 #1583 的未完成项，不宣称已有机器门禁。

## 匝道(遇到就显式进)

- 外来 bug/请求堆积 → `/triage`(自产卡不 triage)
- 疑难 bug → `/diagnosing-bugs`(先建红色反馈环再理论)
- 大雾工程 → `/wayfinder`(产决策地图,收敛后回 `/to-spec`)
- 词汇层 → `/domain-modeling`(领域语言)· `/codebase-design`(模块形状)

## 编排层(fleet)

- 卡目录 = scratchpad `orchestra/cards/<卡>/`(brief.md + card.env + needs + state + log/)
- `fleet.sh loop` 并发推进全部非终态卡,状态变化出事件;Claude 挂 **Monitor** 只在
  `EVENT HUMAN/DONE/ALL-SETTLED` 时介入 —— 判断节点(Opus 终审、TRIAGE 判定)之外零 token
- 并发红线:**一切 opencode 走单 `serve` 多会话**;裸多进程 run 必饿死

## 上下文纪律

阶段 1→3 保持同一上下文窗口(smart zone);每张卡的实施在独立会话/工作树。
"The rate of feedback is your speed limit."
