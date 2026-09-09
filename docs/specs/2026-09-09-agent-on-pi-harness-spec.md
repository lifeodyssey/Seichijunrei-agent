# Spec — agent 建在 pi harness 上（彻底重写）

- Status: Draft 修订 14 — 已过 Seat A 两轮（r1 的 5 P1 + 11 P2、r2 的 6 条文字残留全部折入），并折入 owner 2026-09-09 的裁决（§八 的赌注接受、D2–D15 定案、D3 定 (b)、D7 的「能用 eval SDK 的就不手写」、**D1 重开并按 owner 的 worker/DO 提议改成协调者–执行者拆分**）。待 Seat B（Codex）与 owner 终签。
- owner 定案（2026-09-09）：**「彻底重写，能用 pi 的就用 pi，eval 和单测需要重新考虑」**；eval 不要数据库；**所有工具调用都要真的**（web search 的不稳定可接受）。
- 事实基线：worktree `.worktrees/card-eval-redesign`，base `origin/main` a00edadf8。上游读自 clone `/tmp/pi-upstream`（HEAD `6160683a`，工作树 = 0.85.1 之后、0.85.2 之前，见 `/tmp/pi-repo-research.md:3-7`）与已发布 tarball `…/tmp.MlXLBM6Gg1/package`（`@earendil-works/pi-agent-core@0.85.1`）。仓库断言带 `path:line`；上游文档断言带 `packages/agent/docs/harness.md:LINE`（相对 `/tmp/pi-upstream`）；已发布类型断言带 `dist/**.d.ts:LINE`（相对 tarball）。
- 取代：`docs/specs/2026-09-01-agent-ts-rewrite-spec.md` 的 §五 W3、§十 与**它的第 16 行非目标**；以及 `docs/specs/2026-09-08-eval-suite-redesign-spec.md` 全文（见 §十一）。

## 一、动机

**我们把上游已经写成规范的那一层，自己写了一遍。** 今天 `workers/edge/src/agent/` 有 **13,448 行**，其中会话树、operation 状态机、崩溃恢复、压缩、事件——都是 `packages/agent/docs/harness.md` 那份**自称 normative specification**（`harness.md:21`）的 1468 行所定义的东西，上游还配了实现与 2105 行 conformance 用例（`/tmp/pi-repo-research.md:166-169`）。

**当初不押注是对的，现在前提没了。** 旧 spec 的非目标写着「不押注 pi 上游未实现的 `AgentHarness`（HEAD 仍抛 `HarnessNotImplemented`）——只用 core Agent 层」（`docs/specs/2026-09-01-agent-ts-rewrite-spec.md:16`），那是对 0.84.4 的正确判断（`AgentHarness.create` 抛 `HarnessNotImplemented("create.restore")`，`/tmp/agent-architecture-map.md:29`）。0.85.0/0.85.1 把真正的编排器发出来了：`accept` / `drive` / `restoreLane` 三个方法就是我们的 intake / alarm / resumedTranscript（`/tmp/agent-architecture-map.md:236-249`）。我们仍钉在 **0.84.4**（`workers/edge/package.json:21-22`）。

**书的框架说这件事该怎么分。** Agent = Model + Harness，Harness 是「模型边界内环绕模型的运行与治理层，负责构造上下文、暴露工具接口、维护循环和状态」（`book/chapter1.md:25`）；上下文的五个组成部分 = 系统提示词、工具定义、用户消息、模型回复、工具执行结果，其中前两者是静态前缀、后三者是不断增长的轨迹（`book/chapter2.md:56,376`）。pi 的 harness 正是这一层的通用实现，而**轨迹**正是它的 `entries`。我们该留的是**业务**：领域工具、配额、结算、身份、SD-9 帧、单写者租约。

**eval 与单测的前提也跟着变。** 轨迹既然是 session 本身，eval 就不需要一个数据库去重建它——上游自己就是 `MemorySessionRepo` + `fauxProvider` 跑 harness 测试（`/tmp/pi-repo-research.md:217-231`）。

## 二、现状

### 2.1 逐目录判定（从 `git ls-files workers/edge/src/agent` 生成）

`workers/edge/src/agent` 共 **13,449 行 / 115 个文件**（114 个 `.ts` + 1 个 `city-names.json`），其中 `session/` 一个目录就 **5,919 行 / 40 个文件**。判定分三类：**删**（上游已实现）、**改**（降级为适配器）、**留**（业务，pi 明说不做）。逐文件清单由 **W0-1** 卡生成并单独评审（**D10**）；本节给的是目录级判定与不可省略的例外。

| 目录 | 行数 | 判定 | 取代它的 pi 接缝 / 说明 |
|---|---|---|---|
| `intake/` | 505 | **删** `turn-intake.ts`、`neon-turn-records.ts`；**留** `quota-reservation.ts`、`anonymous-message-allowance.ts` | `AgentLane.accept` + `Storage.commit`；配额是我们的 |
| `session/` 的 run 引擎 | **2,237** | **删** `durable-turn.ts` 157、`turn-attempt.ts` 266、`run-machine.ts` 155、`turn-ending.ts` 69、`turn-output.ts` 76、`turn-step.ts` 236、`turn-step-sequence.ts` 51、`turn-store.ts` 210、`neon-turn-store.ts` 321、`turn-transcript.ts` 228、`context-compaction.ts` 85、`session-run-queue.ts` 62、`session-wakeup.ts` 106、`turn-stream-handoff.ts` 100、`turn-agent.ts` 115 | operation 状态机 + `drive` + `restoreLane` + `Storage` + `harness/compaction/` |
| `session/` 的 envelope 与前缀 | **1,613** | **删** `durable-envelope-store.ts` 163、`envelope-staging-store.ts` 70、`session-envelope.ts` 153、`turn-envelope.ts` 152、`turn-catalog-session.ts` 176、`minted-refs.ts` 104、`prefix-seeding.ts` 215、`prefix-turn.ts` 150、`session-prefix.ts` 211、`neon-seeded-session.ts` 61、`trajectory-prefix.ts` 158 | session values/lists；前缀改 `SessionRepo.fork` |
| `session/` 的适配器 | **1,594** | **改** `session-turn.ts` 269、`agent-session.ts` 150、`turn-frames.ts` 166、`turn-subscribers.ts` 112、`sse-turn-channel.ts`、`turn-answer.ts` 271、`turn-answer-part.ts` 214、`turn-toolbox.ts`、`turn-instructions.ts` 88、`turn-model.ts` 202 | 装配 / 投影 / 答复成型仍是我们的 |
| `session/` #1378 | 247 | **改** `tool-return-summary.ts` 157、`frozen-tool-return.ts` 90 | 语义保留，接缝改 `transform_context`（§4.2，P1-4） |
| `session/agent-status.ts` | 178 | **留** | 状态栏（#1379）继续挂 `transform_context`——**owner 定案：设计不动** |
| `sweeper/` | 294 | **重写**（不是原样保留） | `neon-run-leases.ts:27,39` 扫的是 `runs` 表，新 session 不再写它；改扫「有 open operation 的 session」索引 → **W1-9** |
| `settlement/` | 460 | **重写** | `neon-turn-settlement.ts:40` 写 `runs` + `dailyUsage`；改读 usage ledger → **W1-7** |
| `retrieval/` | 540 | **重写** | `conversation-retrieval.ts` / `neon-conversation-records.ts` 读 `runs`/`messages`/`run_steps`；改读 entries → **W1-10** |
| `selection/` | 1,113 | **改** | `turn-selection.ts:31` 引 `TurnSteps`（随 `turn-step.ts` 删）；落地方式见 **D3** |
| `tools/` | 2,458 | **留**（换 `AgentHarnessTool` 签名） | 领域工具是我们的 |
| `byok/` 650 · `egress/` 718 · `memory/` 770 | 2,138 | **留** | 凭据、出口策略、记忆账本 pi 都没有 |

**目录之外还有三处必须一起改**：`db/schema.ts` 的 `runs`/`messages`/`run_steps`（新路径不再写）、`migrations/neon/*agent_runs*`（新表由 **W0-2** 出迁移）、`gateway/agent-turn.ts:24-31`（今天直接 import `NeonTurnRecords`、`SessionBusyError`、`durableSessionWakeup`、`handOffTurn`、`readConversationOn`，全部要改指向新宿主）。

### 2.2 上游 0.85.1 有什么

- **三个 store，一条不变式**（`harness.md:41-48`）：`entries` 写一次只追加的会话树、`values/lists` 可变当前态、`usage ledger` 只追加成本行；「Every payload is in an entry, a bound value/list, or the ledger; there is no third place.」
- **`Storage` 11 个方法**（`dist/harness/session/types.d.ts:386-398`）、**`SessionRepo` 5 个方法**（`:501-510`，含 `fork`）、**`ForkOptions`**（`:474-499`：branch scope `:474-490`、tree scope `:491-499`）。
- **`DriveOutcome` 就是 alarm 要的形状**（`dist/harness/agent-harness.d.ts:109-123`）：`settled` / `waiting{reason:"retry", notBefore}` / `waiting{reason:"deferred"}`；且 `waitForRetry:false` 时「returns waiting/`notBefore` with no timer and the caller schedules a wake」（`harness.md:993`）。
- **11 个 hooks**，其中 `before_drive` 与 `before_tool` **fail closed**（`harness.md:1201`），`transform_context` 是 request-local、retry 会重跑（`:1203`）。
- **官方唯一的端到端范例**：`packages/coding-agent/src/experimental/mini/worker/run.ts:63-78`（`JsonlSessionRepo` → `AgentHarness.create` → `harness.lane("main")`）与 `:97-105`（`create` 返回的 `open` 逐个 `resume`，注释：「Creation restores durable operation state without starting effects」——**我们不能照抄这一步**，见 §4.1 与 P1-3）。
- **已发布的 subpath**：`.`、`./harness/session`、**`./harness/session/testing`**、`./harness/context`、`./harness/env/nodejs`、`./harness/runtime/reducer`、`./node`（tarball `package.json` 的 `exports`）。`testing` 导出 `createStorageConformance`（920 行用例）、`createSessionRepoConformance` 及另外 8 个套件（1185 行：5 个 fork —— `ForkBehavior`/`Fork`/`ForkCoordination`/`ForkDestinationReservation`/`ForkSourceSnapshot`，加 `Lifecycle`/`Message`/`Ownership`）、`InstrumentedStorage`、`GatingStorage`/`CommitDiscarded`（`dist/harness/session/testing/index.d.ts:4-7`）。
- **DB backend 是一等公民**：`packages/session-backends/sqlite-node/src/**` 共 **1973 行**并跑上游导出的 conformance（`/tmp/pi-repo-research.md:156-164`）。

### 2.3 上游明说不做、留给我们的（`harness.md:118-122`）

单写者租约（「Storage backends do not enforce this host-lifecycle rule」）、**平台 alarm 与 sweeper**（「the harness never creates platform alarms, scans repositories for abandoned sessions… the serving layer decides when to call again」）、精确一次外部副作用、复制。配额（`grep -i quota` 上游零命中）、结算、身份、SSE 帧契约同样没有。**这些正是我们该留的。**

### 2.4 能不能上 workerd

上游从不提 workerd/DO/wrangler，但 root export 是 browser-safe 的：`packages/agent/src` 里 `from "node:` 只出现在 `harness/env/nodejs.ts`（独立 subpath，不在 root barrel）与两个 conformance 文件；CI 有 esbuild `platform:"browser"` 的 browser smoke，入口从包根导入（`scripts/check-browser-smoke.mjs:45-52`）。`MemorySessionRepo`（`dist/harness/session/index.d.ts:7`）零 node API——注意 `MemoryStorage` **不是**公开导出，能用的是 `MemorySessionRepo.create()` 与 `StorageBackedSession`（`:8`）。**但 conformance subpath 是 Node-only**（`testing/conformance/*.ts` import `node:`），这正是 **D5** 把 Neon backend 拆成独立包的理由。**但 browser smoke ≠ workerd smoke**，且 `@earendil-works/chord` 是硬依赖（tarball `package.json` dependencies），而 chord 自己把 `esbuild` 列进 `dependencies`（`packages/chord/package.json`）——虽然只服务 `./bundler`/`./node`，S1 必须断言它**没有**进 Worker bundle，所以 workerd 打包必须自己实测（S1）。我们没有 bash/read/write/edit 四个 coding tool，**不需要 `ExecutionEnv`**。

## 三、目标 / 非目标

**目标**：把 agent 的**运行与治理层**换成 pi harness；我们只保留业务与 serving layer。

**非目标**：改 SD-9 帧 surface 与 `packages/contract` 的 zod 契约（web 端不动）；改 edge 鉴权模型（AUTH-2 #950）；把 quota/结算/租约/sweeper 交给上游（它明说不做）；给上游提 PR（默认自动关闭，`CONTRIBUTING.md:23`）。**旧 spec 第 16 行的非目标作废**。

## 四、设计

### 4.1 一个瘦 DO 宿主 + 一个 DO 无关的执行者模块（**D1 = 方案 (1)**，owner 2026-09-10 定）

分成两层，**这条线上只有一个 DO，且它不存任何会话状态**：

**执行者模块（Model + harness + tools + hooks，DO 无关）**——它就是整个 agent，也正是 eval 在 Node 里实例化的那个单元（§七）。它接受注入的 `SessionRepo`，装配 `AgentHarness`，跑 `accept` / `drive`，把 `HarnessEvent` 交给调用者。**它一行都不认识 Durable Object**。生产与 eval 的差别是**三个注入口**，不止一个：**`SessionRepo`**（`NeonSessionRepo` / `MemorySessionRepo`）、**`ToolPolicy`**（生产是配额与身份判定，eval 是全放行——协议六的授权就挂在这个口上）、**`SelectionRecords`**（生产是那张表，eval 是内存实现——协议七的 intent/result 挂这里）。把后两个显式做成端口，eval 才能继续**完全不碰 DO 与 Neon**。

**宿主（一个 session 一个 DO）——「瘦」由两条不变式定义，不由行数定义**：**(i) DO 存储里没有任何会话状态**；**(ii) 宿主里没有 run engine**。协议四~六那些业务持久化（准入幂等、待结算、选择 intent/result）放进一个**同样 DO 无关的业务模块**，由宿主调用——这样宿主只剩生命周期，业务逻辑在 Node 里也测得动。——只做上游明说要宿主做的事（`harness.md:120,121,403`）：

1. **单写者 = 单实例 + 宿主自己的互斥锁**。DO 保证只有一个实例，但**不保证跨 `await` 的互斥**（协议二），而且 pi 对第二次 `drive` 是**等着**而不是拒绝——`lane.js:729-731` 遇到 `occupied` 会 `await claim.drive.completion` 然后重试。所以宿主要显式持锁。**不需要 Neon 租约行**（那是方案 (2) 的机制）。
2. **一次请求**：调执行者 `accept(request)` → `drive({operationId, waitForRetry:false})`；`watch()` 的 snapshot 与事件**在 DO 内直接写进浏览器的 SSE 流**（`Content-Type: text/event-stream`），不经任何中继——上游 snapshot 与流的无缝配对（`harness.md:1164`、不变式 35 `:1353`）因此天然成立。
3. **排程（只有一个 alarm 槽，所以要有策略）**：DO 只有一个 alarm，**下一次唤醒时间 = min(保活 tick, `notBefore`)**，并且**在 `alarm()` 内部重新排下一次**；`alarm()` 里若已有 drive 在飞就直接返回，**不并发第二次 drive**。`{kind:"waiting", reason:"retry", notBefore}` → 参与上面的 min 计算（`dist/harness/agent-harness.d.ts:109-122` + `harness.md:993`）。`{kind:"settled"}` 就地结算。
3.1. **每个入口先看故障位**：`alarm()` 与**每一个请求入口**都要先检查宿主的 fault 标记；有标记就**在互斥内**先跑对应的重挂（按协议二的分流：有拒绝记录走协议一，否则走协议八），**跑完之前不做任何 `accept`/`drive`**。
4. **恢复**：alarm 或实例重启时，对 `create` 返回的 `open: OpenOperation[]`（`harness.md:1069-1077`）**逐个 `drive({operationId, waitForRetry:false})`，从不 `resume`**——`resume` 会在进程内一路驱动穿过 retry 等待（`agent-harness.d.ts:28`），那正是我们不要的。`aborting` 的走取消对账。
5. **零 DO 会话存储**：会话真相全在 Neon 的 pi `Storage`。禁的是 **`ctx.storage.put` / `delete` / `deleteAll` / `transaction` / `sql`**；**alarm 那组方法（`setAlarm`/`getAlarm`/`deleteAlarm`）是允许的**——它们本来就挂在 `DurableObjectStorage` 上，而第 3、4 条正要用。DO 提供的是互斥、闹钟与那条活着的流，不是存储。
5.1. **drive 期间的保活闹钟**：客户端一断开，请求就结束，DO 只靠在飞的工作续命并受约 70–140 秒的空闲驱逐约束。所以**每趟 drive 期间宿主都要armed 一个约 30 秒的重复 alarm**（这正是 Agents SDK `keepAlive` 那个原语，我们自己实现），让断线不终止这趟 pass；真被驱逐了，下一次 alarm 按第 4 条恢复。
6. **心跳**：长工具等待期间由宿主的定时器发 SD-9 注释帧，间隔远小于 Cloudflare 边缘 **400 秒**不可配置的空闲连接硬上限。
7. **就近**：DO 用 `locationHint` 钉在 **APAC**（`OBJECT_NAMESPACE.get(id, { locationHint: "apac" })`；合法值含 `apac` / `apac-ne` / `apac-se`），因为 Neon 在那边——跨洋每跳 208 ms 的教训不必再交一次学费。两条限制照抄文档：**只有第一次 `get()` 认这个 hint**、**Durable Object 创建后不会换位置**，而且 hint 是 best effort 不是保证（developers.cloudflare.com/durable-objects/reference/data-location/，2026-09-10 读）。今天 `agent/durable-namespace.ts:12` 的 `NamedStubs.get(id)` **没有这个参数**，要一起加。**而且 hint 只有第一次 `get()` 认，所以每一个取 `AGENT_SESSION` stub 的地方都得带上它**——今天有三处（`session/session-wakeup.ts:101`、`session/turn-stream-handoff.ts:47`、`gateway/staging-prefix-route.ts:154`，最后一处随 W2-1 死掉），新宿主的 intake 路径再加一处。做法：`durable-namespace.ts` 里出一个 `sessionStub(sessions, sessionId)`，**所有取 stub 的地方只走它**。

**为什么这样分**：`/tmp/streaming-agents-survey.md:205-212` 说得直白——DO 把「run store + broker + scheduler」三层压进一个原语，是 Cloudflare 上「免拼装」的那条路；而方案 (2) 的 DB 租约 + 延迟队列 + 无状态计算虽然更接近别家云的标准形状，在 Cloudflare 上要自己拼。既然执行者本来就是 DO 无关的，选 (1) 拿到互斥与活流，**不花任何架构自由度**。


### 4.2 我们挂在哪些接缝上

| 我们的东西 | 接缝 | 为什么是这个 |
|---|---|---|
| 配额准入 | **在 `accept` 之前，由宿主自己拒**（不是 hook） | 见 §4.2.2 协议一：`before_drive` 抛错**不是「只拒这一趟」**，实测会把整个 harness 实例打成 fault |
| 身份撤销 / 硬上限 | `before_drive`，且**明知它会 fault 整个实例** | 只留给「必须立刻全停」的紧急情况；日常配额不走它 |
| 每个工具的授权/预算 | **工具 `execute` 入口**，按 `invocation.invocationId` 幂等（协议六） | `before_tool` **在 safe 重放路径上根本不跑**（`dist/harness/runtime/drive/tools.js:345-352`），所以它只留**首跑的参数校验/替换**（替换会被重新校验，`harness.md:1201`），授权与预算不能放它 |
| `<agent_status>` 状态栏（#1379） | **`transform_context`** hook（**owner 定案：设计不动**） | request-local、每次请求重算，正是状态栏要的「永远最新、永不持久化」；`transform_context` 可同时改 messages 与 systemPrompt（`agent-harness.d.ts:508-517`） |
| 写入时冻结的工具返回摘要（#1378） | **必需的持久 sidecar**（随工具结果一同提交）+ **`transform_context`** 只施加已存字符串 | `after_tool` 跑在「执行之后、outcome 落库之前」（`harness.md:1195`），它的 content patch 会被**持久化**（transition-consumed，`:1203`）——挂在那里等于把逐字结果永久换成摘要，本轮模型也会直接看到摘要，而 #1378 的规则是**本轮逐字、往轮摘要**（`session/turn-transcript.ts:206-216` 的 `verbatimReturn` vs `frozenReturn`）。正解：**entry 永远存逐字文本**；摘要在 `transform_context` 里对**先前轮**的工具结果施加（request-local，`:1203`），摘要**不是可选缓存**：`frozen-tool-return.ts:2-18` 写死了「决定在写入时做一次、读路径绝不重算」，否则换一版 summariser 就会改写旧历史的字节、破坏 #1378 的整条理由。所以摘要必须**与工具结果可靠地一起提交**（同一次 commit 的 sidecar）；`transform_context` 只**施加已存的字符串**，**缺失就保留逐字原文** |
| 领域工具 6 个 | `AgentHarnessTool`（`dist/harness/types.d.ts`） | |
| 模型与 BYOK | `AgentHarnessOptions.models` / `model` | `models` 是唯一 auth 路径 |
| 结算 | `usage` 事件 / `scanUsage({fromSeq})` | ledger append-only（`harness.md:341,346`） |
| SD-9 帧 | `lane.watch()` 两段式 → 我们的投影 | 上游给的是 `HarnessEvent`，帧契约是我们的（`harness.md:1144-1164`） |
| 确定性选择（#1288/#1462） | 宿主在 harness 之外直答，用 `appendMessage`（`agent-harness.d.ts:641`）+ `appendCustomEntry(customType, data)`（`:642`）记账 | `OperationRequest` 只有 `prompt`/`skill`/`prompt_template`/`compaction`/`navigation` 五种（`:48-77`），**没有非模型 operation**；`appendCustomEntry` 让「服务端发起的步骤」成为一等 entry 类型，#1462 的 `origin` 白拿。**用户那一侧一个字都不变**：clarify 早就是生成式 UI——结构化 data part（`packages/contract/src/chat-data-parts.ts:45` 的 `candidates`）由 `apps/web/src/features/chat/components/ClarifyCard.tsx` 渲染，用户点选后经确定性选择通道回来（`packages/contract/src/agent-contract.ts:89-99`），**从来不是自由文本**；这里的两次 append 是**会话内部记账**（决定下一轮模型看到什么、带 `origin`），不产生任何新的对用户可见的东西（**D3**） |

### 4.2.1 `HarnessEvent` → SD-9 的映射（无损，逐行有测试）

| SD-9 需要 | 事件 / 快照来源 | 证据 |
|---|---|---|
| 流式文本与 thinking | `message_update{message, event, frame?}`，载 pi-ai 的 `AssistantMessageEvent` | `agent-harness.d.ts:286-291` |
| `tool-input-*`（含 `args`） | `tool_start{args}`——「effective arguments for an intended effect and source arguments for an immediate synthetic result」 | `:297-303`；`harness.md:1160` |
| `tool-output-*`（含 `result`/错误） | `tool_end{result, isError, terminate}` | `:311-319` |
| 用量与结算 | `usage{row, totals}` | `:416-420` |
| 回合终止 | `run_end{status, error}` | `:224-236` |
| **断线重连** | `watch().snapshot` 的 `operation.streamingMessage` + `runningTools` | `harness.md:1100-1122` |

拒绝文案仍在网关成型（`gateway/chat-envelope.ts`），BYOK 擦洗在投影层。**这张表就是 W1-6「逐行有测试」的行清单**，也是 eval 唯一的转录来源（§七）。

### 4.2.2 宿主必须自己实现的八条协议（两轮 Seat B + Seat A r7，逐条对 0.85.1 源码复核后采纳）

这八条都不是 pi 会替我们做的事，而且有三条**与文档的字面读法相反**，所以逐条给出源码证据。

1. **拒绝协议：`before_drive` 抛错会打掉整个 harness 实例，不是只拒这一趟。** 文档写的是「`before_drive` fails closed and rejects the pass」（`harness.md:1201`），但 0.85.1 的实现是：`drive.js:18-28` 里 `before_drive` 只吞 `AbortRequested`，其余异常原样抛出；`lane.js:734-754` 把 drive 的异常交给 `onFault`；`dist/harness/runtime/harness.js:259` 把 `onFault` 接到同文件 `:231-243` 的 `fault()`，那里**封掉所有 lane、关掉 hooks 与事件流**并发 `harness_fault`。所以：**日常配额拒绝必须发生在 `accept` 之前**，由宿主直接答复用户（永久性拒绝再补一次持久取消 + 结算；临时性依赖故障改为排程重试）。`before_drive` 只留给「身份已撤销、必须立刻全停」这类**本来就该停机**的情况——**而且一旦触发，恢复不是自动的**：faulted 之后连 `requestAbort` 都会抛（`lane.js:761-765` 只在 `HarnessClosed` 时返 `Closed`，其余走 `assertOpen()` 抛出，`:1570-1572`）。**这条序列只适用于「永久性拒绝」，且必须记下拒绝理由**；因存储提交失败而 fault 的情形走**协议八**，绝不能走这一条（那会把已经提交的合法工作取消并退款）。序列：①把拒绝理由持久记下 → ②`close()` 掉这个已 faulted 的 harness → ③重新 `create` 一个受控实例 → ④**在第一次 `drive` 之前** `requestAbort`（持久取消只有这一条路径，且对同一条仍开着的已取消 operation 重复请求是允许的，`harness.md:997-1001`） → ⑤`drive` 走完取消对账 → ⑥结算并退款。协议二的「一个 incarnation 一个 harness」因此要补一句：**直到 fault 为止**；fault 之后按协议二的**起因分流**决定走这一条还是协议八——**这一条只在「有我们记下的拒绝理由」时适用，且恰好一次**。
2. **DO 的单线程**不等于跨 `await` 的互斥（`session/turn-subscribers.ts:61-68` 已经写着 fetch 与 alarm 会在 await 处交错）：Neon I/O 期间另一个请求可以进来。所以宿主**每个 incarnation 只初始化一个 `Session`/`AgentHarness`——直到 fault 为止**（初始化放 `blockConcurrencyWhile`），并在 `accept`/`drive`/业务写这三处上加一把**显式互斥**。上游把这件事明确交给宿主（`harness.md:403`、`:1082`）。
   **fault 之后按「起因」分流，不是「只准重建一次」**：
   - **该 operation 有我们自己记下的拒绝理由** ⇒ 走**协议一**（永久性拒绝，取消 + 结算 + 退款），**恰好一次**；
   - **没有这条记录** ⇒ 走**协议八**（安全默认：**绝不取消**），而且它是**可重试**的——`create` 自己会在 `restoreSession` 失败时把异常包成 `HarnessFault` 原样抛出（`dist/harness/runtime/harness.js:289-290,306-308`），**没有半成品挂载留下**，所以「重开失败」只是这一次失败，交给 alarm/sweeper 带退避重试即可，且任何时刻**最多一个活挂载**。
   **判别依据必须是我们自己的记录，不能靠异常。** 协议一的第 ① 步就是**在 hook 抛出之前**把拒绝理由持久写下；两条路径抛出的东西是**同一个** `HarnessFault`、连消息都一样（`harness.js:236-237` 与 `:306-308` 构造的是同一句 "AgentHarness storage or invariant fault"），从异常上分不出来。
3. **第一趟 drive 之前就要有持久唤醒。** 只在 `waiting{notBefore}` 之后 `setAlarm` 是不够的：`accept` 已提交、首趟 drive 还没返回时实例没了，就没有任何闹钟——而上游明说「a crash after acceptance leaves an open initial leaf that only a later `drive` advances」（`harness.md:736`）。**两条前置，缺一条这套恢复就是空转。**
   **前置甲：sweeper 必须已经被持久排程，而且要排在准入事务之前。** 这是我们自己交过学费的一条——`intake/turn-intake.ts:143-149` 把理由写在注释里：「The backstop is scheduled BEFORE the transaction opens, not only after it commits… only a sweeper that was ALREADY ticking when the row landed can find it — scheduling it afterwards is scheduling it in the branch that did not run」，实现就是 `acceptTurn:156` 先 `await intake.backstop.ensureScheduled()` 再 `openTurn`。**而这个文件在删除清单上**，所以 `ensureScheduled` 的归属必须显式转给 **W1-9**，并成为提交顺序表里 ① 与 S1 的前置。
   **前置乙：`operationId` 在 `accept` 之前就分配好。** `OperationRequest.operationId` 是可选入参，`lane.js:319` 是 `request.operationId ?? this.session.idGenerator.next(startedAt)`——**调用方可以自己给**。于是准入意图那一行就为该 client key 分配一个唯一的 `operationId`，③ 处显式传进 `accept`，恢复端按这个 id 判定，**但见证人要挑对**——这是 Codex r4 抓到的一个会误伤在途回合的坑：
   - `create.open` **是 `create` 那一刻算出来的快照**（`dist/harness/runtime/harness.js:290-305` 从 `restoreSession` 一次性 flatMap 出来），**之后的 `accept` 不会更新它**；
   - `getResult(operationId)` 读的是 `pi.result`（`lane.js:132-134`），**只有终态之后才有值**。
   所以在**同一个活着的实例**上，「不在 `create.open` 里」且「`getResult` 是 undefined」恰恰是**刚被接受、正在跑**的那种状态——照这两条判「没接受过」就会把一笔真实在途的 operation 退款并判废。
   **定死的判定顺序**：宿主互斥内先用 **`lane.inspectExecution()` 的 `current`**（`agent-harness.d.ts:647`，返回 `LaneExecutionInfo{ current, lastOperationId }`，`:102-108`）／必要时 `harness.lanes()`（`:682`）看**当前**有没有这个 operation，再配 `getResult(operationId)` 看是否已终态；**`create.open` 只在刚重建实例之后用一次**。**alarm 入口与 sweeper 都不得仅凭「不在某份缓存的 open 列表里」就退款或判废。**同时规定：**该 session 还有未对账的 pending 意图时，不允许新的准入**。客户端那一侧的幂等键仍是 `(session_id, client_message_id)`。

   做法：**在 `accept` 之前先写一条可扫描的准入意图**（`admission_intents`：`(session_id, client_message_id)` 唯一键 + 终态状态 `pending｜accepted｜settled｜void`，**④ 处** `pending→accepted`（③ 是 pi 自己的事务，我们不在那里写状态）、对账判废时 `→void`，⑨ 处 `→settled`；**sweeper 只扫 `pending` 与 `accepted`**），`accept` 成功后**在一个业务事务里**（表的 ④）把意图 `pending→accepted`、写 `open_operations`、建待结算记录（三件事同进同出，让 ③ 成为唯一的未知窗口），再 armed 一个近期 alarm，drive 期间按 5.1 续排。**为什么不能是「accept 之后再写索引」**：实例若死在**接受提交与索引/alarm 之间**，那笔已被接受的工作就没有任何持久痕迹可扫。所以 sweeper 扫的是**意图**，不是只扫 `open_operations`；「接受结果未知」的意图由 sweeper 用 `create.open` 与转录去对账（接受了→补 alarm；没接受→释放预留）。故障注入必须**停在接受提交刚返回的那一刻**。
4. **准入幂等要按客户端的键，不是 operationId。** 上游把并发 accept 的败者判 `LaneBusy`（`harness.md:736`、结果类型 `:1039`），而 `operationId` 是**接受之后**的不可变元数据（`:602`），**不是**客户端可重放的幂等键。今天的 intake 按 `(session_id, client_message_id)` 去重，而那段代码要删。所以宿主要在**预留配额之前**持久建立 `(session_id, client_message_id) → operationId` 的唯一映射；并规定三件事的对账：`accept` 被拒、结果未知、以及**孤儿预留**（映射写了但 accept 没成）。
5. **结算窗口独立于 open operation。** 终态事务会把 operation 状态删掉，`create.open` 从此不再返回它（`harness.md:965`、`:991`），所以「drive 返回 settled 之后再记账」这段时间里若进程没了，**只扫 open operation 的 sweeper 找不到这笔漏账**。做法：**待结算记录要在第一次 `drive` 之前就存在**（或与终态提交原子地建立）——终态一提交，operation 就从 `create.open` 里消失，那之后再去创建结算义务就已经晚了；并且 **`open_operations` 的行不得早于结算义务被持久化就删掉**。它有自己的扫描路径；ledger 游标、`dailyUsage`、退款标记**放同一个业务事务**（今天 `settlement/neon-turn-settlement.ts` 就是这么做的）。
6. **`before_tool` 拦不住 safe 重放，所以每个工具的授权与预算要落在 `execute` 里。** `recoverToolInvocation` 在 `call.replay === "safe" && tool?.replay === "safe"` 时**直接调 `performToolInvocation`**（`dist/harness/runtime/drive/tools.js:345-352`），而 `before_tool` 只在 `prepareToolInvocation`（`:304-331`）里跑——**重放这条路根本不经过 hook**。做法：把「这次调用允不允许、扣谁的预算」放进工具 `execute` 的入口，**用 `invocation.invocationId` 做幂等键**——上游对它的定义正好是「Stable harness identity for one logical tool call, **unchanged during safe replay**」（`dist/harness/types.d.ts:66,69`，签名 `:78-80`）。首跑与重放走同一段判定。验收要有一条：**崩溃后预算已被撤销，重放不得产生那个外部效果**。
7. **确定性选择要有应用级的持久协议。** D3(b) 的两次 append **不创建 operation**，而且各自独立提交、各自新铸 entry id（`lane.js:1487-1500` 的 `append()` → `idGenerator.next()`）。所以「执行了选择」「写了第一条 append」「写了第二条 append」「清了未决澄清」这四步之间崩溃，**没有 open operation 可供恢复**。**先决条件：动手之前，lane 上不能有 open operation。** `append` 在有 operation 在跑时**不会把 entry 放到 branch 上**，而是写进 `pi.pending.entry` 并挂进 lane inbox 的待写队列（`lane.js:1530-1552`）；而 `findEntries` 只从 branch tip 扫（`:1475-1481`）——**于是恢复端根本看不见它**。所以选择的执行与 append 必须在**宿主互斥内**先确认「该 lane 没有 open operation」，正忙（例如刚返回 `waiting`）就**拒绝或等待**，不要排队。若将来确实要允许排队，恢复端必须能把**待写**与**已落 branch**区分开，那是另一套协议。

   做法：**用一条 `appendCustomEntry` 而不是两条 append**。`appendMessage` 只收一个 `AgentMessage`（`agent-harness.d.ts:641`），没有放应用字段的位置；而 `appendCustomEntry(customType, data)`（`:642`）能把 **{请求键, 步骤, 结果}** 一起写进去，再用 `AgentHarnessOptions.entryProjectors`（`:634`）把它投影进给模型的上下文——**于是 S2+S3 塌缩成一次可认领的提交**。仍要**逐步的持久状态**（选择已执行 / 该 entry 已提交 / 澄清已清除）。若最终仍保留两次 append，则**custom entry 必须先写**，恢复端用 `findEntries` 从 intent 的 `started_at` 之后扫回来认领——因为 `append` 每次新铸 id，靠 id 认不了。恢复时**在下一轮开始之前**先把半途的选择走完；清除未决澄清必须**按 `clarification_id`/revision 条件清**，不能无条件清。要覆盖的窗口包括「append 已提交、但我们还没记下它的 id」。

8. **存储提交失败 → 另一条重挂路径，默认不取消、不退款。** 最阴的一种情况：**Neon 那边已经提交成功，但提交调用本身失败了**（响应丢了）。此时 `lane.js:206-223` 的 `catch` 直接 `throw this.onFault(error, context)`，整个 harness 被 fault；而三个「活见证人」全部经 `assertOpen` —— `inspectExecution` 走 `readLane`（`:165-166` 连查两次）、`getResult`（`:132-134`）、`findEntries`（`:1475-1477`）—— **在 fault 之后一律抛异常**。也就是说：**恰恰在最需要判定的时候，判定手段全都不可用**。若此时走协议一（无条件 `requestAbort` + 取消 + 退款），就会把一笔**已经落库的合法工作**取消掉；而 S2 那种情形连 operation 都没有，根本无从 abort。
   **做法（协议八，storage-fault re-attach）**：在宿主互斥内 ①`close()` 掉这个已 fault 的挂载 → ②重新打开 `Session` → ③`create` 一个新 harness → ④**再去判定**：按预分配的 id 查 `inspectExecution().current` / `getResult(operationId)`，选择那一侧则按请求键去 `findEntries` 认领已提交的 entry。
   **一条硬规矩**：**只要判定查询本身还在失败，所有恢复义务就一律保持 `pending`——不得记为「不存在」，更不得默认取消或退款。** 判定成功之后才按真实终态收尾。

#### 4.2.2.1 提交顺序与「结果未知」窗口的恢复动作

每一行都是一次**不可分割的提交**，右边是「提交发出但结果未知」时恢复端该做什么。这张表是 W1-2/W1-3/W1-7/W1-8 验收的故障注入点清单。

| # | 提交 | 之前必须已存在 | 结果未知时的恢复动作 |
|---|---|---|---|
| 0 | **sweeper 已持久排程**（`ensureScheduled`，归 W1-9） | — | 没有它，①–⑤ 的一切恢复都不会发生（`turn-intake.ts:143-149` 的教训） |
| 1 | 准入意图：唯一键 `(session_id, client_message_id)`，**并在此分配 `operationId`**、状态 `pending` | ⓪ | 重放同一 client key 命中同一行、拿到**同一个** `operationId`；该 session 有未对账的 pending 意图时不接新准入。**对账顺序：先 selection intents，再 admission intents；任一未对账即不接新准入** |
| 2 | 配额预留（键：同一意图行） | ① | 意图存在但未 accept ⇒ 释放预留 |
| 3 | **`accept`**（把 ① 分配的 `operationId` 显式传进去，`lane.js:319`） | ①② | 若因存储提交失败而 fault ⇒ **先走协议八**重挂再判定。判定：**按那个 id 查 `inspectExecution().current`（重建后第一次可用 `create.open`）→ `getResult`**；在跑或已终态 ⇒ 接受了，补 ④⑤；**两者皆无且查询本身成功**才 ⇒ 释放预留、意图转 `void` |
| 4 | **一个业务事务**：意图 `pending→accepted` + `open_operations` 行 + 待结算记录 | ③ | 三件事同进同出，于是**③ 是唯一的未知窗口**；sweeper 扫**意图**（不是只扫 ④）把这一步补上 |
| 5 | 首个 alarm | ④ | 同上；alarm 丢了由 sweeper 重排 |
| 6 | 每趟 `drive`（pi 的内部事务，含工具 effect-pending） | ⑤ | 交给 pi 的恢复（`harness.md:985-989`）；工具按逐条 replay 策略 + `invocationId` 幂等。**若是存储提交失败导致的 fault ⇒ 协议八重挂后继续，不取消** |
| 7 | **终态**（pi 删掉 operation 状态） | ⑥ | 此后 `create.open` 不再有它——只能靠 ④ 的待结算记录发现；**若终态提交的响应丢了 ⇒ 协议八重挂，再用 `getResult` 认真实终态**，不得当作「没终态」 |
| 8 | 业务结算（ledger 游标 + `dailyUsage` + 退款，一个事务） | ④⑦ | 终态的见证人是 **`AgentLane.getResult(operationId)`**（`agent-harness.d.ts:643`；清理之后 `pi.result` 仍是不可变的，`harness.md:991`）——恢复端据它判「这笔到底settle 成什么」；再按 `operation_id` + `settled_at` 守卫重放 ⇒ 恰好一次 |
| 9 | 删 `open_operations` 行 | ⑧ | **不得早于 ⑧**；早删就丢账 |
| S1 | 选择 intent（稳定请求键） | ⓪，**且 lane 上无 open operation** | 恢复时先走完半途选择，再开下一轮 |
| S2 | **一次 `appendCustomEntry`**（载 {请求键, 步骤, 结果}，配 `entryProjectors` 投影进上下文） | S1，**且仍无 open operation**（否则它只进待写队列、`findEntries` 看不见，`lane.js:1530-1552` vs `:1475-1481`） | 靠请求键认领；`append` 新铸 id，认不了 id。**提交响应丢失 ⇒ 协议八重挂后按请求键 `findEntries` 认领**（这里没有 operation 可 abort，协议一不适用）。保留两次 append 时：custom entry 先写，恢复用 `findEntries` 从 intent 的 `started_at` 之后扫 |
| S4 | 清除未决澄清 | S2 | **按 `clarification_id`/revision 条件清**，不无条件清 |

### 4.3 删除、适配、重写：三张清单

判定见 §2.1。三点必须写死：

- **删除的不止 session 引擎**：`packages/contract/src/staging-prefix-*.ts`、`gateway/staging-prefix-route.ts`，以及它们在 eval 侧的消费者 `packages/eval/src/prefix-seeding-lifecycle.ts`、`packages/eval/src/trajectory-prefix-case.ts`（D7 说 `packages/eval` 留，但这两个随 `fork` 取代而死）。
- **「原样保留」只有三类**：`tools/`（换签名）、`byok/` `egress/` `memory/`、以及 `intake/quota-reservation.ts` 与 `agent-status.ts`。**sweeper / settlement / retrieval 都要重写**，各自一张 W1 卡（W1-9 / W1-7 / W1-10），因为它们读写的 `runs`/`messages`/`run_steps` 在新路径上不再有人写。
- **部署面几乎不动**（2026-09-10 实查）：D1 取 (1) 之后不引入 Queues、不引入新 Worker，`AGENT_SESSION` 这个 DO binding 今天就在 `workers/edge/wrangler.toml` 里。**不新增部署单元**，`test_cd_staging_chain_contract.rb:38-40` 的 `STAGING_UNITS` 与 `test_cd_credential_boundary_contract.rb` 都不用改（两个契约里出现 `wrangler` 的地方都是部署动作，没有一处枚举绑定）。唯一的新代码面是 `agent/durable-namespace.ts` 的 `NamedStubs.get` 要接受 `{ locationHint }`。
- **逐文件清单是一张卡的产物**（W0-1），先评审再开 W1 —— 115 个文件的判定不该塞在 spec 表格里凭印象写（**D10**）。

### 4.4 Neon `Storage` + `SessionRepo`（out-of-tree 包）

新包 **`packages/pi-session-neon`**，形状照 `packages/session-backends/sqlite-node`（1973 行，只依赖两个公开 subpath，天然 out-of-tree 友好）。

- **实现面**：`Storage` 11 个方法（`types.d.ts:386-398`）+ `SessionRepo` 5 个（`:501-510`）。
- **验收 = 上游的 conformance**：`createStorageConformance` + `createSessionRepoConformance` 及另外 8 个套件（5 个 fork + `Lifecycle`/`Message`/`Ownership`），从 `@earendil-works/pi-agent-core/harness/session/testing` 引（`testing/index.d.ts:4-7`）——**2105 行用例白拿**。
- **schema**：`entries`（write-once）/ `values` + `lists` / `usage_ledger`，逐条对 format 4 的语义；**我们自己的列（quota、identity、lease、payer）放在 pi 模型之外的表**，不混进 entries——`harness.md:41-48` 的「没有第三个地方」是对 pi 的 payload 说的，不是禁止我们另有业务表。
- **Part 6 分区是 informative**（`harness.md:1251-1253`：「Informative; no normative rule」，无实现、无 issue、无测试）：UUIDv7 让 `entries`/`usage_ledger` 可 `PARTITION BY RANGE`。**本 spec 不做**，只把它记为将来的保留选项。
- **DO 与 Neon 的分工**：会话数据全在 Neon（eval 侧换成 `MemorySessionRepo`）；**DO 只提供互斥、alarm 与那条活着的流，不存会话状态**——一个 session 一个 DO，单写者这件事上游明说要宿主自己保证（`harness.md:120,403`），而 DO 的串行就是我们的保证。不变式：**只用 `lane("main")`**，不开 steer/followUp 的额外 lane，于是投影层可以忽略 `LaneSnapshot.queues`（**D1**）。
- **sweeper 仍需要一张我们自己的索引，但它的职责在 (1) 下缩小了**：上游「never … scans repositories for abandoned sessions」（`harness.md:121`），而 DO 的 alarm 是持久的（跨驱逐与重启存活），所以 sweeper 要盖的只剩**崩溃窗口**——`accept` 已提交、alarm 还没 armed 或 alarm 丢了。索引的家：**一张小表 `open_operations`（session_id, operation_id, accepted_at）**，宿主在 `accept` 成功后写、在 `settled` 后删，**归 W0-2**（不是租约表——(1) 没有租约表）。W1-9 扫的就是它。

## 五、Spike / kill-switch（先做，硬条件，机器可判）

沿用旧 spec 的 S1–S5 做法：**四条全绿才继续，任一条红即回到 owner 面前**。

- **S1 — workerd 打包**：0.85.1 + `@earendil-works/chord` 能进 edge 的 bundle 并在 `wrangler dev` 里执行一次 import-and-call。判据：`bundle-smoke` 通过、bundle 体积增量记录在案，**且 `esbuild` 不在产物里**（chord 把它列进 `dependencies`，只服务 `./bundler`/`./node`）。
- **S2 — 一趟真回合在部署好的 DO 里跑完并能被打断**（原 S4 的形状，硬条件）：一次 **≥130 秒、≥3 次工具调用**的回合，跑在部署好的 DO 宿主里，**中途断开客户端**，判据四条：
  - **(a)** Neon 侧**完全结算**（run 终态、步骤、usage 都在）；
  - **(b)** **零重复工具执行**（用工具自己的执行计数断言，不看标志位）；
  - **(c)** 恢复由 **alarm 驱动的 `drive`** 完成，日志里没有一次 `resume`；
  - **(d)** 记录**墙钟与 CPU 时间**，并做一次 `locationHint` 的就近验证：钉 APAC 与不钉的每跳往返差（对照 208 ms/跳 的旧教训）。
  平台口径（`locationHint` 只有第一次 `get()` 生效、创建后不换位置、best effort；DO alarm 单次 15 分钟）**只是预期，判据以实测为准**。
- **S3 — Neon backend conformance**：`createStorageConformance` + `createSessionRepoConformance` 在 `packages/test-postgres` 上全绿。
- **S4 — 实例被弃后的恢复，以及工具的 effect-pending 边界**（与 S2 的差别：S2 是**实例还活着、客户端断开**，S4 是**实例被弃**）：用 `ctx.abort()` 弃掉 DO 实例（或重启 `wrangler dev`，两种都记录），随后**由 `alarm()` 而不是请求**触发恢复：对 `open` 逐个 `drive({operationId, waitForRetry:false})` 拿到完整结果。**判据不能只写「零重复执行」**——上游对 `effect_pending` 的工具有两种合法结局：声明为 `safe` 的**会被重新执行**，声明为 `never` 的**合成一个 interrupted 错误**（`harness.md:977,987-988`）。所以：
  - [ ] 每个工具**逐个声明 `replay?: "never" | "safe"`**（`dist/types.d.ts:351`），有外部副作用的必须带**幂等键**（用 `invocation.invocationId`）；清单进卡。
  - [ ] **判据是一张逐工具矩阵，不是一句「零重复执行」**：声明 `safe` 的工具**允许被再次调用**，但其**业务效果必须幂等**（同 `invocationId` 不产生第二次外部效果）；声明 `never` 的工具**必须**得到一个显式的 `interrupted` 结果，不得被重跑。
  - [ ] 在**三个持久边界**各注入一次故障并分别断言：**intent 之后**、**外部副作用已成功但 outcome 未提交**、**outcome 已提交**。
  - [ ] **预算撤销后重放不得产生效果**：崩溃后把预算撤销，safe 重放必须在工具 `execute` 入口被拒（因为 `before_tool` 在重放路径上根本不跑，`tools.js:345-352`）。

## 六、测试重设计（照 pi 自己的三层）

上游把测试分成三层（`harness.md:1393-1402`）：**Tier A** 状态与 drive（13 个叶子各自 构造→close→reopen→drive→断言下一次持久转移；「invoking recovery twice from the initial prefix is **not** sufficient」）；**Tier B** 写序 conformance（`InstrumentedStorage` 记录每次 `commit()` 的写序，比对事务表）；**Tier C** 确定性交错（`GatingStorage` 把 commit 停在任意点）。

我们照抄这个分层，但**只测我们自己的那部分**：

| 层 | 对象 | 工具 |
|---|---|---|
| unit | hooks 装配、状态栏、帧投影、工具参数校验 | `MemorySessionRepo` + `fauxProvider`（pi-ai 公开导出，`packages/ai/src/index.ts:36`）+ `InstrumentedStorage` |
| unit（崩溃） | 宿主的串行与 alarm 重入 | `GatingStorage` / `CommitDiscarded` |
| integration | Neon backend | 上游 conformance × `packages/test-postgres` |
| integration | 6 个领域工具 | **真工具**：本地 catalog + `packages/test-postgres` |
| eval | §七 | 真模型 + 真工具 |

**替身只用在 pi 自己用替身的地方**（provider 与 storage 的 plumbing 测试）；**工具一律真跑**（owner）。上游的 operation 状态机、恢复、压缩由上游测试负责，我们不重写它的测试。

## 七、eval 重设前提

**被测系统 = Model + Harness，在进程内。** 没有数据库、没有 staging 路径、没有网关。

- **task** = 用 `MemorySessionRepo.create()` 开 session（`dist/harness/session/index.d.ts:7`）、`AgentHarness.create`、`accept` + `drive` 到 settled；**转录经 W1-6 那同一个投影器**成型（§4.2.1），不是在 eval 里另写一套 entry→步骤的映射——两个见证人就是那张表里的 `tool_start.args` 与 tool-result entry 的已结算参数（#1381）。要留盘产物时换 `JsonlSessionRepo`（一行一 commit，`harness.md:356-367`）。
- **真模型 + 真工具**：catalog 走本地 + `packages/test-postgres`，**`web_search` 真发**（owner：不稳定可接受；它同时是 `profile_v1` 的漂移探测器）。
- **轨迹前缀 = `fork({scope:"tree"})` 的每例录制 session**（`types.d.ts:491-499`），**不是 `scope:"branch"`**：`harness.md:547` 写死「tree scope copies every current application scalar and every surviving application list element; **branch scope copies none** … Applications re-derive branch-scoped state」，而今天真正需要前缀的 `phase1c_selection_v1` 五例，要的恰恰是**应用状态**（未决澄清、候选列表、revision），不是 entries——branch fork 会让被测的那次选择又答 `SELECTION_EXPIRED`，正是 #1380 的老失败。备选是 branch fork + 宿主从 entries 重新推导那些 value，但那要自己证明等价。取舍见 **D12**。源一律是**本 TS agent 自己录的 session**——agent 重写过，Python 时代的轨迹一律不复用。这取代了整套 `seedTrajectoryPrefix` + staging 路由。
- **pass^k** 沿用 eval spec 修订 5 的定义：logfire `repeat` + `caseGroups`，三态 `pass / fail / incomplete`（`attempts = runs + failures`，已知失败优先判 fail），`REQUIRED_ASSERTIONS` 具名逐条到齐、`MaxDuration` 与装置断言不得替代，judge 不进否决名单。
- **三档保留**：`prefix_gate_v1` / `reliability_v1` / `profile_v1`；淘汰规则四条（真空通过 / 零判据 / 冗余 / 背离只立案不淘汰）保留。
- **`logfire/evals`** 仍是框架，`@pydantic/logfire-node` 的 `configure()` 打开 Experiments UI 核实面（`/tmp/logfire-js-evals.md:26-35`；SKILL:120）；全量前 smoke 2–3 例（SKILL:84）。
- **统计门**（分层配对 bootstrap，种子 309/2000 次）保留：上游与 logfire 都没有配对显著性检验。

## 八、版本策略

- **owner 2026-09-09 明确接受这笔赌注**：上游把 format 4 标为 pre-stabilization、可无迁移原地改形（`harness.md:158`），CHANGELOG 又不记 harness 变更——这两件事**已知且被接受**，代价由下面的版本纪律承担。
- **精确 pin `0.85.1`，永不 pin `0.85.0`**：0.85.0 误发了内部实验代码，0.85.1 才回收（`packages/coding-agent/CHANGELOG.md:34`）。
- **升级读 diff，不读 CHANGELOG**：0.85.x 的 CHANGELOG 对 harness 只字未提（`packages/agent/CHANGELOG.md:5-12`），而 0.84→0.85 之间持久化模型从 records/facts 换成 entries + values/lists，属未公告的 breaking。
- **format 4 是 pre-stabilization**：「shapes may change in place without migrations; do not invent migration obligations for them」（`harness.md:158`），且 R11 迁移机制 specified-not-implemented（`:150`）。**我们的 Neon 表照 format 4 语义，所以上游一次 in-place 改形 = 我们自己写一次迁移**——升级卡必须含「跑一遍 conformance + 数据迁移评估」。
- **已知未实现清单**（`harness.md:143-156`）：J1（JSONL 快照压缩，死字节不回收）、R12（`watchSession()` 抛 `SliceNotImplemented`——我们用 `lane.watch()`，不受影响）、T1（telemetry 只发 hook span）、S3（search 只有骨架）、R11（迁移）、H1（`OperationStatus` 的 `"running"` 观测不到）、WP08 named-branch fork 只完成 Slice A、SQLite 分支分歧可 copy O(history)（与我们无关）。
- pi-ai 0.85.0 的 breaking：`createGatewayBindingFetch()` → `createAiBindingFetch()`（`packages/ai/CHANGELOG.md:24`）——我们的 BYOK 与模型层要一起过一遍。
- **供应商退避改由 harness 拥有**：`AgentHarnessOptions.retry?: RetryPolicy`（`agent-harness.d.ts:628`）。我们今天的 `guardedMimoTurnModel` 与 catalog 重试梯子要写出一张映射；eval 侧的 provider-outage 判定改读 `run_end.error` / `retry_end.finalError`，不再自己猜。

## 九、决策题（owner）

1. **D1 — 执行器要不要有状态？宿主用什么？（owner 2026-09-10 定：方案 (1) 瘦 DO 宿主）** 裁决经过三步：先按 owner 的「worker 池放在 DO 那边」拟了 **(2′) 协调者/执行者拆分**，再按「应该用 worker、不该用 DO」改成 **(2) 全无状态 + Neon 租约 + Queues**，最后定回 **(1) 瘦 DO 宿主**。**定案形态**：一 session 一个 DO，宿主约 100 行，只做互斥（DO 天然串行）、`setAlarm` 排程、以及那条活着的 SSE 流；**零 DO 存储**（会话状态全在 Neon 的 pi `Storage`，宿主里任何 `ctx.storage` 写判红）；`locationHint` 钉 APAC 就近 Neon；**执行者模块 DO 无关**，eval 在 Node 里实例化的就是它。**由此退出主线的**：Neon 租约行、Queues producer/consumer 及其部署面、RPC 的 NDJSON 中继、独立协调者。
   **(2) 与 (2′) 记为回退**，触发条件写死：**(a)** DO 的 wall-clock 计费在长回合上不可接受；**(b)** 单实例的可用性或 CPU 配额成为瓶颈；**(c)** 需要跨实例扇出（多 tab / 多区域）超出一个 DO 能给的。触发任一条就走下表的 (2′) 或 (2)——**执行者那一层不用改，因为它本来就 DO 无关**。
   下面四方案的比较原样保留，作为回退时的现成论证。
   **owner 2026-09-09 追问**：「我们就应该用 worker，不应该用 DO；或者 worker 池放在 DO 那边」。据此把**协调者/执行者拆分**列为 **(2′)** 并作为主选项评估。

   | 方案 | 单写者 | 唤醒延迟 | 成本 | 出错波及面 | SSE 怎么接 | 迁移量 |
   |---|---|---|---|---|---|---|
   | **(1) 已定：瘦 DO 宿主**——互斥 + alarm + 活流，零 DO 存储，drive 在 DO 里跑 | DO 实例天然串行，**不另加租约行** | `setAlarm` 秒级 | DO 按 wall-clock 计，长回合全程计费 | 单 session | 最简单：drive 与订阅同实例 | 最小 |
   | (2′) 协调者/执行者拆分（**回退**）：DO **只**做协调者（租约、`setAlarm`、SSE 中继），每一趟 `drive` 在**无状态 Worker 调用**里执行 | DO 持租约，执行者带租约令牌，且必须尊重 `aborting` | 同 (1)（仍由 DO alarm 触发） | 每趟 **两次调用**（DO alarm + 执行者请求），且 DO 在整趟 pass 期间要**一直活着持有执行者的流式响应**（受 alarm 的 15 分钟上限约束，≤130 s 绰绰有余）——它省下的不是存活时间，是**不再自己跑 pass** | 单 session；执行者是纯函数，炸了就是这一趟 | **需要中继**：执行者把 `HarnessEvent` 回传协调者（见下） | 中：多一条执行者边界与事件中继 |
   | (2) 全无状态 Worker + Neon 租约行 + Queues 延迟消息，无 DO（**回退**） | 只靠 Neon 租约行——今天的 `lease_owner`/`lease_expires_at` 是 **`runs` 表上的列**（`db/schema.ts:186-187`），而 `runs` 被 D6 退役，所以这对列要由 **W0-2** 搬进新的租约表；「已存在」只在 W2-1 之前成立 | Queue/cron 粒度，比 alarm 粗 | 无常驻实例 | 全局 | **不需要中继**：drive 与 SSE 在同一个请求里，配对天然成立；断线只剩重连 `resnapshot` | 中：Queues 是仓库里的新面，但执行者本来就无状态；见 §4.1 第 5 条。今天 `wrangler.toml` 里一个都没有 |
   | (3) Cloudflare Workflows 当持久执行器 | Workflow 单例 | 平台调度 | 按步计 | 单 workflow | 同 (2) | 最大；与 pi 的 operation 状态机职责重叠 |

   **(2′) 的四个技术问题，逐个查过：**
   - **(i) 怎么调用执行者，跑不跑得完一趟 20–130 s 的 pass。** Cloudflare 的口径是 CPU 与 duration 分开计：「Waiting on network requests (such as `fetch()` calls, KV reads, or database queries) does **not** count toward CPU time」，付费版 CPU 默认 30 s、可经 `cpu_ms` 提到 5 分钟；HTTP 请求**只要客户端还连着就没有强制 duration 上限**，而 **Cron / Queue consumer / Durable Object alarm 的上限是 15 分钟**（developers.cloudflare.com/workers/platform/limits/，2026-09-09 读）。一趟 pass 是 provider-bound，CPU 花的是解析与投影，**限制不在 CPU 而在 duration**；DO alarm 自己的 15 分钟预算覆盖 130 s 绰绰有余。因此**首选 service binding 的 `fetch`**：协调者在 alarm 里同步调用执行者、拿回 `DriveOutcome`，全程在那 15 分钟里。Queues 会把「拿回结果」变成异步（协调者要另存一次待决态），Workflows 更重。另有两条同页事实要写进设计：**(a)**「When the client disconnects or the response is complete, tasks associated with that request may be canceled … `waitUntil()` can extend execution for up to 30 seconds」——执行者的「客户端」就是那次 DO alarm，**alarm 结束或 DO 被驱逐即是执行者的中止信号**，而这正好落在上游的恢复路径上（operation 保持 open，下一次 alarm 的 drive 收尾，`harness.md:967-991`）；**(b)**「Workers triggered via Service bindings share the same connection limit」（同时等待响应头的六个连接）——一趟 pass 的模型流 + catalog + web search 放得下，但 **S2 要记录峰值**。**以上全部限制仍以 S2 实测为准**，文档口径不等于我们这条链路的实测。
   - **(ii) SSE。** `watch()` 给的是**活实例上的内存订阅**（`WatchHandle{snapshot,start,resnapshot,unsubscribe}`，`harness.md:1128-1133`），harness 对 snapshot 与流的无缝保证来自事件总线的绑定时机（`harness.md:1164`）与不变式 35（`:1353`）——**那份保证只在持有 harness 的那个进程里成立**。拆开之后 harness 活在执行者里，浏览器连的是协调者，所以必须二选一：**(a) 执行者把 `HarnessEvent` 流式回传协调者**（service binding 的响应流 / WebSocket），协调者原样转投给订阅者——延迟只多一跳，且**保住上游的 snapshot+stream 配对**；(b) 协调者不接事件、改从 Storage 变化投影——那是自己重造一遍 reducer，会丢掉「配对无缝」这条保证，也把 SSE 延迟绑在轮询周期上。**推荐 (a)**，传输形态已定稿：**执行者做成 `WorkerEntrypoint`，用 service binding 的 RPC 返回一个 `type:"bytes"` 的 `ReadableStream`，逐行吐 NDJSON 编码的 `HarnessEvent`**。**必须说清的一条**：Workers RPC「Only byte-oriented streams（底层字节源为 `type: "bytes"`）are supported」，**没有对象流**，所以「返回 `ReadableStream<HarnessEvent>`」这种写法不存在；流的**所有权转移给接收方**（发送方之后不能再读，`tee()` 会失去流控——这条同时约束了 D16(a)：不能在执行者侧留副本）；32 MiB 上限只管**非流式**返回值，流本身自动背压、不受它约束。所以**序列化那一跳省不掉**（修订 4 写的「省了一道序列化」是错的）；选 RPC 换来的是类型化调用面、自动背压与不走公网。**协调者不是字节管道，是读写节点**：它逐个消费事件、就地记账（续租、重置 alarm、判定 settle、多 tab 扇出），再把事件序列化成 SD-9 帧 `enqueue` 进对浏览器的 `TransformStream`（`Content-Type: text/event-stream` 的 `Response`）。备选是 HTTP 直传（`new Response(res.body, res)`），留作退路。协调者仍然负责重连（`resnapshot`，W1-10）。
     两条硬约束一并写进 W1-6：**(a) Cloudflare 边缘对空闲 HTTP 连接是 400 秒硬上限、不可配置**，所以 SD-9 流必须有远小于 400 s 的**心跳注释帧**；**(b) 断线重放没有官方样例**——Cloudflare 没有任何一处演示服务端解析 `Last-Event-ID` 并从缓冲重放（Agents SDK 走的是 WebSocket + SQLite 缓冲重放，不是 SSE 原生机制），**这块的设计是我们自己的**：要么协调者把 `HarnessEvent` 按游标缓冲、重连时按游标重放，要么明确接受尽力而为并靠 `resnapshot` 兜底（**D16**）。
     **顺带排除一个现成方案**：Cloudflare Agents SDK（`agents` / `AIChatAgent`）假定 LLM 循环跑在 DO **里面**（`onChatMessage` 在 DO 内调 `streamText`，配 `keepAliveWhile`、`runFiber` 持久恢复，子 agent 是 DO facet）——它会把执行者拽回 DO，与 (2′) 正相反，**不采用**；它唯一形状相符的是 Workflows 集成那条（RPC 进度回调 + 显式 `broadcast`）。**但它的一个原语我们要照搬**：`keepAlive` 那种 30 秒 alarm 心跳——我们自己实现同一件事（协调者的 `setAlarm` 兼做防驱逐心跳），照搬的是原语不是框架。前端侧 AI SDK 的 `createUIMessageStream` + `writer.write({type:"data-*"})` 是 Workers 上写自定义 part 的官方钩子，SD-9 → `useChat` 的适配仍是我们的胶水。
   - **(iii) 执行者中途死了。** 上游的语义正合用：一趟 drive 崩在任何一点，operation 仍是 open 的，恢复由下一次 `drive` 完成，崩溃点只有四个且「Atomic transactions have no internal prefix」（`harness.md:967-991`）。所以协调者的 alarm 就是恢复机制——**这与 (1) 完全一样**，拆分没有新增恢复语义。租约必须由协调者持有、执行者只是持令牌代跑，且执行者每趟都要读一次 `aborting`（`open` 里带这个标志）。
   - **(iv) Workflows 能不能连协调者一起替掉。** 能想象，但要付两笔：一是把「单写者」这件事托付给 Workflow 实例的单例语义（而 (1) 根本不需要租约行；今天 `runs` 上那对列随 D6 一起退役，`db/schema.ts:186-187`），二是 Workflow 的持久步骤模型与 pi 的 operation 状态机**在同一件事上重叠**——两套重试、两套恢复。且 Workflows 今天在 `wrangler.toml` 里没有任何存在。**不推荐**，除非将来 DO 成本成为问题。

   **（历史记录，已被 owner 2026-09-10 的裁决取代）当时推荐 (2′)，落地为一个 SSE 中继而不是两次实现。** 理由三条：agent 变成一个**真正无状态、可在任何地方实例化的执行者**（这正是 eval 要的那个单元）；DO 缩到租约 + 闹钟 + 中继三件上游明说要宿主做的事（`harness.md:120,121,403`）；而 (1) 与 (2′) 的差别只有「drive 在哪跑」，随时可退回 (1)——当时打算「先做 (1) 的接口形状、在 S2 里同时实测 (2′) 的执行者边界」——**这一段属历史记录，不再执行**。**(2) 与 (3) 都要引入今天不存在的平台面**，不在本 spec 范围。
   **对 §4.1 的影响**：§4.1 已按 (2′) 改写成协调者 / 执行者两个模块；取 (1) 则两者合一，其余不变；取 (2)/(3) 则 §4.1 与 S4 重做。（**已定；这句「W1-2 不能开工」的旧标注随裁决作废**。）

2. **D2 — 我们的业务列放哪里（owner 已定：按推荐）？** 推荐**放 pi 模型之外的自有表**（quota / identity / lease / payer），只在 session 里存与对话有关的状态（envelope 那套改成 application namespace 的 value/list）。备选：全塞进 values——会让配额的读写受 commit 事务节奏摆布。
3. **D3 — 确定性选择（#1288/#1462）怎么落？（owner 已定：(b)）** 原稿的 (a)「非模型 operation」**不存在**：`OperationRequest` 只有 `prompt`/`skill`/`prompt_template`/`compaction`/`navigation`（`agent-harness.d.ts:48-77`），`prompt` 一定会打到 provider。剩两条：**(b) owner 定案——宿主在 harness 之外直答，用 `appendMessage`（`:641`）+ `appendCustomEntry(customType, data)`（`:642`）记进 branch**，服务端发起的步骤因此有一等 entry 类型，#1462 的 `origin` 白拿；(c) 做成一个总是本地执行的 `AgentHarnessTool`——省事，但那一步在 entries 里看起来就是模型调的工具，`origin` 又要另存一份。
   **写清楚一件事以免被读成产品改动**：clarify 在用户侧已经是生成式 UI（`chat-data-parts.ts:45` 的结构化 `candidates` → `ClarifyCard.tsx`，回来走 `agent-contract.ts:89-99` 的确定性选择通道，不是自由文本）。(b) 之后**这一侧完全不动**；`appendMessage` + `appendCustomEntry` 写的是**会话内部记账**，只影响下一轮模型看到的上下文，**不向用户新增任何东西**。一处连带：`clarification_id` 过期回 409 的规则（`agent-contract.ts:97-99`）今天从 envelope 读未决澄清（`selection/turn-selection.ts:144` 的 `validateCandidateSelection`），envelope 退役后它要改从 **session value** 读——这一项归 **W1-8**。
4. **D4 — 换 harness 的同时换不换 SD-9 帧（owner 已定：按推荐）？** 推荐**不换**（§三非目标）：帧是 web 的契约，投影层是我们的适配器；`HarnessEvent` 与 SD-9 的映射写成一张表并用测试钉住。
5. **D5 — Neon backend 是新包还是进 `workers/edge`（owner 已定：按推荐）？** 推荐**新包 `packages/pi-session-neon`**：它要跑上游 conformance（Node 侧），而 edge 是 Worker bundle；分开才能让 conformance 在 CI 里独立成 lane。
6. **D6 — 迁移策略：并行双跑还是硬切（owner 已定：按推荐）？** 推荐**硬切 + 新 session 起算**：format 4 与我们今天的 `runs`/`messages`/`run_steps` 没有语义对应，双写会同时维护两套恢复语义。历史会话保留只读（现有取回面继续读旧表），新会话一律新路径。若 owner 要求历史可续聊，那是另一张迁移卡。
7. **D7 — `packages/eval` 留多少？（owner 已定，原则：「能用 eval SDK 的就不手写」）** 两张清单，各只出现一次。
   **被库替掉的**：通过判定 → 评估器返回 `boolean` 走 assertion 通道（evals.md:134）；model-backed 判官 → `LLMJudge` + `setDefaultJudge`；单例耗时 → `MaxDuration`；k 次重复与分组 → `repeat` + `caseGroups`；用例存储 → YAML 数据集 + JSON schema（`toFile`/`fromFile`）；终端报表 → `renderReport`；**人**核实这一跑 → Logfire 的 Datasets & Experiments UI。
   **保留手写的**（库没有）：**分层配对 bootstrap 显著性门**；**provider-outage 分类**（库只分「成功/抛错」，新口径读 `run_end.error` / `retry_end.finalError`）；**我们的领域评估器**（写成 `Evaluator` 子类）；**淘汰规则**；**基线铸造**；**提交进仓的机器可读结果文件**——人看 UI，**CI 判的是那份 artifact**（owner 追认）。
   **整条 staging 任务链**（HTTP task、bearer、并发信号量、转录 HTTP 成型）随 §零 删除。
8. **D8 — spike 失败怎么办（owner 已定：按推荐）？** 推荐把 S1–S4 的任一条红当作**回到 owner**，而不是自动回退——0.84.4 的现状能跑，没有时间压力。
9. **D9 — 升级节奏（owner 已定：按推荐）？** 上游约一周一发（`packages/agent/CHANGELOG.md:5-33`）。推荐**季度评估 + 安全修复即时跟**，每次升级跑 conformance 与 S1/S2/S4；不追新。
10. **D10 — 逐文件删除清单要不要单独评审（owner 已定：按推荐）？** 推荐**要**：W0-1 先产出 115 个文件的 delete/adapter/keep 判定并单独过一轮评审，再开 W1；spec 里只放目录级判定（§2.1）。凭印象写的清单会漏掉 sweeper/settlement/retrieval 这种「看起来是业务、其实读的是要死的表」的文件——第一版就漏了，而且把 113 写成了文件数。
11. **D11 — 准入的幂等键与预留时序（改写；owner 的「按推荐」当时批的是已被推翻的措辞）。** 旧稿写「宿主铸 `operationId`、以它为幂等键预留、再 `accept`」——**那条键是错的**：`operationId` 是接受**之后**的不可变元数据（`harness.md:602`），客户端重试时手里只有 `client_message_id`；并发 accept 的败者是 `LaneBusy`（`:736`、`:1039`）。**定案**：**客户端侧的幂等键**是 `(session_id, client_message_id)`（HTTP 重试认它），顺序是**先写准入意图（并在此为该 client key 分配 `operationId`）→ 再预留 → 再把那个 id 显式传给 `accept`**（§4.2.2.1 的 ⓪①②③）。`OperationRequest.operationId` 可由调用方给（`lane.js:319`），所以恢复端能**按 id 直接查 `create.open` / `getResult`** 判定，而不是靠转录猜——**窗口 ③ 由此变成确定可判**。仍规定「接受被拒 / 孤儿预留」的对账，并加一条：**该 session 有未对账的 pending 意图时不接新准入**。**必须有的测试**：响应丢失后客户端用同一 `client_message_id` 经**真实入口**重试，不产生第二个 operation、不二次扣减；以及故障停在**接受提交刚返回**的那一刻。
12. **D12 — 前缀用 tree fork 还是 branch fork + 重推导（owner 已定：按推荐）？** 推荐 **tree fork**（`scope:"tree"` 复制全部应用标量与列表，`harness.md:547`），代价是每例一个完整录制 session。备选 branch fork + 宿主从 entries 重推导 envelope 值，省存储但要自己证明等价——那正是 #1380 踩过的坑。
13. **D13 — 新 session 的读面放哪（owner 已定：按推荐）？** `GET /v1/conversations/{id}/messages` 今天跑在 **Worker 里、不在 DO 里**（`retrieval/conversation-retrieval.ts:11`）。推荐**保持这个分工**：读面在 Worker 里直接走 `Storage.scanBranch`（只读，无需租约），**只有断线重连**才需要 DO 的 `watch().snapshot`。备选是全部收进 DO——会把每次翻历史都变成一次 DO 唤醒。
14. **D14 — 计费真相在 usage ledger 还是我们的 `dailyUsage`（owner 已定：按推荐）？** 推荐**继续以 `dailyUsage` 为账，ledger 为源**：W1-7 从 `scanUsage({fromSeq})`（`types.d.ts:376-381`）增量读进我们的表，因为配额与计费口径（日窗、payer、退款）pi 不认识。
15. **D15 — 旧 session 迁不迁（owner 已定：按推荐）？** D6 定的是「历史只读旧表」；**要不要把旧会话搬进 entries** 是独立一问。推荐**不迁**：旧表继续服务旧会话的读面，直到自然衰减；迁移要写一次 format-4 的映射，而 format 4 本身还在 pre-stabilization。
16. **D16 — 断线重放怎么做（owner 2026-09-10 定：(b)）？** Cloudflare **没有任何一处**演示服务端解析 `Last-Event-ID` 并从缓冲重放（Agents SDK 走的是 WebSocket + SQLite 缓冲重放，不是 SSE 原生机制），所以这块是我们自己的设计。二选一：**(a) 协调者按游标缓冲 `HarnessEvent` 并在重连时按游标重放**，代价是 DO 里要有一个有界缓冲与淘汰策略；(b) 尽力而为：重连一律 `resnapshot` 拉快照、丢掉断线期间的增量帧——够用（owner 的核心场景是「切走再回来拿到完整结果」，快照就能满足），但正在流式输出的那一段会跳变。**owner 2026-09-10 定：先 (b)，(a) 留成一张后续卡**。D1 取 (1) 之后有一个**附带好处，但不作为要求**：实例还活着时的重连**可以**直接重新挂上 `watch()` 拿到当前 snapshot 与后续事件；实例已被驱逐或回合已结算时仍然只能重新取快照。所以判据仍是 (b)——**「切走再回来拿到完整结果」由快照满足**，不承诺补发断线期间的增量帧。心跳由宿主的定时器发（§4.1 第 6 条）。



## 十、分卡

一卡一 worktree 一 PR；`needs` 是硬依赖。test-type：`unit | integration | eval | api | browser | ci`。

| 卡 | 范围 | needs |
|---|---|---|
| **W0-1** 逐文件判定清单（115 个文件，单独评审，**D10**） | `workers/edge` | — |
| **W0-2** 新 schema 与迁移：`entries`/`values`/`lists`/`usage_ledger` + 配额/预留表 + **`open_operations`**（协议三/W1-9）+ **待结算记录**（协议五）+ **`(session_id, client_message_id) → operationId` 唯一映射**（协议四）。**不需要租约表**（单写者由 DO 提供），**也不需要 Queues** | `migrations/neon`、`packages/pi-session-neon` | W0-1 |
| **P0-S1** workerd 打包 spike（0.85.1 + chord） | `workers/edge` | — |
| **P0-S2** 部署好的 DO 里跑完一趟 ≥130 s / ≥3 工具的回合，**中途断开客户端** | `workers/edge` | P0-S1 |
| **P0-S3** Neon backend + 上游 conformance | `packages/pi-session-neon` | P0-S1、W0-2 |
| **P0-S4** **实例被弃**（`ctx.abort()`）后的恢复与工具重放边界 | `workers/edge` | P0-S2、P0-S3 |
| **W1-1** 升 pin 到 0.85.1，过 pi-ai breaking | `workers/edge`、`packages/eval` | P0 全绿 |
| **W1-9** sweeper 重写：**`ensureScheduled`（准入前排程，从被删的 `turn-intake.ts` 接手）** + 扫 `admission_intents` 的 `pending`/`accepted` + 扫待结算记录 | `workers/edge` | W1-1、P0-S3 |
| **W1-2** 瘦 DO 宿主（两条不变式：DO 存储无会话状态、宿主无 run engine；互斥 + `setAlarm` + 活流 + `locationHint`）与 **DO 无关的执行者模块**（**D1 方案 (1)**） | `workers/edge` | W1-1、P0-S3、W1-9（宿主要写 `open_operations`，索引先在） |
| **W1-3** hooks：配额与身份（`before_drive`/`before_tool`，fail-closed） | `workers/edge` | W1-2 |
| **W1-4** 工具迁 `AgentHarnessTool`（**逐个声明 `replay?: "never"｜"safe"`**，`dist/types.d.ts:351`；授权与预算落在 `execute` 入口、按 `invocationId` 幂等）+ 模型/BYOK 接 `models` | `workers/edge` | W1-2 |
| **W1-5** 状态栏 + 冻结摘要，**两者都在 `transform_context`** | `workers/edge` | W1-2 |
| **W1-6** SD-9 投影：**DO 内**从 `watch()` 直接成帧（§4.2.1 那张表逐行）+ 400 s 心跳 | `workers/edge` | W1-2 |
| **W1-10** 读面重建：历史页走 `findEntries`/`scanBranch`，重连走 `watch().snapshot` | `workers/edge` | W1-6 |
| **W1-7** 结算重写：待结算记录 + `getResult` 见证 + `scanUsage({fromSeq})` → `dailyUsage` 单事务（**D14**、协议五） | `workers/edge` | W1-2 |
| **W1-8** 确定性选择按 **D3** 落地 + 409 过期规则改读 session value | `workers/edge` | W1-4 |
| **W2-1** 删除清单执行 + 适配器收口 | `workers/edge`、`packages/contract` | W1-* 全部 |
| **W2-2a** 测试重建 · Tier A/B（`MemorySessionRepo` + `fauxProvider` + `InstrumentedStorage`） | `workers/edge` | W2-1 |
| **W2-2b** 测试重建 · Tier C 崩溃交错（`GatingStorage`/`CommitDiscarded`） | `workers/edge` | W2-2a |
| **W2-2c** 工具层集成测试（真 catalog + test-postgres） | `workers/edge` | W2-1 |
| **E-1** eval task 换成进程内 harness（`MemorySessionRepo`） | `packages/eval` | W1-4、W2-1 |
| **E-2** 前缀 = `fork({scope:"tree"})`（**D12**）+ 语料重录 | `packages/eval` | E-1 |
| **E-3** pass^k + `REQUIRED_ASSERTIONS` + 三档分集 | `packages/eval` | E-1 |
| **E-4** 重铸基线 + lane 接线 | `packages/eval`、`.github/workflows` | E-2、E-3 |
| **W4** 删 `apps/agent` + uv 臂（原 W4，顺序不变） | 全仓 | E-4 |

**验收（每卡的硬 AC，节选）**

- **W0-2** — [ ] **(integration)** 四张表在 `migrations/neon` 里建起来并带各自的约束：`admission_intents` 的 **`(session_id, client_message_id)` 唯一**且状态限于 `pending｜accepted｜settled｜void`、`open_operations` 的 **`operation_id` 主键**、待结算记录**按 `operation_id` 键且有 `settled_at` 守卫**、以及配额/预留表；变异：去掉任一约束，对应的重放测试红。
- **W0-1** — [ ] **(unit)** `git ls-files workers/edge/src/agent` 的 **115** 个文件每个都有 delete/adapter/keep 判定与替代接缝，含目录根下的 `durable-namespace.ts`（13）与 `json-record.ts`（9）；`db/schema.ts`、`migrations/neon/*agent_runs*`、`gateway/agent-turn.ts:24-31` 三处在列；清单单独评审通过后才开 W1。
- **P0-S1** — [ ] **(ci)** `wrangler dev` 下 import 0.85.1 与 chord 并调用一次 `AgentHarness.create`，成功；bundle 体积增量记入卡；**`esbuild` 不在产物里**（`grep` 产物为 0）。[ ] **(unit)** bundle-smoke 常驻。
- **P0-S3** — [ ] **(integration)** `createStorageConformance` 与 `createSessionRepoConformance` 及另外 8 个套件在 test-postgres 上全绿，**一个 skip 都没有**；跳过任一条即卡红。
- **P0-S4** — [ ] **(integration)** 杀实例后由 `alarm()` 对 `open` 逐个 `drive({operationId, waitForRetry:false})` 得到完整结果。**判据用 §五 S4 的逐工具矩阵，不是「零重复执行」**：声明 `safe` 的工具每个 `invocationId` **最多一次外部效果**（允许被再次调用）；声明 `never` 的工具得到显式 `interrupted`；三个持久边界各注入一次故障。
- **W1-2** — [ ] **(unit)** `drive({waitForRetry:false})` 返回 `waiting{notBefore}` 时宿主 `setAlarm(notBefore)`；变异：改成 `waitForRetry:true`，测试红。[ ] **(integration)** alarm 或实例重启后对 `open` **逐个 `drive({operationId, waitForRetry:false})`，从不 `resume`**；`aborting` 走取消对账。[ ] **(unit)** **宿主零会话存储**：`ctx.storage.put`/`delete`/`deleteAll`/`transaction`/`sql` 一律禁（alarm 那组允许）；变异：加一次 `ctx.storage.put`，测试红。[ ] **(integration)** **跨 await 的互斥**（§4.2.2 协议二）：在 Neon 的 await 点上交错两个 `fetch` 与一次 `alarm`，只有一个 `Session`/`AgentHarness` 被初始化，`accept`/`drive`/业务写不重入。[ ] **(unit)** **accept 即 armed 闹钟**（协议三）：`accept` 成功后立刻有 alarm，且 `open_operations` 有行；变异：只在 `waiting` 时 setAlarm，「accept 后立刻杀实例」的用例测试红。[ ] **(unit)** drive 期间有 ≈30 秒的重复保活 alarm；变异：去掉它，断线后 pass 不再跑完的用例测试红。[ ] **(unit)** **执行者模块 DO 无关**：它的 import 图里没有 `DurableObject`/`ctx.storage`，同一个模块在 Node 里用 `MemorySessionRepo` 跑得起来（变异：在执行者里引 DO 类型，测试红）。[ ] **(unit)** **所有** `AGENT_SESSION` stub 都经 `durable-namespace.ts` 的 `sessionStub()` 取得，并带 `locationHint: "apac"`；变异：任何一处裸 `get(idFromName(...))`，测试红。（文档两条限制照录：只有第一次 `get()` 认 hint、创建后不换位置。）[ ] **(integration)** 同一 session 的两个并发请求由**宿主的显式互斥**串行，不并写——不能只靠单实例（pi 对第二次 `drive` 是等待而非拒绝，`lane.js:729-731`）。[ ] **(unit)** **alarm 只有一个槽**：下一次唤醒 = `min(保活 tick, notBefore)`，且在 `alarm()` 内部重排；变异：把保活 alarm 与 retry alarm 各自 `setAlarm`，后设的覆盖前设的、测试红。[ ] **(unit)** `alarm()` 里已有 drive 在飞时直接返回，不起第二次 drive。[ ] **(unit)** **每个请求入口与 `alarm()` 都先查宿主的 fault 标记**，有标记就在互斥内先跑对应的重挂（按协议二分流），跑完之前不做任何 `accept`/`drive`（§4.1 #3.1）；变异：跳过这一检查，测试红。
- **W1-9** — [ ] **(unit)** `ensureScheduled` 由 **DO 宿主**调用，位置在表的 ① **之前**，每个 incarnation 一次即可——它本来就是幂等的（`sweeper/run-backstop.ts:12-14`：「`ensureScheduled` is idempotent and cheap (the DO re-arms itself after every sweep, so the common case writes nothing)」）。
- **W1-9** — [ ] **(integration)** **全新的 DO namespace、第一个请求**：崩溃停在 ③ 之后、⑤ 之前，**客户端不重试**，仅靠 sweeper 恢复到结算——证明 `ensureScheduled` 在准入之前就已生效（变异：把它挪到准入事务之后，本例测试红）。
- **W1-3** — [ ] **(unit)** **日常配额拒绝发生在 `accept` 之前**，不经 `before_drive`；变异：把配额判定挪进 `before_drive`，「一次拒绝之后同一实例还能接下一条合法请求」的测试红（因为实例已被 fault，`lane.js:734-754` → `harness.js:231-243`）。[ ] **(unit)** 永久性拒绝 ⇒ 持久取消 + 结算 + **退款**；临时性依赖故障 ⇒ 排程重试，不写终态。[ ] **(integration)** 一次拒绝之后：operation 被释放、预留被退、**同一 session 的下一条合法请求被正常接受**。[ ] **(integration)** **准入幂等按 `(session_id, client_message_id)`**（协议四）：映射在预留**之前**持久写入；「响应丢失后客户端用同一 `client_message_id` 重试」经**真实入口**重放，**拿到同一个预分配的 `operationId`**、不产生第二个 operation、不二次扣减；孤儿预留（意图已写、`accept` 未成）按那个 id 查 `inspectExecution().current`（重建后第一次可用 `create.open`）→ `getResult` 对账：在跑或已终态 ⇒ 接受了，补 ④⑤；两者皆无 ⇒ 释放预留、意图转 `void`（**D11**）。[ ] **(unit)** 该 session 有未对账的 pending 意图时，新的准入被拒。[ ] **(integration)** **同一实例上 ④ 失败**（accept 已成、业务事务没成）：sweeper 补完 ④⑤ 并结算，**绝不退款判废**。[ ] **(integration)** **create 之后才被接受、且处于 retry-waiting 的 operation**：alarm 照样把它 drive 起来。[ ] **(unit)** 变异：把 `create.open` 缓存下来当作「当前有哪些 open operation」的依据，上面两条测试红。
  [ ] **(integration)** **存储提交成功、提交调用抛错、DO 还活着**（协议八）——在 ③ 注入：重挂后那笔**合法的 operation 继续跑或按真实终态结算**，**不取消、不退款**；变异：走协议一的无条件 `requestAbort`，测试红。
  [ ] **(integration)** 同一形态在 **⑥/⑦** 注入：重挂后用 `getResult` 认到真实终态并据此结算；判定查询本身仍在失败期间，义务保持 `pending`（既不判「不存在」也不退款）。
  [ ] **(integration)** **第一次重开/`create` 也失败，之后某次 alarm 成功**：同一笔 operation 照常结算，**不取消、不退款**；变异：把「重开失败」当成终局判废，测试红。
  [ ] **(unit)** 分流判别只看**我们记下的拒绝理由**，不看异常类型或消息（两条路径都是同一句 `HarnessFault`，`harness.js:236-237` / `:306-308`）；变异：改成按异常判别，「存储提交失败」被误判成永久拒绝、测试红。
- **W1-8** — [ ] **(unit)** `clarification_id` 过期回 409 的规则从 **session value** 读未决澄清（`validateCandidateSelection` 的输入不再来自 envelope，`selection/turn-selection.ts:144`）；变异：让它读一个已被删除的 envelope 字段，测试红。[ ] **(unit)** 服务端发起的步骤经 `appendMessage` + `appendCustomEntry` 落成一等 entry，`origin` 可从 entry 直接读出；用户侧 SD-9 与 data part **一行不改**。[ ] **(integration)** **应用级 selection intent/result 记录**（协议七）带稳定请求键，与两次 append 幂等协调并进恢复扫描；**前置**：执行选择与 `appendCustomEntry` 之前，宿主互斥内确认该 lane **没有 open operation**（用 `inspectExecution().current`，不是缓存的 open 列表）；正忙则拒绝或等待。[ ] **(unit)** 恢复对账**先 selection intents、再 admission intents**，任一未对账即不接新准入。[ ] **(integration)** **在 retry-waiting 期间提交一次选择**：被拒或等到 operation 结束后才执行，**绝不进待写队列**（变异：允许排队，恢复端看不见该 entry、测试红）。[ ] **(integration)** **append 的响应丢失**（S2 的协议八形态：存储已提交、提交调用抛错、DO 还活着）：重挂后**按请求键 `findEntries` 认领那条已提交的 entry**，**不产生第二条 append**；变异：改走协议一，因为没有 operation 可 abort 而失败、测试红。[ ] **(integration)** **第一次重开/`create` 失败、之后某次 alarm 成功**：同一条选择 entry 被按请求键认领，**不产生第二条 append**。崩溃注入按默认形态是**三处**——选择已执行（S1）/ `appendCustomEntry` 之后（S2）/ 清除未决澄清之后（S4）——各自恢复到**恰好一次**的效果；只有退回两次 append 的备选形态时才是四处（多一个「第二条 append 之后」）。
- **W1-5** — [ ] **(unit)** 本轮看到逐字工具结果、下一轮看到冻结摘要、**entry 里存的始终是逐字文本**；变异：把摘要写进 `after_tool` 的 content patch，第三条断言红。[ ] **(unit)** 载体写死：摘要走 `after_tool` 的 **`details`** 补丁（`agent-harness.d.ts:569-576` 的 `content` / `details?: JsonValue`），**`content` 保持逐字**，`transform_context` 只把 `details` 里存的那个字符串读回来施加。[ ] **(integration)** **摘要是必需的持久 sidecar**：重启进程并**换一版 summariser** 后，历史里那条摘要**逐字不变**（`frozen-tool-return.ts:2-18` 的整条理由）；变异：改成读路径重算，测试红。[ ] **(unit)** 没有存过摘要的旧行**保留逐字原文**，不现场补算。
- **W1-7** — [ ] **(integration)** 待结算记录**独立于 open operation**，有自己的扫描路径（协议五）。[ ] **(unit)** ledger 游标 + `dailyUsage` + 退款标记在**同一个业务事务**里。[ ] **(integration)** 三处故障注入——终态提交后 / 业务提交前 / 提交响应丢失——各自**恰好结算一次**。
- **W1-6** — [ ] **(unit)** §4.2.1 那张表逐行有测试；`packages/contract` 的帧 surface **一行不改**（`git diff` 为空即证据）。[ ] **(unit)** SSE 在 **DO 内**由 `lane.watch()` 的 snapshot + 事件直接成帧，**没有跨进程中继**（变异：把成帧挪到另一个入口，测试红）。[ ] **(browser)** SD-9 流带**心跳注释帧**，间隔远小于 Cloudflare 边缘的 **400 秒**空闲硬上限；变异：关掉心跳并让回合静默超过阈值，测试红。
- **W2-1** — [ ] **(unit)** **W0-1 清单里判定为 delete 的每一个文件**从 `git ls-files` 消失（不是「十个文件」），含 `packages/contract/src/staging-prefix-*.ts`、`gateway/staging-prefix-route.ts`、`packages/eval/src/prefix-seeding-lifecycle.ts`、`packages/eval/src/trajectory-prefix-case.ts`；`db/schema.ts` 的 `runs`/`messages`/`run_steps` 只剩旧会话读面在用；`workers/edge` 全测试绿。
- **E-1** — [ ] **(eval)** 33 例进程内跑：真模型、真 catalog、真 web_search，无数据库、无 staging 凭据。
- **E-2** — [ ] **(unit)** fork 出来的 session 与源的 entries 逐字相等，**且 fork 点的应用 values/lists 与源相等**（`harness.md:547`：branch scope 一个都不复制）；变异：把 scope 改成 `"branch"`，第二条断言红。[ ] **(eval)** 五个 `phase1c_selection_v1` 用例从 fork 起跑不再答 `SELECTION_EXPIRED`。

## 十一、取代关系

- **`docs/specs/2026-09-08-eval-suite-redesign-spec.md` 全文被本 spec 取代**（它自己在 5 个修订里被 owner 前提改了三次）。**存活并搬进 §七**：三档套件与规模、pass^k 的三态判据与 `REQUIRED_ASSERTIONS`、淘汰四规则、`logfire/evals` 与 Experiments 核实、统计门、smoke 纪律、语料只从 TS agent 重录。**随本 spec 作废**：进程内宿主要新写 `TurnRecords`/多 run store（改由 pi harness 提供）、D5 的 test-postgres 回合表（eval 不再要数据库；test-postgres 留给 catalog 与 backend conformance）、`seedTrajectoryPrefix` 相关的一切（改 `fork`）、staging canary 与 CD 讨论（早已移交 smoke）。
- **`docs/specs/2026-09-01-agent-ts-rewrite-spec.md`**：**第 16 行非目标作废**；§五 W3（eval 搬 TS）与 §十（评估装置）由本 spec §七 取代；W1/W2 的功能对等清单仍是验收基准；**W4 顺序不变**，但前置从「eval 双跑」改成本 spec 的 E-4。
- **issue**（`gh issue view` 实查）：#1303（W3-5 双跑，OPEN）关为**被取代**；#1515 / PR #1527（TS 基线，OPEN）**先合再由 E-4 重铸**——它铸的是旧被测系统的基线，本次换 SUT 后必须重铸；#1380（前缀 seeding，OPEN）关为**被 `fork` 取代**，其已合入的代码进 W2-1 删除清单；#1309 / #1311 / #1462 已 CLOSED，其结论（种子无 wire 形态、第二见证人、服务端步骤不计分）在 harness 下重新成立或消失，逐条在 E-3 复核；#1243 / #1258 两个 epic 需要按本 spec 重排波次。

## 十二、风险

- **上游 pre-stabilization**：format 4 可在无迁移的情况下原地改形（`harness.md:158`）。缓解：pin 精确版本、升级读 diff、conformance 常驻、D9 的季度节奏。这是本次最大的一笔押注，**owner 2026-09-09 已明确接受**（§八）。
- **workerd 未被上游验证**：browser smoke 不等于 workerd smoke，chord 是硬依赖。缓解：P0-S1 是第一张卡，红则停。
- **删 ≈4,100 行会连带删掉未被上游覆盖的语义**（冻结摘要 #1378、状态栏 #1379、服务端步骤 #1462）。缓解：它们各自有接缝（§4.2）与 W1-5/W1-8 的卡，删除只在 W2-1、且在对等清单勾完之后。
- **conformance 全绿 ≠ 我们的语义对**：上游用例测的是 pi 的模型，不测我们的配额与租约。缓解：Tier A/B/C 三层里我们自己的那部分（§六）。
- **eval 的真 web_search 带来不稳定**（owner 已接受）。缓解：`prefix_gate_v1` 的前缀本就冻结；`reliability_v1` 的 pass^k 会把它量出来而不是掩盖。
- **删除清单写小了会漏掉活着的读者**：`sweeper`/`settlement`/`retrieval`/`turn-selection.ts:31` 看起来是业务，其实读写的是要死的表或要删的模块。缓解：W0-1 逐文件判定 + 单独评审（D10）。
- **`fork` 的 scope 选错会让前缀用例静默退化**：branch scope 不复制任何应用状态（`harness.md:547`）。缓解：D12 取 tree scope + E-2 的等价性 AC。
- **两条 spec 并存的混乱**：本 spec 落地前，eval spec 仍是 `packages/eval` 的说明书。缓解：本 spec 一签核，就在 eval spec 头部加一行 superseded 指针（那是签核后的动作，不在本次写作范围）。

## 附录 · 评审回应

**Seat A（Fable）r1 `APPROVE-WITH-CHANGES`：5 条 P1 + 11 条 P2 + 全部引用更正，逐条采纳。**

P1-1 删除清单只覆盖三分之一 → §2.1 改成从 `git ls-files` 生成的**逐目录判定**（113 文件 / 13,449 行，`session/` 一个目录 5,919 行），补上 run 引擎、envelope、`db/schema.ts`、`migrations/neon/*agent_runs*`、`gateway/agent-turn.ts:24-31`；**sweeper / settlement / retrieval 从「原样保留」改为「重写」**并各得一张 W1 卡（W1-9 / W1-7 / W1-10），逐文件清单本身成为 W0-1 与 **D10**。
P1-2 读面无卡 → 新增 **W1-10**（历史页走 `findEntries`/`scanBranch`，重连走 `watch().snapshot` 的 `streamingMessage` + `runningTools`，`harness.md:1100-1122`），并把旧 spec 的 `(browser)` 出口判据挂在它下面；放置问题成为 **D13**。
P1-3 `resume` 不是 DO 的原语 → §4.1 改成**构造函数不做 I/O、`alarm()` 对 `open` 逐个 `drive({operationId, waitForRetry:false})`**（`ResumeResult` 会驱动穿过 retry 等待，`agent-harness.d.ts:28`），W1-2 的 AC 与变异同步改。
P1-4 冻结摘要不能挂 `after_tool` → 改挂 **`transform_context`**（`after_tool` 的 content patch 会被持久化，`harness.md:1195,1202-1203`），entry 永远存逐字文本，W1-5 加三段式 AC。
P1-5 `fork({scope:"branch"})` 不带应用状态（`harness.md:547`）→ §七 改用 **`scope:"tree"`**，取舍成为 **D12**，E-2 加「fork 点的应用 values/lists 与源相等」与「五个选择用例不再 `SELECTION_EXPIRED`」两条 AC。

P2 全部折入：D3 的 (a) 不存在（`OperationRequest` 五种 kind，`agent-harness.d.ts:48-77`）→ 重切为 (b) `appendMessage` + `appendCustomEntry`（推荐）vs (c) 本地工具；配额改「宿主铸 `operationId` → 幂等预留 → `accept`，`before_drive` 兜底」+ 崩溃测试（**D11**）；`MemoryStorage` 不是公开导出，全文改 `MemorySessionRepo.create()` / `StorageBackedSession`；eval 复用 W1-6 的投影器（单一见证路径）；新增 §4.2.1 的 `HarnessEvent` → SD-9 映射表；S1 断言 `esbuild` 不进 bundle；§八 补 `AgentHarnessOptions.retry`（`:628`）与 provider-outage 改读 `run_end.error`；S4 指明用 `ctx.abort()` 且由 alarm 恢复；D5 补「conformance subpath 是 Node-only」；D1 补「只用 `lane("main")`」不变式；删除清单补 `packages/eval` 的两个前缀消费者；新增 **W0-2** 迁移卡；W2-2 拆成 Tier A/B、Tier C、工具集成三张。

**引用更正 10 条全部照改**：fork 套件是 5 个 + `Lifecycle`/`Message`/`Ownership`；`MemorySessionRepo` 取代 `MemoryStorage`；`coding-agent/CHANGELOG.md:34`；`ai/CHANGELOG.md:24`；`CONTRIBUTING.md:23`；`ForkOptions` 是 `:474-499`；D3(a) 不存在；`resume` 语义；`after_tool` 落库；branch fork 不带状态；arch-map 改引 `:29`。

**该席 5 个提问的答复**：(1) `alarm()` 里按 `open[i].operationId` **`drive`**，构造函数保持 I/O-free；(2) 前缀用 **tree scope**（D12）；(3) 读面**留在 Worker**、只有重连进 DO（D13）；(4) 配额**允许非原子但按 `operationId` 幂等**（D11）；(5) 逐文件清单**由 W0-1 单独产出并评审**（D10）。**无一条驳回。**

**修订 2（Seat A r2 + owner 2026-09-09 裁决）**：Seat A r2 确认 r1 的 16 条全部解决，余 6 条文字残留全部照改（P0-S4 的 AC 仍写 `resume` → 改 `drive`；文件数 113 → **115**（114 `.ts` + 1 `.json`，并把 `durable-namespace.ts`/`json-record.ts` 列进 W0-1）；三个小计改成实数 **2,237 / 1,613 / 1,594**；§十二 的「删 1,740 行」→ **≈4,100**；arch-map 引用改 `:29`；重复的 W1-3 验收合并）。owner 裁决：**§八 的 pre-stabilization 赌注明确接受**；D2/D4/D5/D6/D8–D15 按推荐定案；**D3 定 (b)**，并写明用户侧的生成式 UI（`chat-data-parts.ts:45` → `ClarifyCard.tsx`，回程走 `agent-contract.ts:89-99` 的确定性通道）**一个字都不改**，两次 append 只是会话内部记账；**D7 定为原则「能用 eval SDK 的就不手写」**，逐项列出被库替掉的七类与保留的手写四件（配对 bootstrap 门、provider-outage 分类、淘汰规则、基线铸造），并保留一份机器可读的门禁结果文件；**D1 被 owner 重开**（「我们的 agent 应该是 stateless 的才对」「我们就应该用 worker，不应该用 DO；或者 worker 池放在 DO 那边」），据此新增 **(2′) 协调者–执行者拆分**并作为推荐方案，§4.1 随之改写成两个角色，Cloudflare 的 CPU/duration 口径查了官方 limits 页并标注「以 S2 实测为准」。

**修订 3（Seat A r3）**：该席确认 (2′) 的设计与平台事实无误，但抓到一条真的 P1 与两条未真正修好的残留。**P1**：协调者不能自己调 `accept`——它是 `AgentLane` 的方法（`agent-harness.d.ts:644`），要先 `AgentHarness.create({session})`，而 `create` 会转移所有权（`harness.md:1082`）且 `accept` 经 `Storage.commit` 落 entry；协调者若调它就等于打开了 session、持有 harness、做了 Neon I/O，与「DO 只做三件事」自相矛盾。**改法**：执行者经服务绑定暴露 `accept` / `drive` / `requestAbort` / `appendMessage`+`appendCustomEntry` 四个入口，**协调者一个 harness 都不构造**，W1-2 的变异改成「协调者里 import `NeonSessionRepo`/`AgentHarness` ⇒ 测试红」。**未修好的残留两条**：P0-S4 的验收仍写 `resume`（修订 2 的附录误记为已修）、r1 附录里 arch-map 仍写 `:32-34`——两处都已改。**P2 全部折入**：「无缝配对」的出处更正为事件总线绑定时机 `harness.md:1164` 与不变式 35 `:1353`（`:1128-1133` 只是 `WatchHandle` 的声明）；租约列在 `runs` 上、随 D6 退役，改由 W0-2 的租约表承接；补上 Cloudflare 的两条——客户端断开会取消任务（执行者的「客户端」就是那次 alarm，这正是它的中止信号）与服务绑定共享六连接上限（S2 记峰值）；(2′) 的成本列改成「每趟两次调用 + DO 全程持流」；D7 合并成一张替换表与一张保留表；D3 补上 409 过期规则要改从 session value 读（`turn-selection.ts:144` → W1-8）；S2 的执行者边界给了独立判据（130 s 一趟、p50/p95、连接峰值）；`mini/worker/run.ts` 的注释是 `:95-96`。SSE 的传输形态待 `/tmp/cf-sse-research.md` 落地后并入 W1-6。

**修订 4（Cloudflare SSE 调研落地，`/tmp/cf-sse-research.md`）**：D1(ii) 的传输形态定稿为**执行者 `WorkerEntrypoint` + service binding RPC 返回 `ReadableStream<HarnessEvent>`**（RPC 原生支持流与背压），协调者**逐事件消费并记账后再序列化**成 SD-9——它是读写节点而非字节管道，纯直通满足不了续租/settle/扇出；HTTP `new Response(res.body, res)` 直传留作退路。补两条硬约束：Cloudflare 边缘对空闲 HTTP 连接是 **400 秒**不可配置上限，SD-9 必须带远小于它的心跳注释帧；**断线重放没有官方样例**（Agents SDK 是 WebSocket + SQLite 重放，不是 SSE `Last-Event-ID`），设计归我们，立为 **D16**（推荐先尽力而为 + `resnapshot`，按游标缓冲重放留后续卡）。**明确排除 Cloudflare Agents SDK 作为协调者**：`AIChatAgent` 假定 LLM 循环跑在 DO 内（`onChatMessage` 里 `streamText`、`keepAliveWhile`、`runFiber`、子 agent 即 DO facet），会把执行者拽回 DO，与 (2′) 正相反；只有它的 Workflows 集成（RPC 进度回调 + 显式 `broadcast`）形状相符。前端沿用 AI SDK 的 `createUIMessageStream` + `writer.write({type:"data-*"})`，SD-9 → `useChat` 的适配仍是我们的胶水。W1-6 与 S2 相应扩写；**S2 新增一条文档留白的实测**：DO 同时持有对浏览器未完成的 SSE 响应流与对执行者消费中的 RPC 流、且在中间做二次处理时，「in-flight I/O 不驱逐」是否仍成立——判据是一趟 20–130 s 的 pass 跨过 70–140 秒 idle 窗口不被打断，并用我们自己的 `setAlarm` 心跳兜底。

**修订 5（Seat A r4）**：一条 P1 是真的技术错误——**Workers RPC 只支持字节流**（「Only byte-oriented streams（底层字节源 `type: "bytes"`）are supported」，官方 RPC 文档，2026-09-09 复核），**没有对象流**，所以修订 4 写的「RPC 返回 `ReadableStream<HarnessEvent>`、省了一道序列化」两处都错。改为：**执行者的 RPC 方法返回 `type:"bytes"` 的 `ReadableStream`，逐行吐 NDJSON 编码的 `HarnessEvent`，协调者按行解析**；并写进两条同源规则——**流的所有权转移给接收方**（发送方之后不能再读，`tee()` 失去流控，因此 D16(a) 的副本只能由协调者留）、**32 MiB 只管非流式返回值**。W1-6 增加「截断尾行不得被当成一个事件」的变异。P2 全部折入：**执行者是同一个 `edge` script 上的具名 `WorkerEntrypoint`（binding 指回自身 + `entrypoint`），不新起 Worker**——新起会动 `test_cd_staging_chain_contract.rb:38-40` 的 `STAGING_UNITS` 与凭据契约，W1-2 加一条「这两处 `git diff` 为空」的验收；S2 的「70–140 秒」出处更正为 Agents SDK 的 durable-execution 文档（不是 Limits 页），并补记 **CPU 时间**（两次请求间超过 30 s 计算会提高驱逐概率）；**D16 定为「先 (b)、(a) 留后续卡」**，心跳归协调者的定时器、与 retry wake-up 复用同一个 `setAlarm`；Agents SDK 的拒绝理由补一句——**它的 `keepAlive` 30 秒 alarm 心跳这个原语我们照搬，框架不用**；r3 的 409 过期规则正式落进 **W1-8** 的验收。

**修订 6→7（D1 的三步裁决，owner 2026-09-10 定 (1) 瘦 DO 宿主）**：这条决策走了 **2′ → 2 → 1**。先按 owner 的「worker 池放在 DO 那边」拟了 (2′) 协调者/执行者拆分；再按「我们就应该用 worker，不应该用 DO」改成 (2) 全无状态 + Neon 租约行 + Queues 延迟消息（修订 6 曾按此写完）；最终定回 **(1)**。证据基线是 `/tmp/streaming-agents-survey.md:177-212`：成熟系统都是「run store + broker + scheduler」三件套，小团队的最小成熟档是「hold 住请求 / 断开后跑完 / 重连抓终态」，而 **DO 恰恰是把三层压进一个原语的「免拼装」路径**（`:205-212`），方案 (2) 的 DB 租约 + 延迟队列 + 无状态计算虽是 LangGraph/Trigger.dev 的标准形状，在 Cloudflare 上要自己拼。既然**执行者模块本来就 DO 无关**，选 (1) 拿到互斥与活流不花任何架构自由度。

**定案形态**（**修订 9 起「约 100 行」已作废，改由两条不变式定义「瘦」**；下段为当时原文）：一 session 一个 DO，宿主约 100 行——请求进来调执行者 `accept` + `drive`，`watch()` 的事件**在 DO 内直接写进浏览器 SSE 流**；`waiting{notBefore}` → `setAlarm`；alarm 或重启时对 `open` **逐个 `drive`、从不 `resume`**；请求由 DO 串行即单写者；**零 DO 会话存储**（宿主里任何 `ctx.storage` 写判红）；`locationHint: "apac"` 就近 Neon（文档两条限制照录：只有第一次 `get()` 认 hint、创建后不换位置、best effort；`durable-namespace.ts` 的 `NamedStubs.get` 今天没有这个参数，要一起加）。**退出主线的**：Neon 租约行、Queues 及其部署面、RPC 的 NDJSON 中继、独立协调者——(2) 与 (2′) 留在 D1 的表里当**回退**，触发条件写死为 DO 计费不可接受 / 单实例可用性或 CPU 配额成瓶颈 / 需要超出单 DO 的扇出。**D16 = (b)** 不变，另记一条**附带好处而非要求**：实例还活着时的重连可以直接重挂 `watch()`。**受影响的条目**：§4.1 全节改写为「瘦宿主 + DO 无关执行者」两层；§4.3 的部署面改为「几乎不动」（不引入 Queues、不新增部署单元，两个 CD 契约都不改，唯一新代码面是 `NamedStubs.get` 的 `locationHint`）；W0-2 去掉租约表与 Queues 资源；W1-2 改为宿主/执行者两侧的验收（含「宿主零 `ctx.storage`」与「执行者 import 图里没有 DO」两条变异）；W1-6 改为 DO 内直接成帧；S2 换回原 S4 的形状（≥130 秒、≥3 工具、中途断线 → Neon 完全结算、零重复执行、alarm 驱动的 `drive` 恢复，另记 CPU 时间与 `locationHint` 的就近验证）。至此 **16 条决策全部定案**。

**修订 8（Seat A r6 + Seat B r1）**：Seat A 的两条 P1 与五条 P2 全部照改——open-operation 索引在 (1) 下改由 **`open_operations` 小表**承接（不是已取消的租约表），W1-9 只盖「accept 已提交、alarm 未 armed」这个崩溃窗口，W0-2 收下它；「任何 `ctx.storage` 写判红」改成**禁 put/delete/deleteAll/transaction/sql、放行 alarm 三件套**（原文会把必需的 `setAlarm` 判红）；补上 **drive 期间 ≈30 秒的保活 alarm**（断线不终止 pass）；S2 与 S4 分工写清（S2 = 实例活着、客户端断开；S4 = 实例被弃），P0-S2/P0-S4 卡面同步且 P0-S4 `needs P0-S2`；`locationHint` 收进 `durable-namespace.ts` 的 `sessionStub()`，四处取 stub 全走它（因为只有第一次 `get()` 认 hint）；D1 里 (2′) 时代的两句陈述标为历史并划掉「W1-2 不能开工」；「约 100 行」标明是目标。

**Seat B 的七条 high + 一条 medium，逐条对 0.85.1 源码复核后全部采纳，无一条驳回**，成果是新的 **§4.2.2「宿主必须自己实现的六条协议」**。其中三条与文档的字面读法相反，因此都附了源码证据：**(1) `before_drive` 抛错不是「只拒这一趟」**——`drive.js:18-28` 只吞 `AbortRequested`，其余异常经 `lane.js:734-754` → `dist/harness/runtime/harness.js:259` → 同文件 `:231-243` 的 `fault()`，**封掉所有 lane、hooks 与事件流**；所以日常配额拒绝移到 `accept` 之前由宿主自己答复，`before_drive` 只留给「必须立刻全停」的情况（§4.2 两行 seam 表随之改写，W1-3 的验收换成「拒绝之后同一实例还能接下一条合法请求」）。**(2) DO 单线程 ≠ 跨 await 互斥**（`turn-subscribers.ts:61-68` 自己就写着 fetch 与 alarm 在 await 处交错）→ 一个 incarnation 一个 `Session`/`Harness`、初始化进 `blockConcurrencyWhile`、`accept`/`drive`/业务写加显式互斥。**(3) 第一趟 drive 之前就要有持久唤醒**（`harness.md:736`：「a crash after acceptance leaves an open initial leaf that only a later `drive` advances」）→ accept 成功即 armed alarm + 写 `open_operations`。**(4) 准入幂等按 `(session_id, client_message_id)`**（修订 9 把 D11 的措辞一并改掉），因为 `operationId` 是接受后的不可变元数据（`harness.md:602`）、并发 accept 的败者是 `LaneBusy`（`:736`、`:1039`）——**这里更正 Seat B 的一处引用：它引 `:602` 支撑「operationId 不是幂等键」，真正写着并发与崩溃语义的是 `:736`**。**(5) 结算窗口独立于 open operation**（终态事务删掉 operation、`create.open` 不再返回，`harness.md:965,991`）→ 独立的待结算记录 + 单业务事务 + 三处故障注入。**(6) 确定性选择要应用级持久协议**——两次 append 各自独立提交、各自新铸 entry id（`lane.js:1487-1500`），不创建 operation，四处崩溃窗口无从恢复。**(7) S4 要覆盖 effect-pending 的工具窗口**（`harness.md:977,987-988`）→ 逐工具 replay 策略 + 外部幂等键 + 三处故障注入，并把「允许重复调用」与「禁止重复业务效果」分开断言。**(medium) 冻结摘要不是可选缓存**——`frozen-tool-return.ts:2-18` 写死「写入时决定一次、读路径绝不重算」，否则换 summariser 会改写旧历史字节；改为**必需的持久 sidecar**，`transform_context` 只施加已存字符串、缺失则保留逐字，W1-5 加「重启 + 换 summariser 后历史逐字不变」的验收。

**修订 9（Codex r2 五 high + 一 medium、Seat A r7 一 P1 + 六 P2；全部对 0.85.1 源码复核后采纳，无一条驳回）**：这一轮全是**提交顺序**与**「提交发出、结果未知」窗口**的问题，成果是 §4.2.2 扩到七条协议、外加新的 **§4.2.2.1 提交顺序表**（13 行，每行给出该窗口的恢复动作，并成为 W1-2/W1-3/W1-7/W1-8 的故障注入点清单）。

**(1) 准入意图要写在 `accept` 之前**（修订 11 再加两条前置：sweeper 先排程、`operationId` 预分配）：实例若死在「接受提交」与「写索引/armed alarm」之间，已被接受的工作就没有任何可扫痕迹；改为先写 `admission_intents`（唯一键 `(session_id, client_message_id)`），accept 后回填 `operationId`，**sweeper 扫意图而不是只扫 `open_operations`**，故障注入停在接受提交刚返回处。**(2) `before_tool` 拦不住 safe 重放**（修订 10 把 §4.2 那行 seam 也改了）——`recoverToolInvocation` 在两侧 `replay === "safe"` 时**直接调 `performToolInvocation`**（`dist/harness/runtime/drive/tools.js:345-352`），而 hook 只在 `prepareToolInvocation`（`:304-331`）里跑；所以每个工具的授权与预算移到 `execute` 入口，用 `invocation.invocationId` 做幂等键——上游对它的定义正是「unchanged during safe replay」（`dist/harness/types.d.ts:66,69`，签名 `:78-80`）。**(3) fault 之后连 `requestAbort` 都会抛**（修订 13 把「因存储提交失败而 fault」拆成协议八，不走这条）（`lane.js:761-765` 只对 `HarnessClosed` 返 `Closed`，其余 `assertOpen()` 抛出，`:1570-1572`），因此写死六步重挂序列（记录理由 → `close()` → 受控 `create` → **首次 drive 之前** `requestAbort` → `drive` → 结算退款），协议二的「一个 incarnation 一个 harness」补上「**直到 fault 为止**」。**(4) 待结算记录必须在第一次 drive 之前就存在**（终态一提交 operation 就从 `create.open` 消失），且 **`open_operations` 不得早于结算义务持久化就删**。**(5) 选择**（修订 10 收敛为一条 `appendCustomEntry` + `entryProjectors`）改为逐步持久状态 + **把稳定关联键写进 entry 的 custom data**（`append` 每次新铸 id，认不了旧行），恢复在下一轮开始前走完半途，清澄清**按 `clarification_id`/revision 条件清**，并覆盖「append 已提交、id 未记下」的窗口。**(6) S4 的判据换成逐工具矩阵**：`safe` 允许再次调用但业务效果必须按 `invocationId` 幂等，`never` 必须得到显式 `interrupted`，并在三个持久边界各注入一次故障，外加「预算撤销后 safe 重放不得产生效果」。

**Seat A r7**：**P1 — D11 改写**，旧稿以 `operationId` 为幂等键是错的（它是接受**之后**的不可变元数据，`harness.md:602`；客户端手里只有 `client_message_id`），owner 当时的「按推荐」批的是这段已被推翻的措辞，现按客户端键 + 三种对账重写并附崩溃测试。P2 全折：**「≈100 行」删掉**，「瘦」改由两条不变式定义（DO 存储无会话状态、宿主无 run engine），协议四~六的业务持久化移进一个**同样 DO 无关的业务模块**；§4.1 #1 从「天然串行」改为**单实例 + 宿主显式互斥**（pi 对第二次 `drive` 是等待而非拒绝，`lane.js:729-731`）；**alarm 只有一个槽**，下次唤醒取 `min(保活 tick, notBefore)`、在 `alarm()` 内重排、已有 drive 在飞则不起第二次（W1-2 加变异）；**冻结摘要的载体写死为 `after_tool` 的 `details` 补丁**（`agent-harness.d.ts:569-576`），`content` 保持逐字，`transform_context` 只读回已存字符串；W1-4 点名 `replay?: "never" | "safe"`（`dist/types.d.ts:351`）；W0-2 的验收列出四张表与各自约束（唯一 `(session_id, client_message_id)`、`open_operations.operation_id` 主键、结算按 `operation_id` + `settled_at` 守卫）；`§4.5` 笔误改 `§4.2.2`，r8 附录里被推翻的 D11 措辞标注为已改。

**修订 10（Seat A r8：2 P1 + 7 P2，全部采纳）**：**P1-1** §4.2 的 seam 表还把「每个工具的授权/预算」指向 `before_tool`，与修订 9 新加的协议六自相矛盾——改为**工具 `execute` 入口 + `invocationId` 幂等**，`before_tool` 只留首跑的参数校验/替换。**P1-2** P0-S4 的验收还写着「零重复执行」——换成 §五 S4 的逐工具矩阵（`safe` 每个 `invocationId` 最多一次外部效果、`never` 得到显式 `interrupted`、三个持久边界各注入一次）。**P2 七条**：把 `operationId` 回填与 `open_operations`、待结算记录**并进同一个业务事务**，于是提交顺序表里**只剩 ③ 一个未知窗口**；终态的见证人写明是 **`AgentLane.getResult(operationId)`**（`agent-harness.d.ts:643`，清理后 `pi.result` 仍不可变，`harness.md:991`），W1-7 卡面同步；`admission_intents` 增加终态状态 **`pending｜accepted｜settled｜void`**（③ 与 ⑨ 处转移，sweeper 只扫前两个），并进 W0-2 的约束验收；选择那两次 append **收敛成一条 `appendCustomEntry`** 载 {请求键, 步骤, 结果} 并配 **`entryProjectors`**（`:634`）投影进上下文——因为 `appendMessage` 只收 `AgentMessage`、没有放应用字段的位置（`:641`），保留两次 append 时则要求 custom entry 先写、恢复用 `findEntries` 按 intent 的 `started_at` 认领；执行者显式增列两个端口 **`ToolPolicy`** 与 **`SelectionRecords`**，§4.1 的「唯一的差别是 `SessionRepo`」改为「`SessionRepo` + 这两个端口」，好让 eval 继续完全不碰 DO 与 Neon；协议一步骤 ④ 补引持久取消的出处——**这里把该席给的 `harness.md:1001` 精确到 `:997-1001`**，因为 `:999` 才是取消的有序步骤、`:1001` 是「对同一条仍开着的已取消 operation 重复请求」的那句，两句合起来才支撑「首次 `drive` 之前 `requestAbort`」；`harness.js` 的路径补全为 `dist/harness/runtime/harness.js`；「这六条」改「这七条」；被推翻的旧措辞在附录里标注。

**修订 11（Codex r3：三条 high，全部对源码复核后采纳，无一条驳回）**：这一轮抓的是**恢复链条的前置条件**——协议写得再对，前置不成立就是空转。

**(1) sweeper 没人排程。** ①–⑤ 之间的恢复全指望 sweeper，但没有任何一处安排它开始跑。这条我们自己写过：`intake/turn-intake.ts:143-149` 的注释说「The backstop is scheduled BEFORE the transaction opens, not only after it commits… only a sweeper that was ALREADY ticking when the row landed can find it — scheduling it afterwards is scheduling it in the branch that did not run」，实现是 `acceptTurn:156` 先 `ensureScheduled()` 再 `openTurn`——**而这个文件在删除清单上**。改：提交顺序表新增 **⓪「sweeper 已持久排程」**作为 ① 与 S1 的前置，`ensureScheduled` 的归属显式转给 **W1-9**，并加一条验收：**全新 namespace 的第一个请求、崩溃停在 ③ 之后 ⑤ 之前、客户端不重试**，仅靠 sweeper 恢复到结算（变异：把排程挪到准入之后，该例转红）。

**(2) `operationId` 可以在 `accept` 之前就分配**（修订 12 补上「按哪个见证人判定」）**。** `lane.js:319` 是 `request.operationId ?? this.session.idGenerator.next(startedAt)`——调用方给得了。于是准入意图那一行为该 client key 分配唯一 `operationId`，③ 处显式传进 `accept`，恢复端**按 id 直接查 `create.open` / `getResult`** 判定接受与否，**窗口 ③ 从「结果未知」变成确定可判**；另加「该 session 有未对账 pending 意图时不接新准入」。客户端侧的幂等键仍是 `(session_id, client_message_id)`。D11 与表的 ①③ 行同步改写。

**(3) 有 open operation 时 append 进的是待写队列，恢复端看不见。** `append` 在 operation 在跑时把内容写进 `pi.pending.entry` 并挂进 lane inbox（`lane.js:1530-1552`），而 `findEntries` 只从 branch tip 扫（`:1475-1481`）。所以协议七加**先决条件**：执行选择与 `appendCustomEntry` 之前，在宿主互斥内确认该 lane **没有 open operation**，正忙就拒绝或等待、**不排队**；将来若真要允许排队，恢复端必须能区分待写与已落 branch。W1-8 加两条验收：**retry-waiting 期间提交选择**、**append 响应丢失后按请求键认领**。

**修订 12（Codex r4 一条 high + Seat A r10 三处措辞）**：Codex 抓到的是**判定见证人挑错会误伤在途回合**——`create.open` 是 `create` 那一刻从 `restoreSession` 一次性算出的快照（`dist/harness/runtime/harness.js:290-305`），**之后的 `accept` 不会更新它**；而 `getResult` 读的是 `pi.result`（`lane.js:132-134`），**终态之后才有值**。于是在同一个活着的实例上，「不在 `create.open` 里 + `getResult` undefined」正好就是**刚被接受、正在跑**的状态，照它退款判废就是毁掉一笔真实在途的 operation。改：判定顺序写死为**先 `lane.inspectExecution()` 的 `current`**（`agent-harness.d.ts:647`，`LaneExecutionInfo` 的形状在 `:102-108`）／必要时 `harness.lanes()`（`:682`），**再**配 `getResult(operationId)`；**`create.open` 只在刚重建实例之后用一次**；**alarm 入口与 sweeper 一律不得仅凭「不在某份缓存的 open 列表里」就退款或判废**。W1-3 加三条验收：同一实例 ④ 失败 ⇒ sweeper 补完并结算而非退款；create 之后才被接受且处于 retry-waiting 的 operation ⇒ alarm 照样 drive；变异「缓存 `create.open` 当当前依据」⇒ 前两条红。

Seat A r10 三处：表的第 4 行措辞改为「**意图 `pending→accepted` + `open_operations` + 待结算记录，一个业务事务**」（原文写「回填 operationId」，但 id 在 ① 就分配了）；意图状态机的转移点由「③ 处」更正为「**④ 处**」——③ 是 pi 自己的事务，我们不在那里写状态（W0-2 与 D11 同步）；对账顺序「**先 selection intents，再 admission intents，任一未对账即不接新准入**」写进表的第 1 行与 W1-8 的前置验收；W1-8 里一处「（协议六）」更正为协议七；W1-9 补明 `ensureScheduled` 的调用者与时机——**DO 宿主、在 ① 之前、每 incarnation 一次**，因为它本来就幂等（`sweeper/run-backstop.ts:12-14`）。

**修订 13（Codex r5 一条 high）**：抓到的是**最阴的一种 fault**——**Neon 已经提交成功，但提交调用本身失败了**（响应丢失）。`lane.js:206-223` 的 `catch` 直接 `throw this.onFault(error, context)`，整个 harness 被 fault；而三个「活见证人」全部经 `assertOpen`：`inspectExecution` 走 `readLane`（`:165-166` 连查两次）、`getResult`（`:132-134`）、`findEntries`（`:1475-1477`）——**fault 之后一律抛**。于是在最需要判定的那一刻，判定手段全部不可用；此时若走协议一（无条件 `requestAbort` + 取消 + 退款），就会把**已经落库的合法工作**取消掉，而 S2 那种情形连 operation 都没有、根本无从 abort。

**改法**：新增**协议八「storage-fault re-attach」**（修订 14 补上它与协议一的分流规则与可重试性）——宿主互斥内 `close()` 已 fault 的挂载 → 重开 `Session` → `create` 新 harness → **再**按预分配 id 查 `inspectExecution().current` / `getResult`，选择那侧按请求键 `findEntries` 认领。**硬规矩：只要判定查询本身还在失败，所有恢复义务一律保持 `pending`——不得记为「不存在」，更不得默认取消或退款。** 协议一因此**收窄为「永久性拒绝且记录理由」专用**。提交顺序表的 ③/⑥/⑦/S2 四行都标明该走哪条重挂。三条故障注入验收：③ 处「提交成功、调用抛错、DO 还活着」⇒ 重挂后合法 operation 继续或按真实终态结算、不退款（变异：走协议一 ⇒ 红）；⑥/⑦ 同形态 ⇒ 用 `getResult` 认真实终态，查询仍失败期间义务保持 `pending`；S2 ⇒ 重挂后按请求键认领已提交的 entry、**不产生第二条 append**（变异：走协议一，因无 operation 可 abort 而红）。

**修订 14（两席同点：Seat A r12 的 P2-1/P2-2 与 Codex r6 的 medium）**：协议二里「fault 后按协议一受控重建一次 / 只允许这一次」是修订 13 之前的遗留说法，与新加的协议八冲突——它会把**存储提交失败**这种情形也塞进「取消 + 退款」的路径。改为**按起因分流**：**该 operation 有我们自己记下的拒绝理由 ⇒ 协议一（恰好一次）；没有记录 ⇒ 协议八（安全默认，绝不取消）**。

两条支撑写进正文：**(a) 判别只能靠我们自己的记录，不能靠异常**——协议一第 ① 步就是在 hook 抛出**之前**持久写下拒绝理由，因为两条路径抛的是**同一个** `HarnessFault`、连消息都一样（`harness.js:236-237` 与 `:306-308` 构造的都是 "AgentHarness storage or invariant fault"）。**(b) 协议八是可重试的**——`create` 在 `restoreSession` 失败时把异常包成 `HarnessFault` 原样抛出（`harness.js:289-290,306-308`），**不会留下半成品挂载**，所以「重开失败」只是这一次失败，交给 alarm/sweeper 带退避重试，且任何时刻最多一个活挂载。§4.1 新增第 3.1 条：**`alarm()` 与每个请求入口都先查宿主的 fault 标记，有标记就在互斥内先跑对应的重挂，跑完之前不做任何 `accept`/`drive`**。新增三条验收：W1-3 的「第一次重开/`create` 也失败、之后某次 alarm 成功 ⇒ 同一笔 operation 照常结算、不取消不退款」与「分流只看拒绝记录、不看异常」（变异：按异常判别 ⇒ 存储失败被误判成永久拒绝、红），W1-8 的「第一次重开失败、之后 alarm 成功 ⇒ 同一条选择 entry 被认领、不产生第二条 append」。
