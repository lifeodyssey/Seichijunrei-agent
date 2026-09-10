# Spec — agent 建在 pi harness 上（彻底重写）

- Status: Active — 修订 14 已由 PR #1533 合入；落实 owner 2026-09-09 的 SDK-native 纠偏；本次评审证据记录在 story PR。下文产品约束继续成立，旧适配器/内部接口不构成兼容义务。
- owner 定案（2026-09-09）：**「彻底重写，能用 pi 的就用 pi，eval 和单测需要重新考虑」**；eval 不要数据库；**所有工具调用都要真的**（web search 的不稳定可接受）。
- 本次 owner 补充：**agent / eval 不保留自建 adapter 架构；使用依赖库最直接的公开 API，允许大幅删减重写。** 具体 SDK 源码核对与删减依据见 [SDK-native review](../iterations/production-readiness-2026-08/SDK-NATIVE-REWRITE-REVIEW.md)；逐文件执行以 [W0-1 清单](../iterations/production-readiness-2026-08/AGENT-FILE-DISPOSITION.md) 为准。
- 当前核对基线：仓库 `fd73fbd532ef4d151a027ab8c93e9f2ea9304dab`；pi 已发布 **0.85.1**，npm gitHead/tag **`d981de1229ef899957bbe968bc8dcda02a21f477`**。最新判断以该 tarball、对应官方源码和原生 API probe 为准；早先浮动 checkout 的研究记录归历史，不能覆盖实际已发布行为。
- 取代：`docs/specs/2026-09-01-agent-ts-rewrite-spec.md` 的 §五 W3、§十 与**它的第 16 行非目标**；以及 `docs/archive/specs/2026-09-08-eval-suite-redesign-spec.md` 全文（见 §十一）。

## 一、动机

**我们把上游已经写成规范的那一层，自己写了一遍。** 核对基线的 `workers/edge/src/agent/` 有 **13,449 行**，其中会话树、operation 状态机、崩溃恢复、压缩、事件——都是 `packages/agent/docs/harness.md` 那份**自称 normative specification**（`harness.md:21`）的 1468 行所定义的东西，上游还配了实现与 2105 行 conformance 用例（`/tmp/pi-repo-research.md:166-169`）。

**当初不押注是对的，现在前提没了。** 旧 spec 的非目标写着「不押注 pi 上游未实现的 `AgentHarness`（HEAD 仍抛 `HarnessNotImplemented`）——只用 core Agent 层」（`docs/specs/2026-09-01-agent-ts-rewrite-spec.md:16`），那是对 0.84.4 的正确判断（`AgentHarness.create` 抛 `HarnessNotImplemented("create.restore")`，`/tmp/agent-architecture-map.md:29`）。0.85.1 已实现接受、驱动与恢复：应用直接用公开 `accept` / `drive`，恢复由 `AgentHarness.create` 完成；内部 `restoreLane` 不成为应用接口。我们仍钉在 **0.84.4**（`workers/edge/package.json:21-22`）。

**书的框架说这件事该怎么分。** Agent = Model + Harness，Harness 是「模型边界内环绕模型的运行与治理层，负责构造上下文、暴露工具接口、维护循环和状态」（`book/chapter1.md:25`）；上下文的五个组成部分 = 系统提示词、工具定义、用户消息、模型回复、工具执行结果，其中前两者是静态前缀、后三者是不断增长的轨迹（`book/chapter2.md:56,376`）。pi 的 harness 正是这一层的通用实现，而**轨迹**正是它的 `entries`。我们该留的是**业务**：领域工具、配额、结算、身份、SD-9 帧与宿主单写者约束。

**eval 与单测的前提也跟着变。** 轨迹既然是 session 本身，eval 就不需要一个数据库去重建它——上游自己就是 `MemorySessionRepo` + `fauxProvider` 跑 harness 测试（`/tmp/pi-repo-research.md:217-231`）。

## 二、现状

### 2.1 逐目录判定（从 `git ls-files workers/edge/src/agent` 生成）

`workers/edge/src/agent` 共 **13,449 行 / 115 个文件**（114 个 `.ts` + 1 个 `city-names.json`），其中 `session/` 一个目录就 **5,919 行 / 40 个文件**。判定分三类：**delete**（SDK 已实现或旧承载层不再需要）、**rewrite-domain**（以公开 SDK API 直接实现必要业务）、**retain-domain**（领域行为或数据）。rewrite-domain 不保留旧接口、旧类或兼容层；每项必须说明被删除的封装和实际剩余的业务职责。逐文件清单由 **W0-1** 卡生成并单独评审（**D10**）；本节给的是目录级判定与不可省略的例外。

逐文件与 companion 路径、实际删减理由、公开 SDK 接缝及 successor 卡均集中在 [W0-1 清单](../iterations/production-readiness-2026-08/AGENT-FILE-DISPOSITION.md)。该审计基于已合入的固定历史树；新实现不为保留旧目录或旧接口而迁移代码。

### 2.2 上游 0.85.1 有什么

- **三个 store，一条不变式**（`harness.md:41-48`）：`entries` 写一次只追加的会话树、`values/lists` 可变当前态、`usage ledger` 只追加成本行；「Every payload is in an entry, a bound value/list, or the ledger; there is no third place.」
- **`Storage` 11 个方法**（`dist/harness/session/types.d.ts:386-398`）、**`SessionRepo` 5 个方法**（`:501-510`，含 `fork`）、**`ForkOptions`**（`:474-499`：branch scope `:474-490`、tree scope `:491-499`）。
- **`DriveOutcome` 就是 alarm 要的形状**（`dist/harness/agent-harness.d.ts:109-123`）：`settled` / `waiting{reason:"retry", notBefore}` / `waiting{reason:"deferred"}`；且 `waitForRetry:false` 时「returns waiting/`notBefore` with no timer and the caller schedules a wake」（`harness.md:993`）。
- **11 个 hooks**，其中 `before_drive` 与 `before_tool` **fail closed**（`harness.md:1201`），`transform_context` 是 request-local、retry 会重跑（`:1203`）。
- **官方唯一的端到端范例**：`packages/coding-agent/src/experimental/mini/worker/run.ts:63-78`（`JsonlSessionRepo` → `AgentHarness.create` → `harness.lane("main")`）与 `:97-105`（`create` 返回的 `open` 逐个 `resume`，注释：「Creation restores durable operation state without starting effects」——**我们不能照抄这一步**，见 §4.1 与 P1-3）。
- **已发布的 subpath**：`.`、`./harness/session`、**`./harness/session/testing`**、`./harness/context`、`./harness/env/nodejs`、`./harness/runtime/reducer`、`./node`（tarball `package.json` 的 `exports`）。`testing` 导出 `createStorageConformance`（920 行用例）、`createSessionRepoConformance` 及另外 8 个套件（1185 行：5 个 fork —— `ForkBehavior`/`Fork`/`ForkCoordination`/`ForkDestinationReservation`/`ForkSourceSnapshot`，加 `Lifecycle`/`Message`/`Ownership`）、`InstrumentedStorage`、`GatingStorage`/`CommitDiscarded`（`dist/harness/session/testing/index.d.ts:4-7`）。
- **DB backend 是一等公民**：`packages/session-backends/sqlite-node/src/**` 共 **1973 行**并跑上游导出的 conformance（`/tmp/pi-repo-research.md:156-164`）。

### 2.3 上游明说不做、留给我们的（`harness.md:118-122`）

宿主单写者约束（「Storage backends do not enforce this host-lifecycle rule」）、**平台调度与业务恢复扫描**（「the harness never creates platform alarms, scans repositories for abandoned sessions… the serving layer decides when to call again」）、精确一次外部副作用、复制。配额（`grep -i quota` 上游零命中）、结算、身份、SSE 帧契约同样没有。平台调度使用 Cloudflare SDK，领域义务和互斥仍由应用负责；这不要求新建租约或第二套调度引擎。

### 2.4 能不能上 workerd

上游从不提 workerd/DO/wrangler，但 包入口（`.` 导出）是 browser-safe 的：`packages/agent/src` 里 `from "node:` 只出现在 `harness/env/nodejs.ts`（独立 subpath，不在包入口的 barrel 里）与两个 conformance 文件；CI 有 esbuild `platform:"browser"` 的 browser smoke，入口从包根导入（`scripts/check-browser-smoke.mjs:45-52`）。`MemorySessionRepo`（`dist/harness/session/index.d.ts:7`）零 node API——注意 `MemoryStorage` **不是**公开导出，能用的是 `MemorySessionRepo.create()` 与 `StorageBackedSession`（`:8`）。**但 conformance subpath 是 Node-only**（`testing/conformance/*.ts` import `node:`），这正是 **D5** 把 Neon backend 拆成独立包的理由。**但 browser smoke ≠ workerd smoke**，且 `@earendil-works/chord` 是硬依赖（tarball `package.json` dependencies），而 chord 自己把 `esbuild` 列进 `dependencies`（`packages/chord/package.json`）——虽然只服务 `./bundler`/`./node`，S1 必须断言它**没有**进 Worker bundle，所以 workerd 打包必须自己实测（S1）。我们没有 bash/read/write/edit 四个 coding tool，**不需要 `ExecutionEnv`**。

## 三、目标 / 非目标

**目标**：把 agent 的**运行与治理层**换成 pi harness；我们只保留业务与 serving layer。

**非目标**：改 SD-9 帧 surface 与 `packages/contract` 的 zod 契约（web 端不动）；改 edge 鉴权模型（AUTH-2 #950）；把 quota/结算/宿主互斥/业务恢复扫描交给 pi（它明说不做）；给上游提 PR（默认自动关闭，`CONTRIBUTING.md:23`）。**旧 spec 第 16 行的非目标作废**。

## 四、设计

### 4.1 直接装配 pi；Cloudflare SDK 只负责宿主生命周期

一个 session 一个 Cloudflare `Agent` 宿主；生产会话和业务真相仍在 Neon。执行代码是普通的 `packages/agent` 装配函数，直接返回公开的 `AgentHarness` / `AgentLane`，不再包一层自己的 `accept` / `drive` API。

- **同一被测单元**：模型、工具、hooks、领域函数均不依赖 DO。唯一的会话依赖是 SDK `SessionRepo` / `Session`；生产使用直接实现 SDK 接口的 Neon backend，普通 eval 使用 `MemorySessionRepo`，录制前缀使用 SDK `JsonlSessionRepo`。不新增 `ToolPolicy` / `SelectionRecords` 的生产与内存双实现；工具执行入口直接调用领域规则，选择与准入复用请求键业务事务。
- **原生模型**：`createModels` / `createProvider` / `InMemoryCredentialStore` 装配真实 provider。BYOK 使用每 operation 的内存凭据，不实现自己的 `Models`。受控 fetch 仅接到公开 provider stream 回调；保留超时、逐跳出口校验和无平台密钥回退。
- **原生工具和状态**：`AgentHarnessTool` + 原生 TypeBox schema + `AgentToolResult`。工具完整领域结果放 `details`，引用使用 SDK 的结果 entry id，经 `Session.getEntry` 读取并校验分支归属；删除 mint registry、toolbox、envelope 和重复 payload store。历史事实来自 committed entries；确实可变的当前状态使用有界 scalar values，不依赖 0.85.1 尚不复制的 lists。
- **请求**：现有网关鉴权 → 请求键/配额事务 → `AgentHarness.create(options, context)` → `harness.lane("main", context)` → `lane.accept(request, context)`。宿主排程直接调用 `lane.drive({operationId, waitForRetry:false}, context)`。`create` 返回的 `open` 只用于本次重挂初始化；之后读 `inspectExecution` / `getResult`。
- **原生生命周期**：使用已发布 Cloudflare `agents@0.22.0` 的 `onStart`、`onRequest`、`schedule` / `scheduleEvery`、`keepAliveWhile`。SDK 负责保活与调度复用；不手写 alarm 的 min 仲裁、保活轮询或第二套调度存储。不使用 `AIChatAgent`、`Think`、`runFiber` 或 Workflows 执行同一个 pi operation，也不开放绕过现有鉴权的 `/agents/*` 路由。
- **DO 存储边界修订**：允许 Cloudflare SDK 自己保存调度元数据（session/operation 标识与唤醒时间）；消息、工具结果、会话 values、凭据、账单与额度不进入 DO SQLite。旧的“所有 SQL 都禁止”实现形态约束被本边界取代。S2/S4 必须真实验证 SDK 调度、客户端断线、实例重启、成本和状态归属。
- **单写者与恢复**：SDK 调度不意味着跨 Neon `await` 的互斥。一个 incarnation 至多一个活的 Session/Harness，accept/drive/业务写仍显式互斥。首个准入事务之前已有持久 sweeper，承诺接受之前已有可恢复唤醒；恢复扫描未结选择、pending/accepted 准入和独立未结算义务。发现、当前 SDK 见证与 fault 分流的详细规则只在 §4.2.2 协议三/五/七/八定义。
- **retry**：`waiting.notBefore` 交给 SDK schedule；alarm 调度与 keepalive 不得互相覆盖。有 drive 在飞时不并发第二次。客户端断开只取消订阅，不取消持久工作。宿主恢复逐个 `drive`，不使用会在进程里等待退避的 `resume`。
- **流**：同一 `lane.watch(context)` 的 snapshot/live 配对 → 必要的纯领域 `UIMessageChunk` 投影 → AI SDK writer/response。删除自建帧类型、SSE 序列化、DONE 处理和订阅状态机。AI SDK 当前无 SSE-comment heartbeat 配置；仅保留满足空闲连接要求的最小 heartbeat 操作，并实测断线/重连。
- **位置**：所有 AGENT_SESSION stub 取得点带 `locationHint: "apac"`。该 hint 仅首次创建时生效、是 best effort，不宣称已存在的 DO 会迁移。

这些是依赖库公开 API 的装配与业务调用；每个保留函数必须承担可命名的领域或平台职责。新增 provider 适配层、通用预算引擎、session 转换器或旧 API 兼容 facade 都不属于目标。SDK 能力和未解决边界的精确来源见 [SDK-native review](../iterations/production-readiness-2026-08/SDK-NATIVE-REWRITE-REVIEW.md)。

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
| 确定性选择（#1288/#1462） | 宿主在 harness 之外直答，用一条 `appendCustomEntry(customType, data)` 记录请求键、领域步骤、完整结果与 server origin | SDK 没有非模型 `OperationRequest`。单条关联 entry 经 `entryProjectors` 进入上下文；恢复遵循协议七，未决澄清来自原生状态的领域投影。现有结构化 `candidates` → `ClarifyCard` → 确定性选择通道与 SD-9/data part 保持，不伪造模型消息（**D3**） |

### 4.2.1 `HarnessEvent` → SD-9 的映射（无损，逐行有测试）

| SD-9 需要 | 事件 / 快照来源 | 证据 |
|---|---|---|
| 流式文本与 thinking | `message_update{message, event, frame?}`，载 pi-ai 的 `AssistantMessageEvent` | `agent-harness.d.ts:286-291` |
| `tool-input-*`（含 `args`） | `tool_start{args}`——「effective arguments for an intended effect and source arguments for an immediate synthetic result」 | `:297-303`；`harness.md:1160` |
| `tool-output-*`（含 `result`/错误） | `tool_end{result, isError, terminate}` | `:311-319` |
| 用量与结算 | `usage{row, totals}` | `:416-420` |
| 回合终止 | `run_end{status, error}` | `:224-236` |
| **断线重连** | `watch().snapshot` 的 `operation.streamingMessage` + `runningTools` | `harness.md:1100-1122` |

拒绝文案仍在网关成型（`gateway/chat-envelope.ts`），BYOK 擦洗在投影层。**这张表就是 W1-6「逐行有测试」的行清单**，eval 直接使用原生 entries/hooks（§七），不经过浏览器投影。

### 4.2.2 宿主的八条业务与恢复协议（以 0.85.1 发布源码及 #1544/#1551 为准）

这八条都不是 pi 会替我们做的事，而且有三条**与文档的字面读法相反**，所以逐条给出源码证据。

1. **拒绝协议：`before_drive` 抛错会打掉整个 harness 实例，不是只拒这一趟。** 文档写的是「`before_drive` fails closed and rejects the pass」（`harness.md:1201`），但 0.85.1 的实现是：`drive.js:18-28` 里 `before_drive` 只吞 `AbortRequested`，其余异常原样抛出；`lane.js:734-754` 把 drive 的异常交给 `onFault`；`dist/harness/runtime/harness.js:259` 把 `onFault` 接到同文件 `:231-243` 的 `fault()`，那里**封掉所有 lane、关掉 hooks 与事件流**并发 `harness_fault`。所以：**日常配额拒绝必须发生在 `accept` 之前**，由宿主直接答复用户（永久性拒绝再补一次持久取消 + 结算；临时性依赖故障改为排程重试）。`before_drive` 只留给「身份已撤销、必须立刻全停」这类**本来就该停机**的情况——**而且一旦触发，恢复不是自动的**：faulted 之后连 `requestAbort` 都会抛（`lane.js:761-765` 只在 `HarnessClosed` 时返 `Closed`，其余走 `assertOpen()` 抛出，`:1570-1572`）。**这条序列只适用于「永久性拒绝」，且必须记下拒绝理由**；因存储提交失败而 fault 的情形走**协议八**，绝不能走这一条（那会把已经提交的合法工作取消并退款）。序列：①把拒绝理由持久记下 → ②`close()` 掉这个已 faulted 的 harness → ③重新 `create` 一个受控实例 → ④**在第一次 `drive` 之前** `requestAbort`（持久取消只有这一条路径，且对同一条仍开着的已取消 operation 重复请求是允许的，`harness.md:997-1001`） → ⑤`drive` 走完取消对账 → ⑥结算并退款。协议二的「一个 incarnation 一个 harness」因此要补一句：**直到 fault 为止**；fault 之后按协议二的**起因分流**决定走这一条还是协议八——**这一条只在「有我们记下的拒绝理由」时适用，且恰好一次**。
2. **DO 的单线程**不等于跨 `await` 的互斥（`session/turn-subscribers.ts:61-68` 已经写着 fetch 与 alarm 会在 await 处交错）：Neon I/O 期间另一个请求可以进来。所以宿主**每个 incarnation 只初始化一个 `Session`/`AgentHarness`——直到 fault 为止**（初始化放 `blockConcurrencyWhile`），并在 `accept`/`drive`/业务写这三处上加一把**显式互斥**。上游把这件事明确交给宿主（`harness.md:403`、`:1082`）。
   **fault 之后按「起因」分流，不是「只准重建一次」**：
   - **该 operation 有我们自己记下的拒绝理由** ⇒ 走**协议一**（永久性拒绝，取消 + 结算 + 退款），**恰好一次**；
   - **没有这条记录** ⇒ 走**协议八**（安全默认：**绝不取消**），而且它是**可重试**的——`create` 自己会在 `restoreSession` 失败时把异常包成 `HarnessFault` 原样抛出（`dist/harness/runtime/harness.js:289-290,306-308`），**没有半成品挂载留下**，所以「重开失败」只是这一次失败，交给 alarm/sweeper 带退避重试即可，且任何时刻**最多一个活挂载**。
   **判别依据必须是我们自己的记录，不能靠异常。** 协议一的第 ① 步就是**在 hook 抛出之前**把拒绝理由持久写下；两条路径抛出的东西是**同一个** `HarnessFault`、连消息都一样（`harness.js:236-237` 与 `:306-308` 构造的是同一句 "AgentHarness storage or invariant fault"），从异常上分不出来。
3. **第一趟 drive 之前就要有持久唤醒。** 只在 `waiting{notBefore}` 之后 `setAlarm` 是不够的：`accept` 已提交、首趟 drive 还没返回时实例没了，就没有任何闹钟——而上游明说「a crash after acceptance leaves an open initial leaf that only a later `drive` advances」（`harness.md:736`）。**两条前置，缺一条这套恢复就是空转。**
   **前置甲：W1-9 通过 Cloudflare SDK 持久注册独立恢复扫描，且在首个准入意图/预留事务之前完成。** 重复初始化保持幂等；这也是选择 S1 的前置。旧 `turn-intake`/`ensureScheduled` 的实现会删除，保留的是崩溃前已有持久扫描的时序保证，不是旧 helper/port。
   **前置乙：`operationId` 在 `accept` 之前就分配好。** `OperationRequest.operationId` 是可选入参，`lane.js:319` 是 `request.operationId ?? this.session.idGenerator.next(startedAt)`。准入意图为 client key 预分配该 id，③ 显式传给 `accept`，恢复按 id 查**当前 SDK 见证**：
   - `create.open` **是 `create` 那一刻算出来的快照**（`dist/harness/runtime/harness.js:290-305` 从 `restoreSession` 一次性 flatMap 出来），**之后的 `accept` 不会更新它**；
   - `getResult(operationId)` 读的是 `pi.result`（`lane.js:132-134`），**只有终态之后才有值**。
   所以在**同一个活着的实例**上，「不在 `create.open` 里」且「`getResult` 是 undefined」恰恰是**刚被接受、正在跑**的那种状态——照这两条判「没接受过」就会把一笔真实在途的 operation 退款并判废。
   **唯一的对账顺序**：宿主互斥内先读 **`lane.inspectExecution().current`**，再读 **`getResult(operationId)`**。当前 operation 命中则补 ④⑤；真实终态命中则补全业务义务并按结果结算。仅对结果未知的 pending 准入，**两项查询都成功且均明确无此 id**时，才释放孤儿预留并转 `void`；查询/重挂失败保持义务未结，交协议八重试。`create.open` 只供刚重挂后的初始清单，不作后续对账见证；不从转录、异常文字或辅助索引有无猜接受结果。未结选择先于准入对账，任何未对账义务都阻止冲突的新准入。

   **发现义务与判断 SDK 状态分开。** `accept` 前写入可扫描的 `admission_intents`（唯一键 `(session_id, client_message_id)`，状态 `pending｜accepted｜settled｜void`）；④ 在一个业务事务里标记 `accepted`、写辅助 `open_operations` 索引并建立待结算义务。**sweeper 扫 pending/accepted 准入、未结选择和独立未结算义务**；`open_operations` 不是唯一发现源，也不是执行真相。故障注入必须覆盖 accept 已提交、④ 尚未完成且客户端不重试，以及 create 后才接受/retry-waiting/终态未结算三类工作。均按上面的当前见证规则补全业务记录与 SDK 唤醒，不重建转录对账。
4. **准入幂等要按客户端的键，不是 operationId。** 上游把并发 accept 的败者判 `LaneBusy`（`harness.md:736`、结果类型 `:1039`），而 `operationId` 是**接受之后**的不可变元数据（`:602`），**不是**客户端可重放的幂等键。今天的 intake 按 `(session_id, client_message_id)` 去重，而那段代码要删。所以宿主要在**预留配额之前**持久建立 `(session_id, client_message_id) → operationId` 的唯一映射；并规定三件事的对账：`accept` 被拒、结果未知、以及**孤儿预留**（映射写了但 accept 没成）。
5. **结算窗口独立于 open operation。** SDK 终态提交删除当前 operation 状态，保留不可变 `getResult`（`harness.md:965,991`）；初始 `create.open` 不会随之刷新，也不能作为账单见证。**待结算义务必须在第一次 drive 前持久存在，并有独立扫描路径**，因此终态已提交但业务未结算时仍可发现。结算按真实 `getResult`，把 ledger 游标、`dailyUsage`、退款标记与结算守卫放同一个业务事务；辅助 `open_operations` 仅在业务结算完成后清理。查询失败时保持义务未结，不默认退款。
6. **`before_tool` 拦不住 safe 重放，所以每个工具的授权与预算要落在 `execute` 里。** `recoverToolInvocation` 在 `call.replay === "safe" && tool?.replay === "safe"` 时**直接调 `performToolInvocation`**（`dist/harness/runtime/drive/tools.js:345-352`），而 `before_tool` 只在 `prepareToolInvocation`（`:304-331`）里跑——**重放这条路根本不经过 hook**。做法：把「这次调用允不允许、扣谁的预算」放进工具 `execute` 的入口，**用 `invocation.invocationId` 做幂等键**——上游对它的定义正好是「Stable harness identity for one logical tool call, **unchanged during safe replay**」（`dist/harness/types.d.ts:66,69`，签名 `:78-80`）。首跑与重放走同一段判定。验收要有一条：**崩溃后预算已被撤销，重放不得产生那个外部效果**。
7. **确定性选择复用业务请求键账本，只提交一条关联 custom entry。** SDK append 不创建 operation，且每次新铸 entry id（`lane.js:1487-1500`）；不伪造 model operation、`appendMessage` 转录或独立 SelectionRecords 仓库。执行和 append 前都在宿主互斥内确认 `inspectExecution().current` 无 open operation。忙碌或 retry-waiting 时拒绝/等到空闲，不能排入 `pi.pending.entry`：`findEntries` 只扫已落 branch 的 entries，看不见该 inbox（`:1475-1481,1530-1552`）。

   **唯一提交形态**：`appendCustomEntry(customType, data, context)` 一次保存请求键、领域步骤、完整类型化结果与 server origin；`entryProjectors` 供后续上下文读取。提交响应丢失时按协议八重挂，再用请求键 `findEntries` 认领真实 entry，不重 append；首次重挂/查询失败时保持请求义务未结，后续 SDK 排程重试。恢复先处理未结选择、再处理准入，期间不接冲突请求。
   **未决澄清是领域投影，不是必须另写的 envelope 状态。** 成功结果只消解匹配 `clarification_id`/revision 的旧澄清，不能清掉新澄清；如确有 scalar 写入需求，仍遵守该条件。故障验证覆盖领域执行后、custom entry 提交后、成功结果的澄清消解/投影边界后，恢复到一条 committed result 和至多一次外部效果。投影与结果提交天然同一边界时，测试该等价边界，不为凑步骤重建 stage/promote；未提交结果前允许重复只读 catalog 调用。

8. **存储提交失败 → 另一条重挂路径，默认不取消、不退款。** 最阴的一种情况：**Neon 那边已经提交成功，但提交调用本身失败了**（响应丢了）。此时 `lane.js:206-223` 的 `catch` 直接 `throw this.onFault(error, context)`，整个 harness 被 fault；而三个「活见证人」全部经 `assertOpen` —— `inspectExecution` 走 `readLane`（`:165-166` 连查两次）、`getResult`（`:132-134`）、`findEntries`（`:1475-1477`）—— **在 fault 之后一律抛异常**。也就是说：**恰恰在最需要判定的时候，判定手段全都不可用**。若此时走协议一（无条件 `requestAbort` + 取消 + 退款），就会把一笔**已经落库的合法工作**取消掉；而 S2 那种情形连 operation 都没有，根本无从 abort。
   **做法（协议八，storage-fault re-attach）**：在宿主互斥内 ①`close()` 掉这个已 fault 的挂载 → ②重新打开 `Session` → ③`create` 一个新 harness → ④**再去判定**：按预分配的 id 查 `inspectExecution().current` / `getResult(operationId)`，选择那一侧则按请求键去 `findEntries` 认领已提交的 entry。
   **一条硬规矩**：**只要判定查询本身还在失败，所有恢复义务就保持未结，并保留已知准入状态；不得记为「不存在」，更不得默认取消或退款。** 判定成功之后才按真实终态收尾。

#### 4.2.2.1 提交顺序与「结果未知」窗口的恢复动作

下表列出提交与领域投影的故障边界；业务事务不可拆分，S3 的投影边界不要求额外写入。恢复以协议三/五/七/八为准，这是 W1-2/W1-3/W1-7/W1-8 的故障注入清单。

| # | 提交 | 之前必须已存在 | 结果未知时的恢复动作 |
|---|---|---|---|
| 0 | **sweeper 已持久排程**（SDK durable schedule，归 W1-9） | — | 没有它，①–⑤ 的一切恢复都不会发生（`turn-intake.ts:143-149` 的教训） |
| 1 | 准入意图：唯一键 `(session_id, client_message_id)`，**并在此分配 `operationId`**、状态 `pending` | ⓪ | 重放同一 client key 命中同一行、拿到**同一个** `operationId`；该 session 有未对账的 pending 意图时不接新准入。**对账顺序：先 selection intents，再 admission intents；任一未对账即不接新准入** |
| 2 | 配额预留（键：同一意图行） | ① | 按协议三查当前 SDK 见证；仅 pending 准入且两项查询成功、均无该 id，才释放孤儿预留 |
| 3 | **`accept`**（把 ① 分配的 `operationId` 显式传进去，`lane.js:319`） | ①② | 存储 fault 先走协议八；按协议三在互斥内查 `inspectExecution().current` → `getResult`，在跑则补 ④⑤，终态则补义务并结算，查询失败保持未结 |
| 4 | **一个业务事务**：意图 `pending→accepted` + 辅助 `open_operations` 行 + 待结算义务 | ③ | 扫 pending/accepted 准入及独立未结算义务，幂等补齐该事务；不能因缺少辅助索引而漏掉已接受的工作 |
| 5 | 首个 SDK wakeup | ④ | 由已持久排程的 sweeper 补齐丢失的 wakeup |
| 6 | 每趟 `drive`（pi 的内部事务，含工具 effect-pending） | ⑤ | 交给 pi 的恢复（`harness.md:985-989`）；工具按逐条 replay 策略 + `invocationId` 幂等。**若是存储提交失败导致的 fault ⇒ 协议八重挂后继续，不取消** |
| 7 | **终态**（pi 删掉当前 operation 状态，保留不可变结果） | ⑥ | 独立待结算义务仍能发现它；响应丢失先走协议八，再用 `getResult` 判真实终态，不能从初始 `create.open` 或查询失败推断缺失 |
| 8 | 业务结算（ledger 游标 + `dailyUsage` + 退款，一个事务） | ④⑦ | 终态的见证人是 **`AgentLane.getResult(operationId)`**（`agent-harness.d.ts:643`；清理之后 `pi.result` 仍是不可变的，`harness.md:991`）——恢复端据它判「这笔到底settle 成什么」；再按 `operation_id` + `settled_at` 守卫重放 ⇒ 恰好一次 |
| 9 | 清理辅助 `open_operations` 行 | ⑧ | 仅在业务结算后清理；是否仍有业务义务不能由该索引有无决定 |
| S1 | 共用业务账本的选择 intent（稳定请求键） | ⓪，宿主互斥内确认 lane 空闲 | 恢复先处理未结选择，再处理准入；未对账义务阻止冲突请求，不建 SelectionRecords 或假 operation |
| S2 | **唯一一次 `appendCustomEntry`**（请求键、领域步骤、完整结果、server origin；`entryProjectors` 供上下文读取） | S1，互斥内仍确认 lane 空闲；retry-waiting 不进隐藏 inbox | 提交响应丢失走协议八，按请求键 `findEntries` 认领真实 entry，不重复 append；重挂/查询失败保持未结，后续排程重试 |
| S3 | 成功结果消解未决澄清的领域投影边界 | S2 | 只消解匹配的 `clarification_id`/revision；投影与 S2 同边界则验证等价边界，不制造额外 envelope 写入；必要 scalar 变更仍须条件匹配 |

### 4.3 删除旧抽象，直接实现领域行为

判定见 §2.1。三点必须写死：

- **删除的不止 session 引擎**：`packages/contract/src/staging-prefix-*.ts`、`gateway/staging-prefix-route.ts`，以及它们在 eval 侧的消费者 `packages/eval/src/prefix-seeding-lifecycle.ts`、`packages/eval/src/trajectory-prefix-case.ts`（D7 说 `packages/eval` 留，但这两个随 `fork` 取代而死）。
- **保留的是领域行为，不是现有文件结构**：工具、BYOK、安全出口、记忆、配额和状态栏均可大幅删除重写。`TurnModel`、`TurnStore`、`TurnRecords`、`CatalogToolSession`、`SelectionRecords` 和旧 toolbox 不作为新系统的接口；SDK 已有的模型、工具、会话和结果类型直接使用。sweeper / settlement / retrieval 按 W1-9 / W1-7 / W1-10 改读真实 SDK 状态，不为旧 run 表保留新写路径。
- **部署单元保持现有拓扑**：不新增 Queues 或独立 Worker，沿用 AGENT_SESSION binding；增加 SDK 依赖和宿主实现仍须由 S1/S2/S4 与 CI 验证。不要把“无新部署单元”当作绑定、SQLite 初始化或调度行为已兼容的证据。
- **逐文件清单是一张卡的产物**（W0-1），先评审再开 W1 —— 115 个文件的判定不该塞在 spec 表格里凭印象写（**D10**）。

### 4.4 Neon `Storage` + `SessionRepo`（out-of-tree 包）

新包 **`packages/pi-session-neon`**，形状照 `packages/session-backends/sqlite-node`（1973 行，只依赖两个公开 subpath，天然 out-of-tree 友好）。

- **实现面**：`Storage` 11 个方法（`types.d.ts:386-398`）+ `SessionRepo` 5 个（`:501-510`）。
- **验收 = 上游的 conformance**：`createStorageConformance` + `createSessionRepoConformance` 及另外 8 个套件（5 个 fork + `Lifecycle`/`Message`/`Ownership`），从 `@earendil-works/pi-agent-core/harness/session/testing` 引（`testing/index.d.ts:4-7`）——**2105 行用例白拿**。
- **schema**：保留 format 4 的 entries（write-once）、values、lists、usage 语义；物理表数量不是 SDK 要求。**我们自己的列（quota、identity、payer）放在 pi 模型之外的表**，不混进 entries——`harness.md:41-48` 的「没有第三个地方」是对 pi 的 payload 说的，不是禁止我们另有业务表。
- **2026-09-10 owner 修订：直接采用 Prisma 8**。用公开 PostgreSQL contract、query、transaction 和 migration API；不先迁 Prisma 7，不加 ORM 兼容层。优先普通 PK/FK/unique/CHECK 与 SDK `prepareStorageCommit` / `validateCommittedWrites`，删除重复校验、生成 JSON 列和重复加锁 trigger 前，必须验证所有 writer（包括 fork）处于正确的事务边界。父引用保证来自哪个边界须明确，不能默认为数据库仍有已删除的约束。
- **迁移所有权**：新 agent contract 的 DDL 由 Prisma 管理；已应用 Atlas 历史不改，同一对象不能由两套工具管理。release artifact、预检与 migrator 必须一起交代所有权及目标 contract；选择 B 时只执行 B 所需的 schema 路径，不因 checkout 为 C 而迁到 C。既有 catalog geography/vector 与旧数据的整体接管须单独验证，不通过改字段含义或自制 codec 绕过。当前可行性与未完成项见 [Prisma 8 验证](../iterations/production-readiness-2026-08/PRISMA-8-VALIDATION.md)。
- **DO 与 Neon 的分工**：会话数据全在 Neon（eval 使用原生 Memory 或 JSONL repository）；**DO 只保存 SDK 调度元数据，提供互斥、排程与活流，不存会话/业务状态**——一个 session 一个 DO，单写者这件事上游明说要宿主自己保证（`harness.md:120,403`），而 宿主跨 await 的显式互斥才是保证。不变式：**只用 `lane("main")`**，不开 steer/followUp 的额外 lane，于是投影层可以忽略 `LaneSnapshot.queues`（**D1**）。
- **业务恢复扫描归 W1-9，业务表归 W0-2**：扫描 pending/accepted 准入、未结选择及独立未结算义务；`open_operations` 只是接受后的辅助索引，不是唯一发现源或租约。发现、当前 SDK 见证与结算的唯一详细协议见 §4.2.2 三/五/七/八。

## 五、Spike / kill-switch（先做，硬条件，机器可判）

沿用旧 spec 的 S1–S5 做法：**四条全绿才继续，任一条红即回到 owner 面前**。

- **S1 — workerd 打包**：0.85.1 + `@earendil-works/chord` 能进 edge 的 bundle 并在 `wrangler dev` 里执行一次 import-and-call。判据：`bundle-smoke` 通过、bundle 体积增量记录在案，**且 `esbuild` 不在产物里**（chord 把它列进 `dependencies`，只服务 `./bundler`/`./node`）。
- **S2 — 一趟真回合在部署好的 DO 里跑完并能被打断**（原 S4 的形状，硬条件）：一次 **≥130 秒、≥3 次工具调用**的回合，跑在部署好的 DO 宿主里，**中途断开客户端**，判据四条：
  - **(a)** Neon 侧**完全结算**（run 终态、步骤、usage 都在）；
  - **(b)** **零重复工具执行**（用工具自己的执行计数断言，不看标志位）；
  - **(c)** 恢复由 **alarm 驱动的 `drive`** 完成，日志里没有一次 `resume`；
  - **(d)** 记录**墙钟与 CPU 时间**，并做一次 `locationHint` 的就近验证：钉 APAC 与不钉的每跳往返差（对照 208 ms/跳 的旧教训）。
  平台口径（`locationHint` 只有第一次 `get()` 生效、创建后不换位置、best effort；DO alarm 单次 15 分钟）**只是预期，判据以实测为准**。
- **S3 — Neon backend conformance + 提交延迟实测**：`createStorageConformance` + `createSessionRepoConformance` 在 `packages/test-postgres` 上全绿。**并且**在 S4 那种形态的回合（≥3 次工具调用）上量三个数：**每回合 `Storage.commit()` 的往返次数**、**从 apac 钉住的 DO 打到 Neon 的提交延迟 p50/p95**、以及**它们占该回合墙钟的比例**。预期：**约 10–15 次提交**、**同区约 74 ms/次**（容器那次实测的量级）、**占一趟 20 秒回合的 5% 以内**。**超出预期就开一张优化卡**，方向限定为：一趟 drive 内复用连接、合并我们自己的业务事务；**永远不许放松「先提交再产生副作用」这条**。
- **S4 — 实例被弃后的恢复，以及工具的 effect-pending 边界**（与 S2 的差别：S2 是**实例还活着、客户端断开**，S4 是**实例被弃**）：用 `ctx.abort()` 弃掉 DO 实例（或重启 `wrangler dev`，两种都记录），随后**由 SDK 排程、无需客户端请求**触发重挂，按协议三的当前 SDK 见证定位 operation，再 `drive({operationId, waitForRetry:false})` 拿到完整结果。**判据不能只写「零重复执行」**——上游对 `effect_pending` 的工具有两种合法结局：声明为 `safe` 的**会被重新执行**，声明为 `never` 的**合成一个 interrupted 错误**（`harness.md:977,987-988`）。所以：
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
| unit / integration（崩溃） | 应用提交边界 / 真实宿主请求与 SDK 排程重入 | `GatingStorage` / `CommitDiscarded`；平台行为走官方 Wrangler workerd test harness |
| integration | Neon backend | 上游 conformance × `packages/test-postgres` |
| integration | 6 个领域工具 | **真工具**：本地 catalog + `packages/test-postgres` |
| eval | §七 | 真模型 + 真工具 |

**替身只用在 pi 自己用替身的地方**（provider 与 storage 的 plumbing 测试）；**工具一律真跑**（owner）。上游的 operation 状态机、恢复、压缩由上游测试负责，我们不重写它的测试。

## 七、直接使用 SDK 的 eval

**被测系统是同一个生产 Model + AgentHarness + tools/hooks/领域函数，在进程内调用。** 普通用例创建公开 `MemorySessionRepo` session，再 `AgentHarness.create` 与 `lane.prompt`；同步 eval 的 prompt 已包含 SDK accept/drive，无需自建轮询器。明确处理拒绝、终态失败和 suspended，后两者不能伪报成功。

- **运行和报告**：锁定的 `logfire/evals@0.22.5` 提供 `Dataset.evaluate`、`repeat`、`maxConcurrency`、`Evaluator`、`ReportEvaluator`、`caseGroups`、`renderReport`。任务在 `try/finally` 内管理自己的 SDK 资源，不建按 input id 共享的生命周期 registry；重复用例会复用 input id。直接写原生 EvaluationReport JSON 和 provenance，不保留旧 runner/report 协议。`MaxDuration` 是事后断言，不是中断任务的 timeout。
- **真实工具**：使用生产的真实 catalog 与 `web_search` 实现。eval 不依赖 agent 会话数据库、网关、staging 登录或 DO；既有真实 catalog 的测试数据面继续存在，不以工具 mock 代替。
- **证据**：直接读 SDK `LaneSnapshot`、`Entry`、结果与 usage。需要真实执行参数时，收集未经转换的原生 `after_tool` observation，使用 `after_tool.args`；tool-result entry 没有旧 spec 假定的 settled 参数字段。删除 `TranscriptResult`、旧步骤转换、synthetic OTel tree 与 W1-6 浏览器投影依赖。
- **前缀**：每个目标边界单独录制并冻结一个新 TS agent 的 source，在同一 SDK `JsonlSessionRepo` 内 open 与 `fork({scope:"tree"})`。不导入另一个 Memory repository，不写 JSONL-to-memory copier，不复用 Python 轨迹。tree fork 没有历史 entryId 参数；fork 后来的 session 不能还原早先状态。
- **状态等价**：0.85.1 的真实 tree fork 保留 entry 身份/内容与 scalar payload，**不复制 lists**。领域历史用 native entries，必要当前状态用有界 values；相同候选、未决选择、revision、引用解析和确定性选择结果必须成立。不能为旧内部表示补 list copier；若确有不能用 entries/values 表达的产品需求，先明确版本/范围缺口。
- **正确性与 pass^k**：领域 Evaluator 返回具名 boolean assertions；`REQUIRED_ASSERTIONS` 逐项到齐。`attempts = runs + failures`；已知任务/必需 evaluator/正确性失败优先判 fail；无已知失败但次数不足判 incomplete，包括完全未开始、没有 caseGroup 的计划用例；恰好 k 次全通过才 pass。装置/耗时断言不能替代正确性，judge 的分数、缺失与失败均不进入否决名单。可靠性评估不通过 task retry 擅自替换失败 attempt。
- **保留的业务政策**：三档 `prefix_gate_v1` / `reliability_v1` / `profile_v1`、四条淘汰规则、既有业务预算与真实模型/工具成本记录、provider-outage 分类、分层配对 bootstrap（种子 309、2000 次）。token/cost 算法使用 pi 的原生 Usage/calculateCost，按原始每次调用成本汇总，不重算混合模型/价格档位的聚合 token。
- **基线**：E4 直接铸造新 SUT 的原生 profile report，repeat=1，拒绝不完整、provider-starved 或 provenance 不兼容的 capture，并验证自比较与现有统计门。旧 Python/staging baseline 保留历史证据；旧 baseline parser/runner 不进入新路径。#1515/#1527 的已有先合协调约定另行核对，不再把它称作 SDK 的技术前置。
- **验证**：全量前先做 2–3 例真实 smoke；Logfire Node configure 与 Experiments UI 辅助人工核实，CI 判原生 report artifact。[固定版本的 eval SDK 核对和 API probe](../iterations/production-readiness-2026-08/EVAL-SDK-NATIVE-REVIEW.md) 只证明库行为，不等于 E1 的真实评估已经通过。

## 八、版本策略

- **owner 2026-09-09 明确接受这笔赌注**：上游把 format 4 标为 pre-stabilization、可无迁移原地改形（`harness.md:158`），CHANGELOG 又不记 harness 变更——这两件事**已知且被接受**，代价由下面的版本纪律承担。
- **精确 pin `0.85.1`，永不 pin `0.85.0`**：0.85.0 误发了内部实验代码，0.85.1 才回收（`packages/coding-agent/CHANGELOG.md:34`）。
- **升级读 diff，不读 CHANGELOG**：0.85.x 的 CHANGELOG 对 harness 只字未提（`packages/agent/CHANGELOG.md:5-12`），而 0.84→0.85 之间持久化模型从 records/facts 换成 entries + values/lists，属未公告的 breaking。
- **format 4 是 pre-stabilization**：「shapes may change in place without migrations; do not invent migration obligations for them」（`harness.md:158`），且 R11 迁移机制 specified-not-implemented（`:150`）。**我们的 Neon 表照 format 4 语义，所以上游一次 in-place 改形 = 我们自己写一次迁移**——升级卡必须含「跑一遍 conformance + 数据迁移评估」。
- **已知未实现清单**（`harness.md:143-156`）：J1（JSONL 快照压缩，死字节不回收）、R12（`watchSession()` 抛 `SliceNotImplemented`——我们用 `lane.watch()`，不受影响）、T1（telemetry 只发 hook span）、S3（search 只有骨架）、R11（迁移）、H1（`OperationStatus` 的 `"running"` 观测不到）、WP08 named-branch fork 只完成 Slice A、SQLite 分支分歧可 copy O(history)（与我们无关）。
- pi-ai 0.85.0 的 breaking：`createGatewayBindingFetch()` → `createAiBindingFetch()`（`packages/ai/CHANGELOG.md:24`）——我们的 BYOK 与模型层要一起过一遍。
- **供应商退避改由 harness 拥有**：`AgentHarnessOptions.retry?: RetryPolicy`（`agent-harness.d.ts:628`）。我们今天的 `guardedMimoTurnModel` 与 catalog 重试梯子要写出一张映射；eval 侧的 provider-outage 判定改读 `run_end.error` / `retry_end.finalError`，不再自己猜。

## 九、决策题（owner）

1. **D1 — 一个 session 一个 Cloudflare SDK Agent 宿主，pi 拥有执行。** 使用原生 schedule/keepAliveWhile，允许 SDK 调度元数据留在 DO；会话和业务数据仍在 Neon，执行装配不依赖 DO。默认不开 Queues、不新增 Worker、不引入第二个执行引擎。成本、实例配额/可用性或多实例扇出实测不能满足时再评估替代宿主，不先设计备用接口。既往方案与裁决过程见 [历史记录](../archive/reviews/2026-09-09-pi-harness-spec-revisions.md)。
2. **D2 — 我们的业务列放哪里（owner 已定：按推荐）？** 推荐**放 pi 模型之外的自有表**（quota / identity / payer），只在 session 里存与对话有关的状态（envelope 那套改成 native entries 中的领域结果与必要的有界 scalar values）。备选：全塞进 values——会让配额的读写受 commit 事务节奏摆布。
3. **D3 — 确定性选择（#1288/#1462）只提交一条关联 custom entry。** `OperationRequest` 没有非模型操作（`agent-harness.d.ts:48-77`）。宿主在 harness 之外执行领域选择，一次 `appendCustomEntry` 保存请求键、领域步骤、完整结果与 server origin，经 `entryProjectors` 供后续上下文读取。互斥、认领与澄清投影按协议七/八，不新增备选提交协议。
   **产品侧保持**：结构化 `candidates` → `ClarifyCard` → 确定性选择通道与 SD-9/data part 不变；过期 `clarification_id` 仍返回 409。W1-8 从原生 entries 与必要 scalar state 的领域投影读取未决澄清，并只消解匹配的 id/revision，不为保留旧 envelope 而新增写入。
4. **D4 — 外部 SD-9 契约保持。** 使用 AI SDK 原生 UI message writer/response，必要的 HarnessEvent→UIMessageChunk 领域投影为纯函数。按外部帧、顺序、隐私、心跳和重连行为验收，不以保留旧 TurnFrame/SSE 类为验收。
5. **D5 — Neon backend 是新包还是进 `workers/edge`（owner 已定：按推荐）？** 推荐**新包 `packages/pi-session-neon`**：它要跑上游 conformance（Node 侧），而 edge 是 Worker bundle；分开才能让 conformance 在 CI 里独立成 lane。
6. **D6 — 迁移策略：并行双跑还是硬切（owner 已定：按推荐）？** 推荐**硬切 + 新 session 起算**：format 4 与我们今天的 `runs`/`messages`/`run_steps` 没有语义对应，双写会同时维护两套恢复语义。历史会话保留只读（现有取回面继续读旧表），新会话一律新路径。若 owner 要求历史可续聊，那是另一张迁移卡。
7. **D7 — eval 使用依赖库现成能力。** 执行、并发、重复、断言、judge 与报告直接走 logfire；session、轨迹和 token 成本走 pi。仅保留 §七列明的领域判据、预算、pass^k、统计和基线政策；删除 staging task 与旧 report/trace/Python wire 转换。
8. **D8 — spike 失败怎么办（owner 已定：按推荐）？** 推荐把 S1–S4 的任一条红当作**回到 owner**，而不是自动回退——0.84.4 的现状能跑，没有时间压力。
9. **D9 — 升级节奏（owner 已定：按推荐）？** 上游约一周一发（`packages/agent/CHANGELOG.md:5-33`）。推荐**季度评估 + 安全修复即时跟**，每次升级跑 conformance 与 S1/S2/S4；不追新。
10. **D10 — 逐文件删除清单要不要单独评审（owner 已定：按推荐）？** 推荐**要**：W0-1 先产出 115 个文件的 delete/rewrite-domain/retain-domain 判定并单独过一轮评审，再开 W1；spec 里只放目录级判定（§2.1）。凭印象写的清单会漏掉 sweeper/settlement/retrieval 这种「看起来是业务、其实读的是要死的表」的文件——第一版就漏了，而且把 113 写成了文件数。
11. **D11 — 客户端幂等键与预留时序。** 使用 `(session_id, client_message_id)`：先持久写准入意图并为该 key 分配 `operationId`，再预留，最后把该 id 传给 `accept`（`lane.js:319`）。发现与当前 SDK 见证严格遵循协议三/四/八；不使用初始 `create.open` 作持续对账依据，查询失败保持未结，未对账义务阻止冲突准入。必须经真实入口验证同 key 在响应丢失后获得同一 operation、不二次扣减，并覆盖接受已提交但业务记录未补齐的故障窗口。
12. **D12 — 前缀使用 SDK 原生 tree fork，按已发布实现修订。** 在同一个 JsonlSessionRepo 中，每个目标前缀先录制并冻结独立 source；0.85.1 复制 entries 与 scalars，不复制 lists，也不接受历史 entryId。验收比较 entry/ref 身份、标量与候选/revision/确定性选择的领域等价；内部表示允许重写，不能用补写 copier 假装 SDK 已实现旧 AC。
13. **D13 — 新 session 的读面放哪（owner 已定：按推荐）？** `GET /v1/conversations/{id}/messages` 今天跑在 **Worker 里、不在 DO 里**（`retrieval/conversation-retrieval.ts:11`）。推荐**保持这个分工**：读面在 Worker 里直接走 `Storage.scanBranch`（只读，无需租约），**只有断线重连**才需要 DO 的 `watch().snapshot`。备选是全部收进 DO——会把每次翻历史都变成一次 DO 唤醒。
14. **D14 — 计费真相在 usage ledger 还是我们的 `dailyUsage`（owner 已定：按推荐）？** 推荐**继续以 `dailyUsage` 为账，ledger 为源**：W1-7 从 `scanUsage({fromSeq})`（`types.d.ts:376-381`）增量读进我们的表，因为配额与计费口径（日窗、payer、退款）pi 不认识。
15. **D15 — 旧 session 迁不迁（owner 已定：按推荐）？** D6 定的是「历史只读旧表」；**要不要把旧会话搬进 entries** 是独立一问。推荐**不迁**：旧表继续服务旧会话的读面，直到自然衰减；迁移要写一次 format-4 的映射，而 format 4 本身还在 pre-stabilization。
16. **D16 — 断线重放怎么做（owner 2026-09-10 定：(b)）？** Cloudflare **没有任何一处**演示服务端解析 `Last-Event-ID` 并从缓冲重放（Agents SDK 走的是 WebSocket + SQLite 缓冲重放，不是 SSE 原生机制），所以这块是我们自己的设计。二选一：**(a) 协调者按游标缓冲 `HarnessEvent` 并在重连时按游标重放**，代价是 DO 里要有一个有界缓冲与淘汰策略；(b) 尽力而为：重连一律 `resnapshot` 拉快照、丢掉断线期间的增量帧——够用（owner 的核心场景是「切走再回来拿到完整结果」，快照就能满足），但正在流式输出的那一段会跳变。**owner 2026-09-10 定：先 (b)，(a) 留成一张后续卡**。D1 取 (1) 之后有一个**附带好处，但不作为要求**：实例还活着时的重连**可以**直接重新挂上 `watch()` 拿到当前 snapshot 与后续事件；实例已被驱逐或回合已结算时仍然只能重新取快照。所以判据仍是 (b)——**「切走再回来拿到完整结果」由快照满足**，不承诺补发断线期间的增量帧。心跳由宿主的定时器发（§4.1 第 6 条）。

## 十、分卡

一卡一 worktree 一 PR；`needs` 是硬依赖。test-type：`unit | integration | eval | api | browser | ci`。

卡片与阻塞关系以 [#1356 的子卡](https://github.com/lifeodyssey/animichi/issues/1356) 及 GitHub 原生 dependencies 为准，不在本文维护第二张依赖表。W0 清单/迁移与 P0 平台验证先行；W1 直接装配 SDK 与领域业务；W2 删除旧路径并重建测试；E1–E4 直接运行 SDK eval、录制前缀并铸新基线；最后 W4 才删除 Python 运行臂。

**验收（产品行为与关键故障边界）**

- **W0-2** — [ ] **(integration)** 以 Prisma 8 原生 contract/migration 新增 SDK metadata / entries / values / lists / usage 所需存储，不固定物理表数量；不改已应用的 Atlas 迁移或旧表，旧表退役另需切换证据与评审。[ ] **(integration)** 业务准入/选择共用 `agent_admissions`（原称 `admission_intents`），唯一键为 `(session_id, client_message_id)`，状态仅 `pending｜accepted｜settled｜void`；model 准入预分配 operation ID，selection 不造假 operation。[ ] **(integration)** `agent_open_operations`（原称 `open_operations`）仅为 `operation_id` 主键的辅助恢复索引；`agent_settlements` 独立按 `operation_id` 发现未结义务，以 `settled_at` 守卫账本游标、费用与退款的同一事务。[ ] **(integration)** 预留/退款坐标保存在准入行，复用既有 `anon_daily_message_count` / `daily_usage`；不新增第二套 quota 或 run 状态机。变异：破坏旧表或 ID/parent/request-key/预留行为，相应真实 PostgreSQL 测试红；不以保留某个 trigger 或重复 validator 作为验收。严格 TypeScript 不用 skipLibCheck；迁移验证 artifact B/C 选择、重复执行与不兼容状态拒绝。完整 SDK backend conformance 归 W1-1。
- **W0-1** — [ ] **(unit)** `git ls-files workers/edge/src/agent` 的 **115** 个文件每个都有 delete/rewrite-domain/retain-domain 判定与替代接缝，含目录根下的 `durable-namespace.ts`（13）与 `json-record.ts`（9）；`db/schema.ts`、`migrations/neon/*agent_runs*`、`gateway/agent-turn.ts:24-31` 三处在列；清单单独评审通过后才开 W1。
- **P0-S1** — [ ] **(ci)** `wrangler dev` 下 import 0.85.1 与 chord 并调用一次 `AgentHarness.create`，成功；bundle 体积增量记入卡；**`esbuild` 不在产物里**（`grep` 产物为 0）。[ ] **(unit)** bundle-smoke 常驻。
- **P0-S3** — [ ] **(integration)** `createStorageConformance` 与 `createSessionRepoConformance` 及另外 8 个套件在 test-postgres 上全绿，**一个 skip 都没有**；跳过任一条即卡红。[ ] **(integration)** 在 ≥3 次工具调用的回合上记录**每回合 `Storage.commit()` 往返次数**、**apac 钉住的 DO → Neon 提交延迟 p50/p95**、**占回合墙钟的比例**；对照预期（≈10–15 次、同区 ~74 ms、20 秒回合的 <5%），超出即开优化卡（连接复用 / 合并业务事务；不得放松「先提交再产生副作用」）。
- **P0-S4** — [ ] **(integration)** 杀实例后由 SDK 排程重新挂载，用当前 SDK 见证定位 operation，再 `drive({operationId, waitForRetry:false})` 得到完整结果。**判据用 §五 S4 的逐工具矩阵，不是「零重复执行」**：声明 `safe` 的工具每个 `invocationId` **最多一次外部效果**（允许被再次调用）；声明 `never` 的工具得到显式 `interrupted`；三个持久边界各注入一次故障。
- **W1-2** — [ ] **(unit)** 生产直接 `drive({waitForRetry:false})`；`waiting.notBefore` 注册 SDK wakeup，不阻塞等待。变异为 `waitForRetry:true`，测试红。
  [ ] **(integration)** SDK cold attach/排程恢复使用当前 SDK 状态，逐个 drive 真实 open operation；aborting 走取消对账，不使用 `resume` 或缓存 create.open 作持续真相。
  [ ] **(unit)** 执行装配返回 SDK 对象，import 图无 DO；同一模型/工具/hooks 可在 Node 中直接运行，无自建 harness facade。
  [ ] **(integration)** Neon await 点交错两个请求与一个排程 callback，初始化、accept、drive 和业务写均不重入，至多一个活挂载；已有 drive 时不启动第二个。
  [ ] **(unit)** 仅 SDK 调度元数据可落 DO SQLite；变异为保存消息、工具 payload、session values、凭据或记账数据，边界测试红。
  [ ] **(integration)** 首个准入前已有持久 sweeper，接受工作有可恢复 wakeup；在 accept 提交后、首趟 drive 前杀实例且客户端不重试，工作仍恢复并恰好结算。
  [ ] **(integration)** SDK keepAliveWhile 与 retry schedule 共存；≥130 秒回合中途断开客户端仍完成，重启后继续恢复。禁用保活或覆盖 retry wakeup 的变异必须失败；记录实际资源/成本证据。
  [ ] **(unit)** 所有 AGENT_SESSION stub 取得路径带 `locationHint:"apac"`，明确仅首次创建与 best-effort 限制。
  [ ] **(integration)** 每个请求和排程入口先处理 fault，重挂成功前不准入/drive；已记录永久拒绝与结果未知按协议一/八分别验证，不按异常文字判别。
- **W1-9** — [ ] **(unit)** 第一个准入事务之前，SDK 已持久注册独立 sweeper；多次宿主初始化不会重复注册。验收排程时序与恢复行为，不要求保留旧 ensureScheduled/run-backstop 类。
- **W1-9** — [ ] **(integration)** **全新的 DO namespace、第一个请求**：崩溃停在 ③ 之后、④ 尚未完成、⑤ 之前，**客户端不重试**，仅靠 sweeper 恢复到结算；把扫描排程挪到准入之后，测试红。[ ] **(integration)** 扫 pending/accepted 准入、未结选择与独立未结算义务；create 后新接受、retry-waiting、终态未结算均可发现。把扫描缩成 post-accept 索引、用过期 `create.open` 或查询失败判退款，对应测试红。
- **W1-3** — [ ] **(unit)** **日常配额拒绝发生在 `accept` 之前**，不经 `before_drive`；变异：把配额判定挪进 `before_drive`，「一次拒绝之后同一实例还能接下一条合法请求」的测试红（因为实例已被 fault，`lane.js:734-754` → `harness.js:231-243`）。[ ] **(unit)** 永久性拒绝 ⇒ 持久取消 + 结算 + **退款**；临时性依赖故障 ⇒ 排程重试，不写终态。[ ] **(integration)** 一次拒绝之后：operation 被释放、预留被退、**同一 session 的下一条合法请求被正常接受**。[ ] **(integration)** **准入幂等按 `(session_id, client_message_id)`**（协议四）：映射在预留**之前**持久写入；「响应丢失后客户端用同一 `client_message_id` 重试」经**真实入口**重放，**拿到同一个预分配的 `operationId`**、不产生第二个 operation、不二次扣减；结果未知的 pending 准入按预分配 id 查 `inspectExecution().current` → `getResult`：在跑则补 ④⑤，终态则补义务并结算；仅两项查询成功且均明确无该 id，才释放孤儿预留并转 `void`（**D11**）。[ ] **(unit)** 该 session 有未对账的 pending 意图时，新的准入被拒。[ ] **(integration)** **同一实例上 ④ 失败**（accept 已成、业务事务没成）：sweeper 补完 ④⑤ 并结算，**绝不退款判废**。[ ] **(integration)** **create 之后才被接受、且处于 retry-waiting 的 operation**：SDK 排程照样把它 drive 起来。[ ] **(unit)** 变异：把 `create.open` 缓存下来当作「当前有哪些 open operation」的依据，上面两条测试红。
  [ ] **(integration)** **存储提交成功、提交调用抛错、DO 还活着**（协议八）——在 ③ 注入：重挂后那笔**合法的 operation 继续跑或按真实终态结算**，**不取消、不退款**；变异：走协议一的无条件 `requestAbort`，测试红。
  [ ] **(integration)** 同一形态在 **⑥/⑦** 注入：重挂后用 `getResult` 认到真实终态并据此结算；判定查询本身仍在失败期间，义务保持未结（既不判「不存在」也不退款）。
  [ ] **(integration)** **第一次重开/`create` 也失败，之后某次 alarm 成功**：同一笔 operation 照常结算，**不取消、不退款**；变异：把「重开失败」当成终局判废，测试红。
  [ ] **(unit)** 分流判别只看**我们记下的拒绝理由**，不看异常类型或消息（两条路径都是同一句 `HarnessFault`，`harness.js:236-237` / `:306-308`）；变异：改成按异常判别，「存储提交失败」被误判成永久拒绝、测试红。
- **W1-8** — [ ] **(unit)** 从原生 committed entries 与必要的 scalar value 计算未决澄清，过期 clarification_id 返回 409；不用 envelope 或重复状态仓库。[ ] **(unit)** 单条 correlated custom entry 保存请求键、领域步骤、完整结果和 server origin，外部 SD-9/data part 保持。[ ] **(integration)** 选择复用请求键业务账本，执行与 append 前都在宿主互斥内确认 lane 空闲；retry-waiting 时拒绝/等待，不排进不可见 inbox。[ ] **(integration)** 恢复先处理未结选择，再处理准入，存在未对账义务时不接冲突请求。[ ] **(integration)** append 已提交但调用抛错时重挂，按请求键认领真实 entry，不重复 append；首轮 reopen/create 失败后，下次排程仍可恢复，不能默认取消。[ ] **(integration)** 在领域执行后、custom entry 提交后、成功结果的澄清消解/投影边界后注入故障，恢复到一条 committed result 和至多一次外部效果；只消解匹配的 clarification_id/revision，不能清掉新澄清。若投影与提交同边界，验证等价边界，不重建额外 envelope 写入。
- **W1-5** — [ ] **(unit)** 本轮看到逐字工具结果、下一轮看到冻结摘要、**entry 里存的始终是逐字文本**；变异：把摘要写进 `after_tool` 的 content patch，第三条断言红。[ ] **(unit)** 载体写死：摘要走 `after_tool` 的 **`details`** 补丁（`agent-harness.d.ts:569-576` 的 `content` / `details?: JsonValue`），**`content` 保持逐字**，`transform_context` 只把 `details` 里存的那个字符串读回来施加。[ ] **(integration)** **摘要是必需的持久 sidecar**：重启进程并**换一版 summariser** 后，历史里那条摘要**逐字不变**（`frozen-tool-return.ts:2-18` 的整条理由）；变异：改成读路径重算，测试红。[ ] **(unit)** 没有存过摘要的旧行**保留逐字原文**，不现场补算。
- **W1-7** — [ ] **(integration)** 待结算记录**独立于 open operation**，有自己的扫描路径（协议五）。[ ] **(unit)** ledger 游标 + `dailyUsage` + 退款标记在**同一个业务事务**里。[ ] **(integration)** 三处故障注入——终态提交后 / 业务提交前 / 提交响应丢失——各自**恰好结算一次**。
- **W1-6** — [ ] **(unit)** §4.2.1 每项外部帧语义有覆盖；SDK watch 的 snapshot/live 配对经 AI SDK writer 输出相同 SD-9 surface，机密字段不出流。[ ] **(browser)** 实际流含满足空闲连接约束的心跳，断线不会取消持久工作，重连 snapshot 能恢复展示；关闭心跳/泄露字段/丢失重连状态分别使对应测试红。
- **W2-1** — [ ] **(unit)** **W0-1 清单里判定为 delete 的每一个文件**从 `git ls-files` 消失（不是「十个文件」），含 `packages/contract/src/staging-prefix-*.ts`、`gateway/staging-prefix-route.ts`、`packages/eval/src/prefix-seeding-lifecycle.ts`、`packages/eval/src/trajectory-prefix-case.ts`；`db/schema.ts` 的 `runs`/`messages`/`run_steps` 只剩旧会话读面在用；`workers/edge` 全测试绿。
- **E-1** — [ ] **(eval)** 33 例调用进程内同一原生 harness 与真实模型/catalog/web_search，无 agent 数据库和 staging 凭据；runtime call graph 不含旧 HTTP task、transcript converter 或 staging api-test 模块。[ ] **(unit)** 原生失败和 suspended 均不能记成功；任务资源正常关闭，重复 attempt 会话相互隔离。
- **E-2** — [ ] **(unit)** 原生 tree fork 保留 source 的 entry id/内容、相关 scalar payload；相同引用在 fork 可解析，候选、未决选择与 revision 相同。源来自同一 SDK JSONL 仓库的冻结前缀，原生 open/fork round trip 不 remint id、不造转录、不写 copier；变异 fork scope 或丢失当前状态，领域等价断言红。[ ] **(eval)** 五个 `phase1c_selection_v1` 用例直接走生产确定性选择函数，不再答 `SELECTION_EXPIRED`。

## 十一、取代关系

- **`docs/archive/specs/2026-09-08-eval-suite-redesign-spec.md` 全文被本 spec 取代**（它自己在 5 个修订里被 owner 前提改了三次）。**存活并搬进 §七**：三档套件与规模、pass^k 的三态判据与 `REQUIRED_ASSERTIONS`、淘汰四规则、`logfire/evals` 与 Experiments 核实、统计门、smoke 纪律、语料只从 TS agent 重录。**随本 spec 作废**：进程内宿主要新写 `TurnRecords`/多 run store（改由 pi harness 提供）、D5 的 test-postgres 回合表（eval 不再要数据库；test-postgres 留给 catalog 与 backend conformance）、`seedTrajectoryPrefix` 相关的一切（改 `fork`）、staging canary 与 CD 讨论（早已移交 smoke）。
- **`docs/specs/2026-09-01-agent-ts-rewrite-spec.md`**：**第 16 行非目标作废**；§五 W3（eval 搬 TS）与 §十（评估装置）由本 spec §七 取代；W1/W2 的功能对等清单仍是验收基准；**W4 顺序不变**，但前置从「eval 双跑」改成本 spec 的 E-4。
- **issue**（`gh issue view` 实查）：#1303（W3-5 双跑，OPEN）关为**被取代**；#1515 / PR #1527（TS 基线，OPEN）**先合再由 E-4 重铸**——它铸的是旧被测系统的基线，本次换 SUT 后必须重铸；#1380（前缀 seeding，OPEN）关为**被 `fork` 取代**，其已合入的旧 seeding 代码进 W2-1 删除清单；#1309 / #1311 / #1462 已 CLOSED，其领域要求（真实输入、执行见证与服务端动作计分边界）通过原生 entries/hooks 重新验证，旧 wire/trace 接口不保留；#1243 / #1258 两个 epic 需要按本 spec 重排波次。

## 十二、风险

- **上游 pre-stabilization**：format 4 可在无迁移的情况下原地改形（`harness.md:158`）。缓解：pin 精确版本、升级读 diff、conformance 常驻、D9 的季度节奏。这是本次最大的一笔押注，**owner 2026-09-09 已明确接受**（§八）。
- **workerd 未被上游验证**：browser smoke 不等于 workerd smoke，chord 是硬依赖。缓解：P0-S1 是第一张卡，红则停。
- **删 ≈4,100 行会连带删掉未被上游覆盖的语义**（冻结摘要 #1378、状态栏 #1379、服务端步骤 #1462）。缓解：它们各自有接缝（§4.2）与 W1-5/W1-8 的卡，删除只在 W2-1、且在对等清单勾完之后。
- **conformance 不覆盖业务语义或生产提交延迟**：上游用例不测我们的配额、宿主互斥、业务恢复或 DO → Neon 往返。缓解：Tier A/B/C 的业务测试（§六）、就近 `locationHint` 与 P0-S3 实测；后续连接复用/业务事务合并另开优化卡，本次不预做，也不放松先提交再产生副作用。
- **eval 的真 web_search 带来不稳定**（owner 已接受）。缓解：`prefix_gate_v1` 的前缀本就冻结；`reliability_v1` 的 pass^k 会把它量出来而不是掩盖。
- **删除清单写小了会漏掉活着的读者**：`sweeper`/`settlement`/`retrieval`/`turn-selection.ts:31` 看起来是业务，其实读写的是要死的表或要删的模块。缓解：W0-1 逐文件判定 + 单独评审（D10）。
- **`fork` 的 scope 选错会让前缀用例静默退化**：branch scope 不复制任何应用状态（`harness.md:547`）。缓解：D12 取 tree scope + E-2 的等价性 AC。
- **旧设计被误当作当前约束**：旧 eval spec 已归档并指向本 spec；根指引与主题表只把本 spec 标为当前 agent/eval 目标。2026-09-01 spec 仅保留未被取代的功能对等验收，旧架构、宿主与 eval 决策以本文为准。

既往评审回应已移入 [revision 14 历史记录](../archive/reviews/2026-09-09-pi-harness-spec-revisions.md)；本文件只保留当前执行要求。
