# Spec — agent eval 套件重设计（进程内被测系统 × 轨迹前缀 × pass^k × 官方 evals 栈）

- Status: Superseded — retained as historical design/review evidence. The active agent and eval target is [the native Pi harness specification](../../specs/2026-09-09-agent-on-pi-harness-spec.md).

- Original revision status: Draft 修订 5 — owner 2026-09-09 更改了**被测系统**的前提（见 §零），修订 1/2 中一切建立在"打已部署 staging"之上的设计随之作废或坍缩。前两轮 dual-review（Seat A ×2、Seat B）的处置历史保留在文末附录。待 owner 签核。
- 事实基线：worktree `.worktrees/card-eval-redesign`，分支 `spec/eval-redesign`，base `origin/main` a00edadf8。仓库断言带 `file:line`，都在这个 HEAD 上复核过；书的断言带 `book/chapterN.md:LINE`（`/tmp/ai-agent-book`）；库的断言带 `node_modules/logfire/dist/index-Dd6NCwQg.d.ts` 行号（`logfire@0.22.5`）与 bundle `dist/evals-D4FvWViY.js` 实测；官方文档带 `/tmp/logfire-js-evals.md`（下称 evals.md）与 `/tmp/logfire-evals-SKILL.md`（下称 SKILL）行号。
- owner 定案（2026-09-08 / 09，不再复议）：① 2026-09-08 那次全量跑被直接中断，套件按李博杰《深入理解 AI Agent》第 7 章重写；② 并发可以超级加大；③ 基线是 TS 层自己的跑（Python 记录退役，#1303/#1515），真空通过用例要淘汰（#1439/#1440）；④ **全部用 Pydantic 自己的东西，按 best practice 做**；⑤ **被测系统是 agent 本身，不是部署**（§零）。
- 取代关系：`docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §五 W3 出口判据与 §十；见 §七。

## 零、被测系统（owner 2026-09-09，本次修订的前提）

**eval 测的是 agent：system prompt、工具定义、agent loop、模型调用。** Access、Neon Auth、限流、DO 持久化、CD ——那些是**别的测试**的事：integration test 与 smoke/e2e。owner 的原话是「我们只需要把 agent 启动起来跑」，位置在测试金字塔的 integration 与 E2E 之间：**又多又快**。

这与官方口径一致：Pydantic 的 skill 第 3 步要识别的是"the function or agent under test（a PydanticAI agent, an LLM-calling function, **any callable** that takes an input and returns an output）"（SKILL:40），跑法就是 `dataset.evaluate(agent_fn)`（SKILL:80）。我们此前把 `dataset.evaluate` 的 task 写成了一次 HTTP 请求，于是每个用例都在顺带测网关、身份、限流与部署——它们各有更便宜的测法，混进来只让 eval 变慢、变脆、且失败归因更难。

**由此作废的东西**（修订 1/2 里为旧前提写的）：每身份 60/60 s 限流天花板的全部分析、限流探针卡、QA 身份扩容、429/409 的用例语义、CD 契约编辑与 `superseded` 语义、`staging-bearer` / Access token / QA bearer 这条凭据链。§二、§四的相应小节按新前提重写；决策题重新编号。

**唯一保留的部署侧检查**：一条端到端 canary（一次真实对话打到已部署的 staging），它**不属于 eval 套件**，归 smoke/e2e（卡 **E1**）。

## 一、动机

**① 旧跑法两个半小时，而且它测的一半不是 agent。** 2026-09-07 那次跑是完成了的：662 例、评估 658、报错 4（`packages/eval/results/2026-09-07-agent_eval_v3.json`），墙钟 8,795 s ≈ 2.4 h（`packages/eval/src/staging-turn-task.ts:75-76`），也正是 PR #1527 铸 TS 基线所用的文件；被中断的是 2026-09-08 那次。慢的原因有两层：并发被压到 2（`src/staging-turn-task.ts:50`），以及每个用例都要过网关、身份、限流、DO、Neon。前一层是我们自己的信号量，后一层按 §零根本不该在 eval 里。

**② 端到端回归是错的默认档。** 书把回归任务分两类并给了取舍：轨迹前缀回归"把已有的上下文、对话、工具返回和环境状态冻结下来，只要求 Agent 思考并执行下一步或下几步可观察动作，成本更低，也能隔离单个策略或工具问题"，且"对于需要高可靠性的生产级 Agent，构建轨迹前缀回归任务集往往比端到端回归任务集更重要"（`book/chapter7.md:519`；端到端那类"难以判断失败究竟发生在哪一步"，`:517`）。751 个用例里 746 个从空 session 开始（`packages/eval/src/case-submissions.ts:1-22`），只有 5 个有冻结起点。

**③ 信噪比没人管过。** 2026-09-07 跑里 523 例失败，`nonempty_results` 全局 0（27 个 `expect_nonempty` 用例无一命中），`data_keys_present` 0.362，英文 `locale_match` 0.474。书的规矩是先查评测系统再动 Agent（`book/chapter7.md:726`）；SWE-bench Verified 是人工逐条评估后淘汰 71%、成本降约 80%（`:264`）——那是**先例**，不是目标值的推导。

**④ 可靠性根本没测。** 每例只跑一次。Pass@k 是能力天花板，Pass^k（**pass consecutive k**）是"同一任务连续运行 k 次、每次都通过"的可靠性（`book/chapter7.md:149`）；p=0.6、k=5 时 Pass@5 ≈ 99.0% 而 Pass^5 ≈ 7.8%（`:158`）。

**⑤ 我们手写了一批库已经给了的东西。** `InFlightTurns` 是并发信号量（`src/in-flight-turns.ts:1-15`），任务自己计时（`src/staging-turn-task.ts:84`），自己做传输重试（`:17-22`）——而 `EvaluateOptions` 就有 `maxConcurrency` / `repeat` / `retryTask` / `retryEvaluators` / `lifecycle` / `progress` / `signal`（d.ts:434-462）。且 `packages/eval` 里没有任何 `configure()` 调用（全包 grep 为 0），所以每次跑的结果从没进过 Logfire 的 Datasets & Experiments UI，而官方把"在 UI 里核实这一跑"写成第 5 步的硬要求（SKILL:116-121）。

## 二、现状 inventory

### 2.1 数据集与用例形状

六个导出集，用例数钉死（`packages/eval/src/dataset-sets.ts:15-22`）：`agent_eval_v3` 662、`agent_eval_heldout_v1` 33、`injection_g1_v1` 23、`input_guard_v1` 15、`long_context_v1` 13、`phase1c_selection_v1` 5，合计 751；按 fixture 实测的提交次数 665/33/23/15/**156**/5 = 897（`long_context_v1` 每例 12 轮）。

用例形状 `ExportedAgentInput`（`packages/eval/src/dataset-roundtrip.ts:15-23`）；期望只有 `acceptable_stages` / `data_keys` / `expect_nonempty`（`:25-29`）。多轮用例经 `historyPromptsOf` 变成同一 session 上的 N+1 次提交（`src/case-submissions.ts:49,81`）——进程内它们退化成同一个 store 上的 N+1 个 run，不再是 HTTP。

**用例的作者权还在 Python。** 真相源是 `apps/agent/src/animichi/tests/eval/datasets/*.json`（**九个**文件，六个导出集之外还有 `runtime_journey_v1.json` 与 `translation_v1.json`），经 `run_agent_eval.py --export-dataset` 用 `Dataset.to_file` 导出（`packages/eval/scripts/export-fixtures.sh:36-44`），TS 侧 `Dataset.fromFile` 读；版本成对钉死（`packages/eval/PINS.json`）。`test:fixture-drift` 会重跑这个导出（`packages/eval/package.json:11,14`），CI 为此单独装 uv 与 Python 3.11（`.github/workflows/pr-verification.yml:150-166`）。**W4 删掉 `apps/agent` 的那一刻，eval 包自己的 `test` 就断了。**

### 2.2 评估器与指标

八个评估器名由导出文件序列化、TS 侧注册（`src/evaluator-names.ts:11-20`）。指标列表按位置与 Python 报表对齐（`src/metric-names.ts:31-46`），三列会按跑或按集脱落。两个 model-backed 判官只在 `EVAL_L3` 下追加（`:46`），**TS 侧至今没实现**；Python 侧有，用的正是官方 `LLMJudge` 加两条布尔 rubric（`apps/agent/src/animichi/tests/eval/l3_judges.py:17-35`）。

**参数正确性今天证明不了"参数对不对"**：`OfficialArgumentCorrectness` 比的是同一次调用的 `args` 与 `params` 是否深相等（`src/evaluators/official-argument-correctness.ts:63-74`）——抓的是校验/强转漂移，不是业务上选错作品、坐标或半径。这条限制决定了 §4.4 的用例 schema 必须自带下一步的期望。

### 2.3 门禁与基线

分层配对 bootstrap：种子 309、2000 次重采样、95% 区间（`src/gate/paired-bootstrap.ts:52-54`），最小配对数 10（`src/gate/metric-gate.ts:57`）。`iterations: 2000` 是**重采样次数，不是重复跑次数**。饿死判定单列：starved 占比 > 0.2 判为 outage（`src/gate-run/provider-outage.ts:43`）。退出码两种（`src/gate-run/gate-exit-code.ts:12-13`）。基线由 `eval:baseline:capture` 从**已提交的** result 文件铸（#1515 / PR #1527），它把 `repeat` 硬写成 1（`origin/card/1515-ts-baseline:packages/eval/src/gate-run/baseline-capture.ts:155`）。

### 2.4 把 agent 直接跑起来：现有的接缝与真实缺口（本次实地核查）

**结论：驱动一次回合的接缝在，但打开一次回合的那一半没有进程内实现——那是新写的代码，不是"导出与提升"。**

已经在的：

- **一次回合的装配点是 `SessionTurnParts` → `configuredTurn` → `DurableTurn.run(runId)`**（`workers/edge/src/agent/session/session-turn.ts:170-183,217-241`；`durable-turn.ts:70-72,83-90`）。`configuredTurn` 交出去的是**十三样**端口与值：`store`、`model`、`toolbox`、`answering`、`memory`、`session`、`refs`、`selection`、`systemPrompt`、`prices`、`emit`、`owner`、`now`（`:227-241`）。**回合里没有 intake、没有配额、没有身份、没有限流**——它们在网关侧。
- 但**装配还要一个 `env` 记录**：`CATALOG` 绑定（`:81-87`）、MiMo key（`turnModelFor` `:192-198`）、价格（`usagePricesIn(parts.env)`），并且 `turnToolbox` 里的网页搜索是**真发 egress 的 DuckDuckGo**（`:163` 的 `duckduckgoWebSearcher(webSearchFetch())`）。宿主必须自己构造这个 `env`，网页搜索因此是每次跑的一个非确定性与花费来源（归 **D4**）。
- **数据面是端口，而生产实现已经能离开 Neon 跑**：绑 Neon 的只有外层 `driveQueuedRun`（`session-turn.ts:266-269` 的 `withAgentDatabase`）；`driveOn`（`:257-263`）要的是 `SessionTurnParts`（`env`、`emit`、`owner`、`envelopes`、`queued`、`byok`）**加**一个 `TurnStore`。生产的 `NeonTurnStore` / `NeonTurnRecords` 通过 `AgentTransactions` 端口就能跑在真 PostgreSQL 上（缺口一）。`test/doubles/in-memory-turn-store.ts:1-8` 那个保持 DDL 不变量的内存实现仍供 `test/` 用，但 **eval 不用它**（D5(b)）。
- **envelope 也是端口，且进程内实现已有**：`DurableEnvelopeStore(storage)`（`durable-envelope-store.ts:114-117`）套在 Map 支撑的 `test/doubles/recording-envelope-storage.ts` 上——提升它，不要重造。
- **catalog 是端口**：`CatalogClient` 五个方法（`tools/catalog-client.ts:57-69`），Worker 侧绑定形状只是 `{ fetch: (Request) => Promise<Response> }`（`tools/service-binding-catalog.ts:44-46`）。
- **前缀 seeding 已经是纯函数式的进程内入口**：`seedTrajectoryPrefix(parts, request)`（`prefix-seeding.ts:204-206`，参数与回执 `:100-121`），"**什么都不自己写**，每一行都走真实回合走的端口"（`:1-16`）；HTTP 路由（`gateway/staging-prefix-route.ts:70`）只是它的一个调用者。它需要而路由曾提供的是 `identityId` / `payer` / `owner` / `prices` / `now` 与一对 `SeededSessionRecords`/`TurnRecords`——最后一项正是下面的缺口。
- **两个见证人在进程内更容易拿**：帧从 `emit: TurnFrameSink` 直接收（模型原样吐出的 `args`），已结算参数从 `TurnStore` 写下的 `run_steps` 行直接读（`params`）。

**缺口一（改小了，owner 2026-09-09 定 D5(b) 之后）：打开一次回合，用生产实现。** `DurableTurn.run` 从 `store.loadRunningTurn(runId)` 开始（`durable-turn.ts:83-90`）——它驱动的是一个**已经打开**的 run；打开动作是 intake 的唯一持久写接缝 `TurnRecords.openTurn`（`turn-intake.ts:74-78`），内容是 session 行、按 `client_message_id` 去重的 user message、带 `deadlineAt = now + TURN_DEADLINE_MS` 的 `runs` 行、提交上携带的 `SelectionRequest`，以及给 #1377 重放用的 `earlierSteps`；预算与预留由 `turnFor` 算（`:131-136`），编排在 `acceptTurn`（`:151-158`），生产实现是 `NeonTurnRecords` / `openTurnOn`（`neon-turn-records.ts:198-207`）。

**这一半不需要新写一个进程内实现**：`workers/edge` 已经有一条 agent-db 臂把**生产实现**跑在真 PostgreSQL 上（`package.json:15`，`node --test --test-concurrency=1 "agent-db-test/*.test.ts"`）。它用 `@animichi/test-postgres` 起一次性容器、跑提交进仓的 `migrations/neon` 链，把库暴露成 tier 自己的 `AgentTransactions` 端口（`agent-db-test/postgres-arm.ts:1-19`；生产走 `drizzle-orm/neon-serverless`，这里走 `node-postgres`，"同一 pg-core 驱动、同一 wire 协议、同一 `src/db/schema.ts` 映射，差的只是连接适配器"）。臂里已经在跑的正是我们要的三样：真 `NeonTurnRecords` + `acceptTurn`（`agent-db-test/turn-intake.db.test.ts:19-29`）、真 `NeonTurnStore` + 真 `DurableTurn`（`turn-loop.db.test.ts:20-23`）、真 `seedTrajectoryPrefix` + 真 `NeonTurnRecords`（`trajectory-prefix.db.test.ts:22-24`）。envelope 那一半没有数据库对应物，用真 `DurableEnvelopeStore` 套 Map storage（`agent-db-test/in-memory-envelope-storage.ts:1-9`）。

**所以 H1a 的内容变成"组合"，不是"新写一个多 run 的内存 store"**：把这条臂的装配提升成受支持的宿主，`reservation` 在 eval 里恒为 `null`（`OpenedTurn.reservation`，`turn-intake.ts:71`），并解决三件真正剩下的事——**用例间的隔离策略**（每例新 session id 共用一个已迁移的库，还是每例从 `template1` 起干净库）、**连接池要 ≥ `maxConcurrency`**、以及**容器的生命周期**（eval 一次跑起一个，而不是 agent-db 臂那样一文件一个）。

**缺口二**：`driveOn` 未导出、`driveQueuedRun` 绑死 Neon；进程内宿主的零件住在 `test/doubles/` 里，不是包的受支持出口。

**缺口三**：`packages/eval` 今天只从 `edge-worker` 引一扇 staging 门（`packages/eval/AGENTS.md:3-7`），引 `src/agent/**` 是新的依赖方向，要改包规则（H1b）。

**先例证到哪一步，说清楚**：`test/doubles/make-answered-turn.ts:1-8,83-96` 证明的是**循环**能在普通 Node 里真跑（真 pi 循环、真 `TurnSteps`、真 catalog 工具与 `respond`，只有 provider socket 与 `CATALOG` 是脚本化的；`workers/edge/package.json:10` 就是 `node --test`）。它**不**证明生产装配能在 Node 里跑：它走的是 `makeSessionTurnParts`（`selection: null`，`make-turn-parts.ts:130-139`），没有 `TurnEnvelope.open`，`systemPrompt` 是字面量 `"test"`。宿主必须走 `TurnEnvelope.open` + `configuredTurn` 的完整装配（H1a AC1）。

### 2.5 真空通过与低信噪（#1439 / #1440）

#1439 已合（`6b61f1bc8` / #1456）：`StepEfficiency` 的"零步即满分"分支与选择用例的空链短路都删了；实测那个短路只改变 1 个用例的答案，另外 4 个的空链来自可能陈旧的 stage 表（#1454）。#1440 仍开：文档给的调用形式在 pnpm 10 下跑不起来；`prefix_seeded` 属性设了但没有报表读（`src/staging-turn-task.ts:64` 写、无人读）。两张卡说的是同一件事：**评估装置本身没有被评估过**（`book/chapter7.md:726`）。

## 三、原则与不做的事

原则一（owner ⑤）：**eval 的 task 是 agent 这个 callable**，不是一次部署调用。
原则二（owner ④）：**官方 `logfire/evals` 提供的，一律用它的**；只有它没有、且能说清为什么没有的，才留手写。

不做：改 agent 行为（评测系统先自证）；在 eval 里测网关/身份/限流/CD（归 integration 与 smoke/e2e）；上生产在线评估（evals.md:462）；换评估框架（§10.5 的论证不变）；重开 Python 双跑（#1303 由 #1515 取代）。

## 四、目标形态

### 4.1 执行环境（新，本修订的核心）

一句话：**每个用例 = `agent(input)`，在 Node 进程里跑真模型、真工具、真 catalog，不过网关。**

| 组件 | 取什么 | 依据 |
|---|---|---|
| agent loop | 真的：`DurableTurn.run(runId)`，装配同 `configuredTurn` | `session-turn.ts:217-241`、`durable-turn.ts:84` |
| system prompt / 工具定义 / 模型调用 | 真的（`turnToolbox`、`mimoTurnModel`） | `session-turn.ts:156-167,192-200` |
| 运行时 | **普通 Node**，无 workerd / Miniflare / DO | `workers/edge/package.json:10` 已如此跑真回合 |
| 打开回合 | **生产实现** `NeonTurnRecords` + `acceptTurn`，跑在 test-postgres 上；`reservation` 恒 `null` | `neon-turn-records.ts:198-207`、`turn-intake.ts:71,151-158`；`agent-db-test/turn-intake.db.test.ts:19-29` 已如此跑 |
| 回合存储 | **生产实现** `NeonTurnStore`，跑在 test-postgres 上（**D5** 已定） | `agent-db-test/turn-loop.db.test.ts:20-23` 已用真 `NeonTurnStore` + 真 `DurableTurn` |
| 数据面（回合表） | `@animichi/test-postgres` 的一次性容器 + 提交进仓的 `migrations/neon` 链，经 `AgentTransactions` 端口 | `agent-db-test/postgres-arm.ts:1-19`（生产是 `neon-serverless`，这里是 `node-postgres`，同一 pg-core 协议与同一 `src/db/schema.ts`） |
| session envelope | 真 `DurableEnvelopeStore` 套 Map 支撑的 storage（DO 存储没有数据库对应物） | `durable-envelope-store.ts:114-117`；`agent-db-test/in-memory-envelope-storage.ts:1-9` |
| `env` 记录 | 宿主构造：`CATALOG` 绑定、MiMo key、价格；网页搜索默认真发 egress | `session-turn.ts:81-87,163,192-198` |
| catalog | `env.CATALOG = { fetch }` 指向**本地** catalog（**D4** 已定：`wrangler dev` + test-postgres；`prefix_gate_v1` 脚本化） | `service-binding-catalog.ts:44-46,56-64`、`session-turn.ts:81-87` |
| 数据面（catalog 侧） | 本地 catalog 自己的 test-postgres | `packages/test-postgres`（同一配方） |
| 轨迹前缀 | 进程内 `seedTrajectoryPrefix(parts, request)`，不发 HTTP | `prefix-seeding.ts:204,1-16` |
| 转录 | 帧从 `emit` 收，已结算参数从 store 的 `run_steps` 行读 | §2.4 末条 |
| 网关/身份/限流/Access/CD | **一律不在场** | §零 |

**并发只受模型供应商约束**（owner：并发可以超级加大）。库的 `maxConcurrency`（d.ts:441）是唯一旋钮；上限由卡 **E0** 实测供应商的限流点（`book/chapter7.md:662`：逐步提升并发找限流点、记录 RPM/TPM），不再有每身份 60/60 s 这类我们自己造的天花板。

### 4.2 三个套件（用集合名，不用 L1/L2/L3）

仓库里 "L1/L2/L3" 已有主：`.github/workflows/agent-eval-nightly.yml:3` 的 workflow 名就叫 `Agent Eval (L1 nightly)`，`EVAL_L3` 指两个 model-backed 判官（`metric-names.ts:45-46`）。本文一律用集合名。

| 集合 | 内容 | 触发 | 规模与预算 |
|---|---|---|---|
| **`prefix_gate_v1`** | 轨迹前缀 + 下一步动作验证，每例 1 个被测回合 | 每个 PR（**D10**） | 目标 **60 例**；墙钟目标 **≤ 5 min** |
| **`reliability_v1`** | 端到端小集，`repeat = k`，判据是 **pass^k** | nightly / 里程碑 | 目标 **40 例 × k=5 = 200 runs**；**≤ 20 min** |
| **`profile_v1`** | 淘汰后的全量画像 + 统计门 + 铸基线 | 铸基线、模型/供应商切换 | 目标 **≤ 250 例**；**≤ 45 min** |

**这三个数是预算，不是推导**：`book:758` 描述的是一次**计划中**的复测，`:264` 是人工筛选比例，都算不出 40 或 ≤250。约束是墙钟与模型花费。三个数都是 **D3**，并须满足 **D13** 的分层保留。进程内之后墙钟只由「模型步数 × 并发」决定，60 例单轮在并发 20 下是分钟级。

**单例成本上限**（`book/chapter7.md:636`）分两层，因为库只给一层：断言层 `MaxDuration({ seconds })`（d.ts:653，实现是 `ctx.duration <= seconds`，事后断言不中止）；中止层是我们的超时 + `EvaluateOptions.signal`（d.ts:459）。前提是 `duration` 为纯任务时间——库在信号量获取**之后**才开始计时（bundle 实测：`await u.acquire()` 在 `En()` 之前），所以把并发交给 `maxConcurrency` 是 `MaxDuration` 可用的前置，也顺手关掉 #1476。

### 4.3 官方库能替掉什么（owner 问题 a）

**替掉**

| 手写件 | 官方替代 | 证据 |
|---|---|---|
| `src/in-flight-turns.ts` + `DEFAULT_MAX_CONCURRENCY` | `EvaluateOptions.maxConcurrency` | d.ts:441；evals.md:99 |
| `TURN_SECONDS_ATTRIBUTE` 自计时（#1476 的补丁） | `ReportCase.task_duration`（d.ts:144），在信号量之外计时 | bundle 实测 |
| 无（新增） | `repeat` + `caseGroups()` + `ReportCaseGroup{runs, summary, failures}` → pass^k | d.ts:453、:213、:189-200 |
| 无（新增） | `MaxDuration` | d.ts:653 |
| 无（新增） | `LLMJudge` + `setDefaultJudge`（BYO judge） | d.ts:626；evals.md:157-160 |
| 每例通过与否的判定 | 评估器返回 `boolean` → assertion 通道 + `ReportCaseAggregate.assertions`（d.ts:171）/ `computeAssertionPassRate`（d.ts:202） | evals.md:134 |
| Python 侧导出 + `test:fixture-drift` 的 uv 依赖 | `dataset.toFile(path, { schemaPath })` + YAML 数据集 | evals.md:270、:305 |
| 无（新增纪律） | 全量前 smoke 2–3 例，且先报出用例数与会计费的评估器 | SKILL:84、:97 |

**因 §零 直接删除**：`src/staging-turn-task.ts` 的 HTTP 任务、`src/staging-bearer.ts`、`src/neon-auth-bearer.ts`、`src/case-submissions.ts` 的 chat body 成型、`src/settled-params.ts` 的取回面读取，以及修订 2 里为限流加的**令牌桶**（无限流可言，随之取消）。

**不删、改换输入源**：`src/turn-transcript.ts` 的成型器**留下**——`TranscriptResult` / `transcript-view.ts` 有二十个消费者（`evaluators/*`、`gate-run/*`、`answer-data-keys.ts`、`prior-turn-returns.ts`），删了 C2 与 D1 的评估器就没有输入。走掉的只是它的两个**输入**：`turnFramesOf(sseText)` 与 `GET /messages`；换成 `emit` 收到的 `TurnFrame[]` 与 store 写下的 `run_steps` 行。

**必须新写**：把八个数值指标派生成具名断言的适配层（§4.4 的 `REQUIRED_ASSERTIONS`）——库只认 `boolean`，而今天八个评估器全返回 `MetricRecord = Record<string, number>`（`evaluators/agent-evaluator.ts:25,40`）。

**替不掉（保留手写）**

- **`src/gate/`（分层配对 bootstrap、`metric-gate.ts`、2000 次重采样、种子 309）**：库的 report evaluator 只有 ConfusionMatrix / PrecisionRecall / ROCAUC / KolmogorovSmirnov（d.ts:988-1073），没有配对显著性检验；书要求的正是配对分析（`book/chapter7.md:682`）。
- **`src/gate-run/provider-outage.ts`（改造后保留）**：库只分"成功/抛错"，没有"这一跑被供应商饿死"的概念。进程内之后它的分子只剩**模型供应商**的失败——网关 5xx / 429 / Access 这些来源随 §零 消失，`DEPLOYED_AGENT_TIER` 这个归责名要改成模型供应商。
- **回合超时与重试语义**：`RetryConfig` 只有四个数值项、**没有谓词**（d.ts:424-433），`retryTask` 用 p-retry 包住整个 task，任何抛出都重试；我们的规则是"agent 答出来的一切都是测量结果"。见 **D6**。
- **提交进仓的结果文件**（`src/gate-run/result-file.ts`）：Logfire UI 是核实面，不是审计留档。

**owner 问题 a 的正面回答**：能直接用上的内建能力七项——`maxConcurrency`、`repeat` + `caseGroups`、`lifecycle`、`MaxDuration`、`LLMJudge`、assertion 通道、YAML 数据集与 schema；外加 Node 侧 `@pydantic/logfire-node` 的 `configure()` 打开的 Experiments UI。**用不上的是 `HasMatchingSpan`**（§4.6）。

### 4.4 pass^k 设计（owner 问题 b）

定义（`book/chapter7.md:149`）：同一用例连续运行 k 次、每次都通过，且不触发一票否决项。

机制：`dataset.evaluate(agentFn, { repeat: k, maxConcurrency, metadata })`。bundle 实测：k 次运行共用同一个 `Case` 对象，case 名变成 `"<name> [i/k]"`，`sourceCaseName` 记原名；`caseGroups(report)` 按它归组（d.ts:189-200、:213）。

**每次运行的通过判据用 assertion 通道，但断言今天一条都不存在。** 八个评估器全部返回 `MetricRecord = Record<string, number>`（`packages/eval/src/evaluators/agent-evaluator.ts:25,40`），也就是**分数**，而库只把 `boolean` 记成断言（evals.md:134）。Seat B 用真库复现了后果：只注册 `MaxDuration` 时，`trajectory_match` / `nonempty_results` / `data_keys_present` 五次全 0，旧公式照样答 pass——**"快而错"能通过**。所以：

- **每类用例要有具名的必测质量断言（`REQUIRED_ASSERTIONS`）**，由 A1/B2 从现有分数派生（例：`tool_correctness_pass`、`trajectory_pass`、`data_keys_pass`、前缀用例的 `next_action_pass`、安全集的 `refusal_pass`）。清单按用例类别（前缀 / 端到端 / 安全 / 长上下文）固定在数据集 metadata 里。
- **`MaxDuration` 与 `prefix_seeded` 是装置断言，永远不能替代任务正确性**：它们不在 `REQUIRED_ASSERTIONS` 里，也不单独构成"有断言"。
- 判据要求 `REQUIRED_ASSERTIONS` 的每一条**都存在且都通过**，而不是"断言通过率为 1"。

```
attempts(group)  = group.runs.length + group.failures.length   // 已结束的尝试
passedRuns(group)= group.runs.filter(每条 REQUIRED_ASSERTIONS 都在且都 true).length
requiredFailure  = 该组存在 REQUIRED_ASSERTIONS 名单内评估器的 evaluator_failure
passCaretK(group) =
     attempts === k && group.failures.length === 0 && passedRuns === k && !requiredFailure
       ? "pass"
   : (group.failures.length > 0 || passedRuns < group.runs.length || requiredFailure)
       ? "fail"                       // 已知失败优先
   : "incomplete"                     // 只有真的缺尝试、且没有任何已知失败
```

**为什么把 `completed` 换成 `attempts`**（Seat B 中危）：`group.runs` 只装 `ReportCase`，抛错的运行进 `group.failures`（bundle 实测 `error_type in u ? f.push(u) : d.push(u)`）。旧公式里 5 次全抛错会得到 `runs=0 / failures=5`，`completed < k` 于是判 `incomplete`——把**崩溃**报成**没测**。已知失败必须优先判 `fail`。

**空断言不算通过**：`computeAssertionPassRate` 在一条断言都没有时返回 `null`（d.ts:199-202）；上面的判据比它更严——要求具名清单逐条到齐，所以"一条断言都没写"和"只写了耗时断言"都不是 pass。

**`incomplete` 只留给真的没跑**：`signal` 取消时"尚未开始的运行直接跳过"，既不产生 `ReportCase` 也不产生 `ReportCaseFailure`（d.ts:458-459 + bundle 实测），这才是 `attempts < k` 的唯一正当来源。**分母固定取原始用例清单**（`dataset.cases` 的名字集合），报告单列，**永不计入成功**。

**judge 不得改变核心判决**（Seat B 中危）：D7 说判官是 report-only，但"任何 `evaluator_failures` 都否决"会让**判官缺席**把 pass 翻成 fail——真库已复现。所以否决只对 `REQUIRED_ASSERTIONS` 名单内的评估器生效；判官不在名单里，它的通过 / 拒绝 / 缺席 / 超时都不改变 `passCaretK`。

**分数照旧是分数**：八个数值指标继续供 `profile_v1` 的 bootstrap 门用；assertion 是新加的一路，不改 `metricNames()` 的位置对齐（`metric-names.ts:1-12`）。一票否决项（`injection_g1_v1` / `input_guard_v1` 的拒绝判据）同样表达为断言。

**口径写进报告，也写进 `metadata`**（书 `:160` 要求写清 k 次是独立采样还是流水线上的连续 k 个任务）：取**同一用例 k 次独立采样、各自新 session、并发执行**；k / 口径 / 模型 / commit 经 `EvaluateOptions.metadata` 落到实验 span（d.ts:442-443）。

**种子会话与 `repeat` 的冲突，解法是池化不是配对。** `SeededSessions` 今天按 `inputs` 对象身份记账并拒绝 `repeat`（`src/seeded-sessions.ts:16-19,23-27`），bundle 实测证实 k 次运行拿到同一个 `Case`。但前缀由 inputs 确定性推导（`src/trajectory-prefix-case.ts:20-26`），k 个前缀 session 彼此等价：`setup()` 每次铸新 session 入队，task 出队取一个。进程内之后这变得更便宜——"新 session"只是新 store 键，不再是一次远端写。

k 的取值见 **D1**。

### 4.5 轨迹前缀用例怎么造，以及它的期望是什么

**两种形态，语义不同，不能混为一谈（Seat B 高危 2，已复核）。** 把截断的轨迹**结算成一个更早的 run**、再开一个被测 run，**不等于**继续原轨迹：
- 转录重建时，**更早 run 的工具返回被换成写入时冻结的摘要**，只有本 run 自己的返回是原文（`workers/edge/src/agent/session/turn-transcript.ts:205-216` 的 `verbatimReturn` vs `frozenReturn`，#1378）——Seat B 的探针里一段 300 字的结果变成 26 字。
- refs 只从**本 run 的步骤**复活（`turn-attempt.ts:202` 的 `rehydrateRefs(this.#parts.refs, this.#turn.steps)`），所以在 `search_bangumi` 之后截断、下一步 `plan_route` 引用前缀铸的 ref，会拿到 `stale_ref`。

于是分成两种：
- **历史回合种子（historical seed）**：前缀是**上一轮对话**，被测回合是新一轮。摘要与 ref 失效**都是生产真实行为**，所以这是保真的——今天 `seedTrajectoryPrefix` 做的就是它。
- **回合内 continuation**：前缀是**同一轮**里已经走过的前 n 步，被测的是第 n+1 步。它必须恢复**同一个待执行 run** 的步骤、已铸 refs、环境与上下文，**不另开回合**——书里"只要求 Agent 思考并执行下一步"（`book/chapter7.md:519,531`）说的正是它。这是 H2 要新建的能力，不是 `seedTrajectoryPrefix` 的现状。

两者都要，先后见 **D18**。

**语料一律从 TS agent 自己的轨迹重录，不得复用 Python 的**（owner 2026-09-09）。agent 已经重写过，Python 时代录下的轨迹描述的是另一套 system prompt、另一套工具定义与另一条循环；拿它当"冻结的起点"就是在给新 agent 喂一段它自己从不会产生的历史。所以前缀语料的唯一来源是本节的录制链路（`packages/eval/scripts/record-captures.ts` 的沿革，进程内之后简化为"跑一遍并把帧与 store 行落盘"），六个导出集里的**用例输入**可以继续用，**轨迹不可以**。

**来源**（推荐第一条）：

1. **从真实轨迹裁剪**。录制器 `packages/eval/scripts/record-captures.ts` 今天通过 HTTP 录（`:13-17,53-54`）；进程内之后录制就是"跑一遍并把帧与 store 行落盘"，更简单。做法：跑 → 截前 n 步 → 生成 `steps[]` 形态的 seed → 冻结成 fixture。冻结三件：**对话**、**工具返回**、**环境状态**。这正是书对轨迹前缀任务的定义（`:519`）与那条生产实验的输入构成（`:531`）。
2. 从 `seeded_pending` 推导（今天的 5 例）。保留，但只覆盖"未决澄清"一种起点。

**期望必须新加，因为现有 schema 撑不住。** `ExportedAgentExpected` 只有三样（`src/dataset-roundtrip.ts:25-29`），而 `OfficialArgumentCorrectness` 只比 `args` vs `params`（`official-argument-correctness.ts:63-74`）——选错作品、坐标、半径照样得 1。每个前缀用例的 metadata 增加 `expected_next_action`：

| 字段 | 含义 | 判定 |
|---|---|---|
| `tool` | 下一步该调用的工具名，或 `none` | assertion：`none` = 被测 run 里**没有任何模型发起的步骤**（`TranscriptStep.origin === "model"` 计数为 0；`origin` 由 #1462 落地，`packages/eval/src/turn-transcript.ts:99,111,182-183`）；否则 = 首个模型发起步的工具名相等 |
| `arguments` | 关键参数的**约束**而非字面值：枚举、集合成员、数值区间、地理框 | assertion：逐条满足；无约束的参数不判 |
| `forbidden` | 明确不该出现的工具/参数（可选） | assertion：不出现 |

约束式而非字面值，是因为同一步可以有多个正确写法；集合/区间才是"机器可独立复核的事实"（`book/chapter7.md:224`）。与 `acceptable_stages` 并存，不改后者。

### 4.6 验证器：为什么不是 `HasMatchingSpan`

- `EvaluatorContext.spanTree` 是"`execute {task}` 之下捕获的 span 树"（d.ts:385-390），bundle 里 bucket 只在 `runWithBucket(...)` 内的 OTel context 上生效，而 `setup()` 在它**之前**执行——**前缀 seeding 的 span 永远不在这棵树里**。
- Python 侧那五个 span-based 评估器（`ToolCorrectness` / `TrajectoryMatch` / `ArgumentCorrectness` / `MaxToolCalls` / `MaxModelRequests`，SKILL:106,108）**TS 包里不存在**——`logfire/evals` 只导出 `Contains` / `Equals` / `EqualsExpected` / `IsInstance` / `HasMatchingSpan` / `MaxDuration` / `LLMJudge`（d.ts:472,495,514,553,572,626,653）。
- 进程内之后本可以给 agent 装 OTel 让 span 落进树里——**仍然不做**：轨迹的权威记录是 store 写下的 `run_steps` 行与 `emit` 的帧，它们是产品自己的记录（`book/chapter7.md:224`），而 span 是可选的观测旁路；用旁路当判据会让"没配 OTel"和"agent 没调工具"长得一样。
- **采用**：轨迹与参数的见证人是帧 + store 行；**seeding 是否发生**的见证人是一个自写 `Evaluator`，读 `EvaluatorContext.attributes`（d.ts:378）里的 `prefix_seeded`：声明要前缀而属性缺失即红（关掉 #1440 第 3 条），不需要任何 OTel 接线。

### 4.7 基线语义

- **只有 `profile_v1` 铸基线**（`eval:baseline:capture`，#1515 / PR #1527），四条拒绝理由不变；`repeat: 1` 那一行（`baseline-capture.ts:155`）改为写真实 `repeat`，且 `repeat > 1` 的跑**拒绝**铸基线。
- **基线的身份要重写**：09-07 那份记录是"打已部署 staging"的跑，进程内的跑与它不可配对（配对的含义是两组共享任务与随机条件）。所以进程内套件落地后必须**重铸一次基线**，`note` 里写明被测系统已更换；旧记录归档不删。模型/网关的选择见 **D15**。
- `prefix_gate_v1` 不进统计门：60 例的区间宽到判不了几个点的差异（`book/chapter7.md:680`），判据是断言全绿、逐例硬判。
- **09-07 基线的 `locale_match` 是在 `ja` 固定渲染下测的**（`session-turn.ts:51`，生产同此，D17）：`en` 0.474 / `zh` 0.917 衡量的是模型答复语言，不是工具行的语言。新基线若按 D17(b) 改了 locale 接线，这一列与旧值不可比，必须同批重铸。
- 过渡期语义见 **D11**。

### 4.8 淘汰规则（`profile_v1` 从 662 → 目标 ≤250）

四条规则，每条都在卡里留下被淘汰用例的 id 与理由。**唯一依据是"这个用例或它的验证器有可复核的缺陷"，不是分数低、也不是不稳定**：

1. **真空通过**：该用例的"什么都不做"轨迹在它携带的全部指标上都拿满分（#1439 的形态）。修期望或淘汰。
2. **零判据**：该用例携带的每个指标在实跑中都返回 `{}`（未测量）。
3. **冗余**：同一 `(family, locale, stage)` 单元格内保留 N 例，其余移入 `archive/` 不删。`family` 两步正则：先去掉结尾序号 `/_\d+$/`，再删每一个 locale 段 `/_(ja|zh|en)q?(?=_|$)/g`。对 751 个真实名实测：`A1_ja_001`→`A1`、`HO_loc_zh_jaq_001`→`HO_loc`、`HO_tr_romaji_001`→`HO_tr_romaji`、`G1_001`→`G1`、`D3_multi_success_two`→自身，得 **91 个 family、12 个单例**。只用 `^(.+?)_(ja|zh|en)_\d+$` 会漏掉 46 个名字。`locale` **只取 `inputs.locale`**，永不从名字解析；`stage` 取 `metadata.acceptable_stages`。
4. **单跑与 pass^k 背离 ⇒ 立案调查，不是淘汰。** 独立成功率 p 下天然有 p − p^k 的落差，那正是 pass^k 要暴露的东西。背离最大的一批先按 `book/chapter7.md:726` 查评测系统；查出**用例/验证器缺陷**按 1–3 处置，查出 agent 的真实随机失败则**留在 `reliability_v1`** 并开 agent 侧的卡。**禁止按低分或按不稳定筛除。**

`nonempty_results` 全局 0（§一③）按第 4 条先立卡查验证器。淘汰后还须满足 **D13**。

## 五、决策题（owner）

1. **D1 — pass^k 的 k。** 推荐 **k = 5**（`book/chapter7.md:158`）。备选 k=3；p=0.9 时 Pass^3 = 0.729、Pass^5 = 0.590，差 **13.85 个百分点**。
2. **D2 — pass^k 的口径。** 推荐**同一用例 k 次独立采样、各自新 session、并发执行**，口径写进 `metadata`。
3. **D3 — 三个套件的规模。** 推荐 60 / 40 / ≤250、冗余保留 N=3；是预算不是推导，须满足 D13。
4. **D4 — catalog 与网页搜索从哪来（owner 2026-09-09 已定：(a)）。** 原稿推荐"打真实 staging catalog 的 HTTP 端点"，**这条路不存在**：catalog Worker 刻意没有任何公开入口——`workers/catalog/wrangler.toml:5-25` 把 `workers_dev` 与 `preview_urls` 双双关掉且不声明 routes，每个环境重复一遍（`:99-100,148-149`），并由 `test/wrangler-private.worker.test.ts` 守着；生产适配器打的是私有绑定地址 `https://catalog.internal/catalog/<procedure>`（`service-binding-catalog.ts:56-64`）。所以候选只剩：
    - **(a) 已定：本地起 catalog（`wrangler dev`）+ `packages/test-postgres` 的测试数据面**，宿主的 `{fetch}` 把 `catalog.internal` 改写到本地端口。工具行为是真的，离线可跑，不碰 catalog 的私有边界。
    - (b) 录制/脚本化 catalog：最快最稳，但把 catalog 的漂移挡在视野外——它正是 `profile_v1` 该探测的东西。**推荐用在 `prefix_gate_v1`**（那一档的工具返回本来就是冻结的）。
    - (c) 为 eval 开一条受保护的远端 catalog 通道：要新卡、要可达性验收，且要在一个刻意私有的边界上开口。**不推荐**。
    **网页搜索一并在此决策**：`turnToolbox` 建的是真发 egress 的 DuckDuckGo（`session-turn.ts:163`），每次跑都是非确定性与花费来源。推荐 `prefix_gate_v1` 脚本化、`reliability_v1` / `profile_v1` 走真网。
5. **D5 — 回合存储用哪个（owner 2026-09-09 已定：(b) 真 Postgres）。** owner 的常设规则是**单测之上一律 testcontainers**（"我们跑测试应该大部分都要用 Test Container"），所以回合表走 `@animichi/test-postgres`，**不写内存版多 run store**。这反而让 H1a 变小：生产的 `NeonTurnRecords` / `NeonTurnStore` 已经在 agent-db 臂上跑真库（§2.4 缺口一），宿主是组合而不是重写；12 轮历史与隔离两条 AC 于是测的是**真 store**。**成本说清楚**：一次 eval 跑起一个 Postgres 容器（不是一文件一个，`agent-db-test/postgres-arm.ts:9-12` 那条是测试臂的取舍）；用例间要么每例新 session id 共用一个已迁移的库、要么每例从 `template1` 起干净库（H1a 的卡里定）；连接池必须 ≥ `maxConcurrency`，否则并发被池排队吞掉；`--test-concurrency=1`（`workers/edge/package.json:15`）是**测试臂**的约束，不是 eval runner 的——eval 的并发上限仍由模型供应商与池大小决定。
6. **D6 — 用不用 `retryTask`。** 推荐**暂不用**：`RetryConfig` 无谓词（d.ts:424-433），会把超时与被拒的 seeding 一起重试；且 bundle 实测 `setup()` 在重试包装**之外**只跑一次——进程内也一样，重试会落在**已被上一次尝试写过的 store** 上（旧稿说的"写脏的远端 session"换成了写脏的进程内 store，危害不变）。要用的前置是把 task 的抛出面收窄到只剩"根本没到模型"的失败。
7. **D7 — 引不引 LLM judge。** 推荐**引入但只 report-only**：官方 `LLMJudge` + `setDefaultJudge`（evals.md:157-160），rubric 移植 Python 已有两条布尔 rubric（`l3_judges.py:17-35`）；官方要求布尔/分类优于 1–10 分，且先在 20–100 个人工标注用例上标定（SKILL:105）。只在 `reliability_v1` / `profile_v1` 开。
8. **D8 — 用例作者权迁 TS YAML。** 推荐**迁**，且必须在 W4 删 `apps/agent` 之前（`packages/eval/package.json:11,14` → `scripts/export-fixtures.sh:42`）。YAML 字段名与 Python 兼容（evals.md:305）。附带：三个 Python oracle **冻结成 TS fixture** 继续守。
9. **D9 — 用不用 Logfire hosted datasets。** 推荐**不用**（现在）：要单独的 API key（evals.md:311-315），且 `pushEvaluationDataset()` 每次推送都发空评估器列表、本地删掉的会连带清空线上（evals.md:378-382）。
10. **D10 — eval 在 CI 里的位置与阻断力（改写）。** 进程内之后 eval 跑的**就是候选代码**，所以它是一条普通的 PR lane，**不再需要任何 CD 契约编辑**。待定的是：(a) `prefix_gate_v1` 红是否阻断 PR（**推荐：是**，它是确定性断言，红即回归）；(b) 触发条件（推荐：`workers/edge/**`、`packages/eval/**`、`packages/contract/**` 受影响时跑）；(c) 需要凭据/网络的 lane 在 fork PR 上没有 secret——`prefix_gate_v1` 若按 D4 全脚本化（catalog + 网页搜索）就只差模型 key；否则还要本地 catalog 与真网出口。推荐 fork PR 上跳过并在 merge queue 补跑。部署侧只保留 **E1** 的一条 smoke canary。
11. **D11 — 迁移窗口里"绿"的定义。** 推荐：从 A1 开工到 C3 重铸基线之间，`eval:gate` **只报告不阻断**；D10 的门在新基线铸出后才打开。
12. **D12 — `agent-eval-nightly.yml` 的去向。** 它跑 Python（`uv run --frozen pytest … test_agent_eval.py` 与 `test_translation.py`，`:88-91`），W4 后必死。推荐：**C3 用 `reliability_v1` 的 nightly 替换**，同文件改内容并改名（去掉 "L1"）；同批更新按文件名引用它的两处文档 `docs/ops/deployment.md:510` 与 `docs/ops/secrets.md:104`。
13. **D13 — 三个套件必须保留哪些分层。** 淘汰不得抹掉能力维度。推荐硬约束：`profile_v1` 保留 (a) 三个 locale 各 ≥60 例、(b) 每个 `acceptable_stages` 值 ≥8 例、(c) `injection_g1_v1` / `input_guard_v1` 的安全用例**一例不删**、(d) `long_context_v1` ≥5 例；`reliability_v1` 覆盖三个 locale、≥4 个 stage、≥3 个安全用例。数字待 owner 定。
14. **D14 — `runtime_journey_v1` / `translation_v1` 的去向。** 不在六个导出集里，`translation_v1` 今天由 nightly 跑（`agent-eval-nightly.yml:90-91`）。推荐：**translation 迁移**并入 `profile_v1`，**runtime_journey 归档**。
15. **D15 — 模型注入接缝（改写）。** 原稿把 `workers/edge` 的模型说成 `DEFAULT_AGENT_MODEL`——**引错了**：那个键是 Python 容器的 env（`workers/edge/src/container/container-env.ts:33`）。TS 层是写死的 `MIMO_MODEL_ID = "mimo-v2.5"` on `MIMO_DIRECT_BASE_URL = "https://api.xiaomimimo.com/v1"`（`turn-model.ts:73,78,150-152`），**正是 09-07 记录的身份** `openai:mimo-v2.5@https://api.xiaomimimo.com/v1`，所以"基线身份要不要变"本身不是问题。真正要定的是：**宿主要不要暴露 `TurnModel` 注入接缝**（`DurableTurn` 直接吃 `model`，技术上可以），以及**eval 是否允许跑一个 tier 并不发布的模型**（供应商切换评估、更便宜的判官模型）。推荐：**暴露接缝，但默认值恒等于 tier 的写死值**；跑非默认模型的结果**不得铸基线**，只能进报告，且模型身份写进 `metadata`。
16. **D16 — staging 的前缀 HTTP 路由留不留（新）。** 进程内之后 `POST /v1/staging/sessions/{id}/prefix` 只剩零个调用者（`gateway/staging-prefix-route.ts:70`、`packages/contract/src/staging-prefix-*.ts`）。推荐：**随 #1380 的收尾一起删**——进程内 seeding 落地后它一个调用者都没有，而一条只有测试用过的 staging 写路径不该长期留在网关上。（修订 4 曾把它挂在 canary 上，canary 已移出本 spec。）

17. **D17 — locale 保真（新，Seat A P1-2）。** 生产**从不**把 locale 传进回合：网关读 `x-locale` 只用来挑拒绝文案的语言（`gateway/agent-turn.ts:205` → `chat-envelope.ts:21,61-67`），`TurnSubmission` 没有 locale 字段（`turn-intake.ts:31-56`），每个回合都以 `TURN_LOCALE = "ja"` 打开（`session-turn.ts:51`）。**所以把 `inputs.locale` 接进宿主会让被测系统与生产不一致**，`zh`/`en` 用例会去测一个生产不跑的配置——而"改 agent 行为"是 §三 的非目标。二选一：**(a) 推荐：宿主固定 `ja`**，与生产一致，并在报告里写明；(b) 先做一张产品卡把 locale 经 `TurnSubmission` → `TurnEnvelope.open` 打通，**落在 H1a 之前**。**owner 2026-09-09 定 (a)。** 答复语言是**提示词驱动**的——产品规则是「聊天跟随用户输入的语言」，由用户文本决定，不受这里影响；`TURN_LOCALE` 只用来渲染工具返回行里的地名（`session-turn.ts:42-51` 的注释就是这么写的）。所以 `locale_match` 仍是一个有意义的指标，只有行内地名恒为 `ja`。
18. **D18 — 前缀语料的两种形态（新，Seat B 高危 2）。** 见 §4.5：历史回合种子与回合内 continuation 是两件事，`prefix_gate_v1` 主要要哪一种、以及要不要两种都做，由 owner 定。推荐：**两种都要，但先做 continuation**——它才是书里"只要求 Agent 执行下一步"的形态。

**已从决策列表移除**：旧 D5/D15（QA 身份）、旧 D14（429/409）、旧 D10 的 CD 契约编辑——随 §零 消失；**旧 D13（每跑花费上限）owner 2026-09-09 定为"暂不设"**，记入 §八 风险跟踪，不再是决策项。

## 六、分卡

一卡一 worktree 一 PR；`needs` 是硬依赖。test-type：`unit | integration | eval | api | browser | ci`。

| 卡 | 范围 | needs |
|---|---|---|
| **H1a** 进程内回合宿主：导出装配 + 把生产 `NeonTurnRecords`/`NeonTurnStore` 组合到 test-postgres 上 | `workers/edge` | — |
| **H1b** `packages/eval` 依赖方向规则 + 宿主消费 spike（并入 E0） | `packages/eval` | H1a |
| **H2** 历史回合种子 + 回合内 continuation + 多步前缀 | `workers/edge`、`packages/contract` | H1a |
| **E0** 进程内 spike（含 H1b）+ 供应商限流实测 | `packages/eval` | H1a |
| **A1** 采用官方 evaluate options，删 HTTP 任务链 | `packages/eval` | E0 |
| **A2** pass^k：`repeat` + `caseGroups` + session 池 + 完整性判定 | `packages/eval` | A1 |
| **A3** 实验上报 + 前缀见证 | `packages/eval` | A1 |
| **B2** 前缀语料生成器 + `expected_next_action` + `REQUIRED_ASSERTIONS` schema | `packages/eval` | H2、A1 |
| **C1** 用例作者权迁 TS YAML + oracle 冻结 | `packages/eval`、`apps/agent`、`.github/workflows` | A1 |
| **C2** 淘汰与分集 | `packages/eval` | C1、A2、B2 |
| **C3** 重铸基线 + 三条 lane 接线 | `packages/eval`、`.github/workflows` | C2 |
| **D1** LLM judge（report-only） | `packages/eval` | A3、C2 |

**H1a 验收**
- [ ] **(unit)** `workers/edge` 导出一个受支持的进程内回合宿主，走 `TurnEnvelope.open` + `configuredTurn` 的**完整装配**（十三样 + 宿主构造的 `env`），返回一次 `DurableTurn.run()` 的结果。`driveOn`（`session-turn.ts:257-263`）的组合逻辑**不得复制**——它是"一次回合是什么"的唯一定义。
- [ ] **(unit)** **孪生规则：一次回合怎么"打开"也只能有一个定义。** 宿主用**生产实现** `NeonTurnRecords` + `acceptTurn`（不是另写一个内存版），因此 `turnFor` 的 deadline 与预留、网关那套 submission→`SelectionRequest` 解析都是原样复用；`reservation` 在 eval 里恒为 `null`（`turn-intake.ts:71`）。变异：绕过 `acceptTurn` 自己插 `runs` 行，测试红。
- [ ] **(integration)** 宿主跑在 `@animichi/test-postgres` 的一次性容器 + 提交进仓的 `migrations/neon` 链上，经 `AgentTransactions` 端口（照 `agent-db-test/postgres-arm.ts:1-19` 的配方），**一次 eval 跑起一个容器**而不是一文件一个。
- [ ] **(integration)** **连续 12 轮**（`long_context_v1` 的形状）：同一 session 上连续开 12 个 run，第 12 轮的模型上下文里**确实**有前 11 轮的答复与工具结果；变异：让宿主每轮换新 session，测试红。
- [ ] **(integration)** **会话隔离**：并发跑的两个用例读不到彼此的 session、run、refs 与 envelope；隔离策略（每例新 session id 共用库 / 每例干净库）写进卡并有测试钉住。
- [ ] **(unit)** 连接池大小 ≥ `maxConcurrency`，且这条关系有断言；变异：把池设成 1、并发设成 4，测试红（暴露排队被记成回合耗时）。
- [ ] **(unit)** envelope 用真 `DurableEnvelopeStore`（`durable-envelope-store.ts:114-117`）套 Map storage（`agent-db-test/in-memory-envelope-storage.ts:1-9`），不重造。
- [ ] **(integration)** 宿主在**普通 Node** 下跑通一次真回合（脚本化 provider + 按 D4 的本地 catalog），不引入 workerd / Miniflare / DO 依赖；`workers/edge/test/*.test.ts` 现有 **159 个文件**与 agent-db 臂全绿、无一份复制品。
- [ ] **(unit)** locale 固定 `ja`（**D17**），有一条测试钉住"宿主不接受 per-case locale"。

**H1b 验收**
- [ ] **(api)** `packages/eval/AGENTS.md:3-7` 的依赖规则更新：允许从 `edge-worker` 引 agent 宿主；`packages/eval` 仍不进 Workers bundle，仍不引 `gateway/**`。
- [ ] **(unit)** `packages/eval` 侧一次最小消费（一个用例跑通），证明依赖方向可用；与 E0 同 PR。

**H2 验收**
- [ ] **(unit)** **历史回合种子**：`seedTrajectoryPrefix`（`prefix-seeding.ts:204-206`）在进程内可直接调用，走真实端口（`:1-16` 的性质不变）；被测回合看到的前缀工具返回是**写入时冻结的摘要**，与生产一致（`turn-transcript.ts:205-216`）。
- [ ] **(unit)** **回合内 continuation（新能力）**：恢复的是**同一个待执行 run** 的步骤、已铸 refs、envelope 与上下文，**不另开回合**。等价性验收两条：(i) 前缀止于 `search_bangumi`、下一步 `plan_route` 引用前缀铸的 ref ⇒ **不得** `stale_ref`（今天会，因为 `turn-attempt.ts:202` 只从本 run 步骤复活 refs）；(ii) 一段 ≥300 字的工具返回在被测步骤的上下文里**逐字**还原，不是摘要。变异：改回"结算成上一个 run 再开新 run"，这两条测试红。
- [ ] **(unit)** 前缀请求类型增 `steps[]`（可加式，缺省读作今天的单步形态，`staging-prefix-contract.ts:112-119`）；多步历史种子写成**一个终态 run**，不违反 `runs_one_running_per_session`（`migrations/neon/20260902000000_agent_runs.sql:84`）；变异：留在 `running`，测试红。

**E0 验收**
- [ ] **(eval)** 一次真模型 + 按 **D4** 接线的 catalog 的进程内跑（33 例 heldout），报告：单例墙钟分布、模型步数、并发 1/4/16/64 各一档的墙钟与失败率。
- [ ] **(eval)** 供应商限流点实测：逐步提升并发直到出现供应商侧拒绝，记录 RPM/TPM 与拒绝码（`book/chapter7.md:662`）；结论写成 `maxConcurrency` 的默认值。
- [ ] **(unit)** 供应商拒绝被归类为 provider outage（`provider-outage.ts:43` 的口径），归责名从"已部署 agent tier"改为模型供应商；变异：把它算成用例失败，测试红。

**A1 验收**
- [ ] **(unit)** `dataset.evaluate` 的 task 是进程内 agent 调用；`staging-turn-task.ts` / `staging-bearer.ts` / `neon-auth-bearer.ts` / `in-flight-turns.ts` / `settled-params.ts` 从 `src/` 删除（`git grep` 为空）。
- [ ] **(unit)** `turn-transcript.ts` 的成型器**保留**，输入换成 `emit` 的 `TurnFrame[]` + store 的 `run_steps` 行；`TranscriptResult` 的二十个消费者一行不改，`transcript-view.ts` 的形状不变。
- [ ] **(unit)** 断言适配层落地：八个数值指标各自派生出具名布尔断言，`REQUIRED_ASSERTIONS` 按用例类别从数据集 metadata 读。变异一：让 agent "又快又错"（分数全 0、耗时极短）⇒ 该例 **fail**（旧公式会 pass）。变异二：删掉某个质量评估器 ⇒ 该例 **fail**（缺项不是通过）。
- [ ] **(unit)** `maxConcurrency` 由参数传入；**用受控时钟与可控阻塞的假任务证明"等信号量的时间不进入 `task_duration`"**（不用比值验收）。
- [ ] **(unit)** `MaxDuration` 作为 dataset 级评估器注册；超时但成功的用例产出失败断言而非 task 失败；中止仍由超时 + `signal` 负责，变异：删掉中止路径，测试红。
- [ ] **(eval)** 33 例真实跑：分别报告任务时间、排队、setup、评估耗时；每个 `task_duration` ≤ 超时上限，`max(task_duration)` ≤ 墙钟，Σ ≤ 墙钟 × 并发。

**A2 验收**
- [ ] **(unit)** `repeat: k` 下每组 `runs.length + failures.length === k`；`passCaretK` 只在 `attempts === k && failures === 0 && passedRuns === k && 无必测评估器失败` 时为 pass。
- [ ] **(unit)** **抛错不是 incomplete**：k 次任务全抛错 ⇒ `runs=0 / failures=k` ⇒ 判 **fail**（真库探针里旧公式判 incomplete）。变异：把 `failures` 从 `attempts` 里去掉，测试红。
- [ ] **(unit)** **judge 不改判决**：判官通过 / 拒绝 / 缺席（抛 `evaluator_failures`）/ 超时四种情况下，`passCaretK` 的值都不变；变异：把否决扩到全部 evaluator failure，"判官缺席"那条红。
- [ ] **(unit)** **一个没有任何断言的用例永远不是 pass**（`computeAssertionPassRate` 无断言返回 `null`，d.ts:199-202）；变异：删掉"断言数 ≥ 1"的检查，测试红。
- [ ] **(unit)** **取消路径**：排队中 abort 后未启动的运行既无 `ReportCase` 也无 `ReportCaseFailure`（d.ts:458-459），该组判 `incomplete`；分母取自原始用例清单。变异：把 `incomplete` 当 pass，测试红。
- [ ] **(unit)** 前缀 session 池：k 次 `setup()` 铸 k 个不同 session，k 次 task 各取走恰好一个。
- [ ] **(eval)** `phase1c_selection_v1` 5 例 × k=5 的真实跑：结果文件带 `repeat: 5`、`pass_caret_k`、`incomplete` 三列。

**A3 验收**
- [ ] **(unit)** 自写 `Evaluator` 读 `EvaluatorContext.attributes.prefix_seeded`（d.ts:378）：声明要前缀而属性缺失 ⇒ 红（#1440 AC3）。**不使用 `HasMatchingSpan`**（§4.6）。
- [ ] **(integration)** 用**真实的库 lifecycle** 跑一遍该路径（不是替身）。
- [ ] **(unit)** 加入 `@pydantic/logfire-node` 并 `configure()`（evals.md:26-35）——`logfire@0.22.5` 只导出 `configureLogfireApi`，该包**不在** `pnpm-lock.yaml` 里；或改用 `getEvalsSpanProcessor()` 挂自有 provider（evals.md:523-525）。AC 含 lockfile 变更核对。
- [ ] **(integration)** 配置后实验根 span 名为 `evaluate {name}`、带 `gen_ai.operation.name = 'experiment'`（SKILL:120）；未配置时显式提示结果未上传（官方指出这是静默的，SKILL:10）。
- [ ] **(unit)** 报表与结果文件带每例 `prefix_seeded`（#1440 AC2）；`metadata` 带 k、口径、模型、commit。
- [ ] **(unit)** 文档写的调用形式就是能跑的那个，且有测试跑它（#1440 AC1）。

**B2 验收**
- [ ] **(eval)** 跑 → 截取 → seed → 继续 的闭环 ≥10 例，冻结 fixture 与回放逐字相等。
- [ ] **(unit)** `expected_next_action` schema 落地并进 YAML 往返。
- [ ] **(unit)** **变异：工具名正确但关键参数越界**（换作品 id / 半径超区间 / 坐标出框）⇒ 该例红。`OfficialArgumentCorrectness` 自己抓不到（`official-argument-correctness.ts:63-74`）。

**C1 验收**
- [ ] **(unit)** 六个集合以 YAML + JSON schema 提交，`Dataset.fromFile` 读回后与写入前深相等；八个评估器各有稳定 `static evaluatorName`，带构造参数的实现 `toJSON()`（evals.md:305-309）。
- [ ] **(unit)** `packages/eval` 的 `test` 不再调用 `uv` / `apps/agent`；`export-fixtures.sh` 的 Python 臂与 `pr-verification.yml:150-166` 的 uv 安装一并删除。
- [ ] **(unit)** 三个 oracle 冻结为 TS fixture，数值与今天的 Python 产物逐位相等。
- [ ] **(unit)** D14 的处置落地。

**C2 验收**
- [ ] **(unit)** 四条淘汰规则各有测试；淘汰清单提交进仓；**规则 4 只立案不淘汰**，变异：让它直接删用例，测试红。
- [ ] **(unit)** D13 的分层约束是机器判据，任何一档不满足即红。
- [ ] **(eval)** `nonempty_results` 全局 0 的成因有书面判定，证据是转录与 store 行。
- [ ] **(unit)** 三个集合的用例数与 `dataset-sets.ts` 的钉子一致（沿用今天的 tripwire，`src/dataset-sets.ts:1-8`）。

**C3 验收**
- [ ] **(unit)** `baseline-capture` 写真实 `repeat`；`repeat > 1` 的跑被拒绝铸基线。
- [ ] **(eval)** 一次 `profile_v1` 进程内跑铸出新基线，`note` 写明被测系统已从"已部署 staging"改为"进程内 agent"，旧记录归档不删。
- [ ] **(ci)** 三条 lane 按 **D10** 接线：PR lane 按受影响包触发、`prefix_gate_v1` 红即阻断、fork PR 跳过并在 merge queue 补跑；**`cd.yml` 与三个 CD 契约测试一行不改**（`git diff` 为空即证据）。
- [ ] **(ci)** `agent-eval-nightly.yml` 按 **D12** 处置，Python 两步删除后 workflow 仍绿；`grep -rn agent-eval-nightly docs/` 无陈旧引用。

**D1 验收**
- [ ] **(unit)** `setDefaultJudge` 注入判官；**判官缺席时 `LLMJudge.evaluate` 抛出**（bundle 实测："LLMJudge: no judge callback provided"），该例落一条 `evaluator_failures`、既无分数也无断言（evals.md:140-141），report-only 列读作未测量——不是 0 也不是 1。
- [ ] **(eval)** 判官在 20–100 个人工标注用例上的标定结果写进卡（SKILL:105）；未标定前不进任何门。
- [ ] **(unit)** 两条 rubric 是布尔的。

## 七、非目标与取代关系

**非目标**：改 agent 行为；在 eval 里测网关/身份/限流/CD；生产在线评估；换统计门；扩大安全语料。（回合表的持久化因 D5 走真 Postgres，但那是为了让被测的 store 是生产实现，不是为了测数据库。）

**移交 smoke，不在本 spec 内**：修订 4 曾把"一条打到已部署 staging 的端到端 canary"写成卡 E1 并配了一条决策。owner 2026-09-09 问它跟 eval 有没有关系——**没有**：eval 的被测系统是 agent（§零），部署活没活是 smoke 的事。因此 canary 的形态、凭据与 CD 契约问题**整条移出本 spec**，归 staging smoke 那条线（`.github/scripts/staging-smoke-check.sh` 与 #1198 的沿革）。本 spec 之后**不保留任何 staging 路径**；`POST /v1/staging/sessions/{id}/prefix` 的去留因此只剩 D16 一个问题。

**取代**：

- ts-rewrite spec §五 W3 出口判据里的"662 例双跑无回归"**作废**——owner 中断了那次跑，Python 记录已由 #1515 的 TS 自铸基线取代。新出口判据：**`prefix_gate_v1` 全绿 + `reliability_v1` 的 `pass_caret_k_rate` 有首个记录在案的值 + `profile_v1` 铸出一份进程内基线**。#1303 关闭为"被取代"。
- §十 10.1 第二档（把 76 个用例改造成轨迹前缀）被 §4.5 取代：不改造那 76 个，而是从真实轨迹新造语料。
- §十 10.2（第二见证人：取回面发布已结算参数）**在 eval 这一侧不再是必需**——进程内直接读 store 的 `run_steps` 行。它对**断线后的复核**仍有产品价值，去留归 #1381 自己，不再是 eval 的前置。
- §10.3 / §10.4 保留且仍 report-only，位置在 `profile_v1` 之内；§10.5 保留。
- #1309 / #1311 已关闭。**#1380 仍 OPEN**，是 H2 的前置；它的 HTTP 一半的去留见 **D16**。#1439 已合；#1440 三条 AC 并入 A3。#1515 / PR #1527 是 C3 的上游。

## 八、风险

- **进程内跑不到的东西会没人测**：网关、身份、限流、DO 持久化、CD。缓解：它们本来就有 integration 测试与 `staging smoke`；E1 的 canary 是最后一道。**这条要在 C3 合入时复核一遍覆盖，不能默认它成立。**
- **前缀语料会腐坏**：冻结的工具返回与真实 catalog 漂移后，`prefix_gate_v1` 就在测一个不存在的世界。缓解：录制可重跑、清单记录日期；`profile_v1` 用真 catalog（D4a），是漂移的探测器。
- **花费没有上限**（owner 2026-09-09 定为暂不设）：`reliability_v1` 每晚 200 次模型回合、`profile_v1` ≤250 次 + 判官。缓解：`src/gate-run/run-spend.ts` 继续**记录**每跑花费，攒够数据后再由 owner 决定是否设限。
- **并发加大后打爆供应商**：缓解 E0 的实测限流点 + `provider-outage.ts` 的 20% 上限。
- **H1a 若复制了 `driveOn` 或 `turnFor` 的逻辑**，就出现了第二个"一次回合是什么 / 怎么打开"的定义。缓解：H1a 前两条 AC 就是禁止复制。
- **catalog 的私有边界**：D4(c) 会在一个刻意关死的边界上开口（`workers/catalog/wrangler.toml:5-25` + `test/wrangler-private.worker.test.ts`）。缓解：默认取 (a) 本地 catalog，不碰它。
- **断言适配层写错就等于没有门**：八个指标今天全是分数，派生断言的阈值一旦定松，"快而错"照样通过。缓解：A1 的两条变异验收。
- **每次 eval 跑一个 Postgres 容器**（D5(b)）：启动预算 60×1 s（`AGENT_DB_SETUP_BUDGET`，`packages/test-postgres/src/setup-budget.ts:50-54`），并发跑还要池 ≥ `maxConcurrency`。缓解：容器一次跑起一个而不是一文件一个；H1a 有池与隔离两条 AC。若实测启动或隔离成本压过 `prefix_gate_v1` 的 5 分钟预算，回头找 owner 重议 D5。
- **LLM judge 引入新的不稳定源**：D7 的 report-only + 标定前置。
- **C1 与 W4 的顺序反了就断门禁**：C1 是 W4 的硬前置，写进 W4 的 needs。

## 附录 · 评审与修订历史

**修订 5（owner 2026-09-09 的四项裁决）**：D4 按推荐定案（本地 catalog + `packages/test-postgres`，`prefix_gate_v1` 脚本化）；**D5 反向定案为 (b) 真 Postgres**——owner 的常设规则是单测之上一律 testcontainers，于是 §2.4 缺口一与 H1a 从"新写一个内存多 run store"改成"把生产的 `NeonTurnRecords`/`NeonTurnStore` 组合到 test-postgres 上"，因为 `workers/edge` 的 agent-db 臂已经这么跑了（`package.json:15`、`agent-db-test/postgres-arm.ts:1-19`、`turn-intake.db.test.ts:19-29`、`turn-loop.db.test.ts:20-23`、`trajectory-prefix.db.test.ts:22-24`），成本（一次跑一个容器、隔离策略、池 ≥ 并发）写进 D5 与 H1a；**staging canary 与旧 D18 整条移出本 spec**（owner：它跟 eval 无关，是 smoke 的事），卡 E1 随之删除，决策重编为 D1–D18；§4.5 明确前缀语料**只能从 TS agent 自己的轨迹重录**，Python 时代的轨迹一律不复用；D17 维持 `ja` 固定并补一句"答复语言由用户输入驱动，不受影响"。

**修订 4** 在修订 3 之上折入 Seat A r4 与 Seat B r3 两席意见（处置见下两段），其中三条改变了设计：D4 的 catalog 接线、前缀的两种形态、pass^k 的必测断言。

**修订 3（owner 2026-09-09 的前提变更）**：owner 把**被测系统**从"已部署的 staging"改成"agent 本身（system prompt / 工具定义 / agent loop / 模型调用）"，理由是测试金字塔——网关、身份、限流、DO、CD 各有更便宜的测法，eval 该坐在 integration 与 E2E 之间、又多又快。本次修订据此新增 §零 与 §4.1，并**删除**了修订 1/2 中为旧前提写的全部内容：每身份 60/60 s 限流分析、限流探针卡 A0、令牌桶、QA 身份扩容（旧 D5/D15）、429/409 语义（旧 D14）、CD 契约编辑与 `superseded`（旧 D10(a)）、`staging-bearer` 凭据链。旧 D13（花费上限）按 owner 指示改为"暂不设"，移出决策列表、记入 §八。决策题重编为 D1–D16，其中 D4（catalog 来源）、D5（回合存储）、D15（基线的模型身份）、D16（前缀 HTTP 路由去留）是本次新增。§2.4 是对"能不能直接把 agent 跑起来"的实地核查。修订 3 当时的结论是"接缝基本都在、剩下的是导出与提升"，**这一句被 r4/r3 两席一起证伪并已改写**：驱动一次回合的接缝确实都在，但**打开**一次回合的那一半（`TurnRecords.openTurn`）没有进程内实现，`InMemoryTurnStore` 又是单 run 的——那是新写的代码（§2.4 缺口一、H1a）。修订 3 说的"十二样"实为十三样，且装配还要一个 `env` 记录。**两轮评审的结论中，凡不依赖旧前提的都原样保留**：assertion 通道与三态 pass^k、`expected_next_action` schema、淘汰规则 4 只立案不淘汰、`family` 正则、空断言守卫、`HasMatchingSpan` 的否决、C1 先于 C2、`retryTask` 的否决（理由改写为进程内 store 被写脏）。

**Seat A r4（对修订 3 的全量复审）`APPROVE-WITH-CHANGES`：3 条 P1 + 8 条 P2 全部采纳。** P1-1 **intake 那一半是新写的代码，不是"导出与提升"**——`DurableTurn.run` 从 `store.loadRunningTurn` 起步（`durable-turn.ts:83-90`），打开 run 是 `TurnRecords.openTurn`（`turn-intake.ts:74-78`、`turnFor :131-136`、`acceptTurn :151-158`、生产 `neon-turn-records.ts:198-207`），而进程内今天没有实现（`InMemoryTurnStore` 单 run 且无 `openTurn`，`in-memory-turn-store.ts:63`；唯一的进程内 `TurnRecords` 什么都不写，`make-prefix-seeding.ts:52-60`）→ §2.4 改写出"缺口一"，H1 拆成 H1a/H1b，加"打开回合也只有一个定义"的孪生规则，`reservation` 恒 `null`（回答该席 Q4）。P1-2 locale → **D17**（生产从不把 locale 传进回合，接进去会让 SUT 偏离生产），从 H1 AC 移出。P1-3 E1 自相矛盾 → **D18**（并查明 staging `ANON_ACCESS_ENABLED = "true"`，`workers/edge/wrangler.toml:501`；Turnstile secret 的身份仓库里查不到，须 owner 或探针确认）。P2 全采纳：`turn-transcript.ts` 改为**换输入源而非删除**（二十个消费者）；"十二样"改**十三样**并补 `env`（`CATALOG` / MiMo key / prices）与**真发 egress 的 DuckDuckGo**（`session-turn.ts:163`）→ 并入 D4；先例 `make-answered-turn.ts` 只证明**循环**能在 Node 跑（`selection: null`、无 `TurnEnvelope.open`、`systemPrompt: "test"`）；**D15 引错已改**（`DEFAULT_AGENT_MODEL` 是 Python 容器的键，`container-env.ts:33`；TS 层写死 `turn-model.ts:73,78,150-152`）→ 重构为"模型注入接缝"；H2 去掉 `needs #1380`；补 `DurableEnvelopeStore` + `RecordingEnvelopeStorage`；精度项（`driveOn` 还要 `SessionTurnParts`、159 个测试文件、`durable-turn.ts:70-72,83-90`、`TURN_LOCALE` 在 `:51`）逐条改。

**Seat B r3（Codex）`needs-attention`：6 条全部采纳，其中 3 条改变了设计。** 高危 1：**staging catalog 没有任何公开 HTTP 入口**——`workers/catalog/wrangler.toml:5-25,99-100,148-149` 关掉 `workers_dev` 与 `preview_urls` 且无 routes，由 `test/wrangler-private.worker.test.ts` 守着，适配器打的是私有 `catalog.internal`（`service-binding-catalog.ts:56-64`）→ **D4 整条改写**，默认改为本地 catalog + 测试数据面。高危 2：**把截断轨迹结算成上一个 run 不等于继续**——更早 run 的工具返回会被换成冻结摘要（`turn-transcript.ts:205-216`），refs 只从本 run 步骤复活（`turn-attempt.ts:202`），于是 `search_bangumi` 后截断会让 `plan_route` 拿到 `stale_ref` → §4.5 拆成**历史回合种子**与**回合内 continuation**，H2 加两条等价性验收，取舍归 **D18**。高危 3：**`MaxDuration` 能独自满足"有断言"**——八个评估器全返回 `MetricRecord = Record<string, number>`（`evaluators/agent-evaluator.ts:25,40`），真库复现"分数全 0 仍 pass"→ §4.4 引入 `REQUIRED_ASSERTIONS`（具名、逐条到齐、装置断言不得替代），A1 加"快而错"与"删评估器"两条变异。中危 4 与 Seat A P1-1 同源，并入 H1a（12 轮历史累积、会话隔离）。中危 5：`completed` 只数 `ReportCase`，抛错会被误判 `incomplete` → 判据改用 `attempts = runs + failures`，已知失败优先判 `fail`。中危 6：report-only 判官缺席写 `evaluator_failures` 会翻转 pass → 否决只对 `REQUIRED_ASSERTIONS` 名单内的评估器生效，A2 加"判官四态不改判决"的 AC。该席确认前四条 high 与三条 medium 已解决或随前提失效。

**Seat A（Fable）r1 `APPROVE-WITH-CHANGES`：7 条 P1 全部采纳** —— (1) PR 门 → 旧 D10（本修订后坍缩为普通 PR lane）；(2) A0 探针 ≥2 个窗口 + seeding 不计数（**随 §零 作废**）；(3) `HasMatchingSpan` 整体退出，改 `ctx.attributes` 自写评估器（§4.6、A3，**保留**）；(4) C1/C2 顺序对调（**保留**）；(5) 通过判据改 assertion 通道（§4.4，**保留**）；(6) 套件改用集合名 + nightly 归 D12（**保留**）；(7) §一① 改写（**保留**）。**8 条 citation corrections 全部照改**（`ReportCase.task_duration` d.ts:144；重试规则 `staging-turn-task.ts:17-22`；`STAGING_APP_ENV` 在 `staging-prefix-path.ts:34`；rubric `l3_judges.py:17-35`；09-07 跑已完成 2.4 h；`SESSION_BUSY` 改为真实 wire 码 409 `session_not_empty`；原生窗 `wrangler.toml:627-632`；`configure()` 属 `@pydantic/logfire-node`；hosted 覆盖引 evals.md:378-382；#1380 仍 OPEN）。

**Seat B（Codex，`gpt-6-astra` high；`adversarial-review` 子命令不暴露 model 旗标，policy 的 `gpt-5.6-sol` xhigh 未生效——记录在案）`needs-attention`：4 条 high 全部采纳** —— (1) PR 门与被测版本证明（**§零 之后自然成立：eval 跑的就是候选代码**）；(2) 取消/未启动运行 → `incomplete` 三态与固定分母（**保留**）；(3) `expected_next_action` schema + 参数越界变异 AC（**保留**）；(4) 淘汰规则 4 改为"立案不淘汰"（**保留**）。3 条 medium 已采纳（setup span、探针窗口隔离、±15% 改受控时钟）。**3 条 citation corrections 照改**：p=0.9 时 Pass^3−Pass^5 = 13.85 点；`book:758` 是计划中的复测；`book:264` 不作为 ≤250 的推导。两条提问转为 **D13**（分层保留）与 §4.5 的 schema。

**Seat A 复核轮（r2）：1 条 P1 + 3 条 P2 全部采纳** —— P1：旧 D10(a) 的三处 CD 契约编辑写明（`test_cd_shape_contract.rb:39` 的 `CHAIN`、`test_cd_credential_boundary_contract.rb:148-153,226-230` 的 ESC 与 Access 边界、`test_cd_staging_chain_contract.rb:123-127` 的 smoke-last），**本修订后整条随 §零 作废**，C3 改为"CD 一行不改"。P2-1 `family` 正则与 751 名实测（**保留**）；P2-2 空断言守卫（**保留**）；P2-3 `tool: none` 用 `TranscriptStep.origin` 定义（**保留**）；nightly 文件名的两处文档引用（**保留**，D12 与 C3）。

**Seat A r1 的 P2 处置**：P2-1 并发≠速率（**随 §零 作废**）。P2-2 `configure()` 归属 → 采纳（A3）。P2-3 判官不可用 → 采纳（D1 验收）。P2-4 ±15% → 采纳（A1）。P2-5 workflow 范围与 `workflow` scope → 采纳（C1/C3）。P2-6 #1380 仍开 → 采纳（H2 `needs`）。P2-7 两个 Python 数据集 → 采纳为 **D14**。P2-8 `metadata` → 采纳。P2-9 YAML 往返前提 → 采纳（C1）。P2-10 两层限流（**随 §零 作废**）。P2-11 `模板` 机器可读 → 采纳。P2-12 746+5 → 采纳。**两轮评审无一条驳回；本修订作废的项，作废原因都是 owner 的前提变更，不是评审意见被推翻。**
