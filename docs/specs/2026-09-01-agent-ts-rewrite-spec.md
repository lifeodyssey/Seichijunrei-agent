# Spec — agent TS 重写（pi agent core × DO × Neon 单一真相源）

- Status: W0 closed 2026-09-03（S1–S5 全通过硬条件，kill-switch 未触发，#1249）；W1 in progress — owner 已定方向（2026-09-01 grilling），本文件为简化版权威决策记录；复杂化 spec 由后续更强的模型在此基础上扩展。
- 决策输入：`docs/specs/2026-09-01-pi-agent-core-research-report.md`（workerd 实测通过）× `docs/iterations/production-readiness-2026-08/PI-AGENT-CORE-RESEARCH.md`（8/29 NO-GO 全量迁移 / GO 限 spike 门——本 spec 保留其门）× `docs/specs/2026-08-17-agent-ts-research-report.md`（#1106）。
- 战略动机：消灭 Python 容器冷启动（2026-09-01 实测：睡醒唤醒 28–32s、部署后 74s；PR #1239 只是把库的 20s 等待预算放宽到 55s，没有缩短冷启动本身）；异步病根（#729 / #1235 request-parked ingest / turn 生命周期补丁群）根治为"回合活在请求之外、Neon 唯一真相源"；仓库收敛为纯 TS 单流水线。
- 2026-09-01 二轮 grilling（Q1–Q5，owner 定案）：回合宿主 = DO alarm；断线 = 不续流、回来按会话 ID 拉最终结果；W1/W2 不设自动 eval；eval 只对真实环境测；agent 住进 `workers/edge` 不新建 Worker。已并入 §二–§八。

## 一、目标 / Non-goals

**目标**：`apps/agent`（Python 23,563 生产行）整体退役，chat agent 以 TS 重写跑在 Cloudflare Workers DO 上，Neon 为唯一真相源，全量功能对等（6 模型工具、BYOK、上下文与记忆（§九）、662-case eval 统计门），完成后直接删除 Python，无影子期。

**Non-goals**：
- 不引入独立队列系统（pg-boss / CF Queues 第一天都不要）。
- 不改 edge 鉴权模型（Neon Auth JWT 仅 edge 验证，AUTH-2 #950 契约不动）。
- 不改 `packages/contract` 的 zod 契约与 SD-9 帧 surface（web 端改动最小化）。
- 不押注 pi 上游未实现的 `AgentHarness`（HEAD 仍抛 `HarnessNotImplemented`）——只用 core Agent 层。
- 不动 launch 链依赖（#1072/#1077 照旧并行）。

## 二、已定决策（2026-09-01 grilling 记录）

| 决策点 | 结论 |
|---|---|
| 内核 | `@earendil-works/pi-agent-core` + `pi-ai`，钉 exact version，每周跟进 CHANGELOG breaking 段 |
| 语言/运行时 | 全 TS；agent 作为 DO class **住进 `workers/edge`**（今天 Python 容器就挂在 edge 名下，重写只是容器换 DO class，不新建 Worker——每多一个 Worker 就多一份 secret 触点 / cohort 扩散 / 队列阻塞；users 因持有独立最小权限 DB 凭证保留独立，catalog/migrator 因生命周期不同保留独立）；`apps/agent` Python 全删 |
| agent loop 承载 | DO，每 session 一个实例；**回合跑在 alarm handler 里**：intake 写 Neon → `setAlarm(now)` → DO 在 alarm 内跑完回合并落库。依据 CF 文档（2026-07-28）：fetch 调用的 wall time 只在调用方保持连接期间无限，断开后关联任务可能被取消；alarm handler 有独立 15 分钟 wall time，与连接无关（现行整回合 deadline 100s，余量 9 倍） |
| 队列 | 无。`runs` 表（状态+超时）+ DO alarm 扫描回收；"outbox 本质"= message+run 同事务落库 |
| 断线语义 | 回合在后台跑完；客户端回来**按会话 ID 拉一次最终结果**（现有 `GET /v1/conversations/{id}/messages`，加 run 状态字段），**不续流**——owner 定：续流是加分项不是门槛，砍掉后落库粒度不受"可寻址 delta"约束。连接在时仍按 SD-9 帧实时推 SSE |
| W1/W2 回归守护 | **不设自动 eval**，靠 staging 手动验证（owner 接受风险）；W3 一次性搬完考卷 |
| eval 被测目标 | **只对真实环境**（staging HTTP）测整个 agent，不做进程内档；工具轨迹从 SSE/GET 转录取，不依赖 span tree |
| 范围 | 全量 parity，波次仅是执行顺序（§五） |
| Python 退场 | 直接删，无影子期（生产冻结于 staging-only，删除风险最低窗口） |
| schema 边界 | `packages/contract` zod 不动；pi 工具参数用 typebox，单一转换点（zod↔JSON Schema 桥位置在 W1 定，防双 schema 漂移） |
| 结构化输出 | "submit_result 工具 + 校验 throw 回喂 + terminate"模式复刻 `output_validator` 闭环（8/29 note 硬条件 2） |
| 上下文与状态栏 | **转录重放每一轮的工具调用与结果为结构化消息**（不再把早先一轮降级为文本）；**工具返回摘要在写入时定稿并冻结**，删除「最新 8 条」的每轮再压缩，只保留阈值批量压缩；`SessionEnvelope` 从系统提示词移到转录末尾的 `<agent_status>` user 消息、每轮替换 ⇒ 系统提示词按模型/工具集字节稳定。依据李博杰《深入理解 AI Agent》第 2 章（owner 2026-09-05，#1297）。展开见 §九 |

**决策日志**

- 2026-09-05 · #1297（W2：跨轮工具返回重放 vs 每轮压缩窗口）：**选项 (b) accepted-with-redesign** — 采纳「重放早先各 run 的工具返回」，但按李博杰第 2 章重塑为 §九 的三个动作（结构化重放 / 写入时冻结摘要 / `<agent_status>` 状态栏）；选项 (a)「把 per-run 保留窗口当作 TS 层语义接受」否决。卡片 #1377 · #1378 · #1379。
- 2026-09-05 · #1309（111 处 in-process 会话种子没有 wire 形态）：**选项 (b) 塑形为环境初始化**（不是模型可见的头部）——
  一个 staging-only 的初始化过程经产品自己的 store 代码把冻结前缀写进目标 session；(a) 降级为端到端用例、(c) 重录
  `message_history` 均否决。**评审期核实出一处与裁决前提相反的事实**：那 111 处种子（76 个用例）在 Python 基线里
  本来就不生效（`animichi_runner.py:168-181` 无 `last_search_data` 分支，`test_animichi_runner.py:95-105` 钉死；
  `last_location` 无读者），真正缺起点的是 5 个 `seeded_pending` 用例。故裁决落地拆档：机制 + 5 例先做，76 例改造
  owner 2026-09-06 选 A：暂不改造（两侧都是空会话基线，配对比较成立；改造需同批重做 Python 基线），待 #1383 失败归因看这 76 例是否集中失败再议。展开见 §10.1，卡片 #1380。
- 2026-09-05 · #1311（`argument_correctness` 线上只有一个见证人）：**选项 (b) 发布第二见证**——
  取回面发布 `run_steps` 的已结算参数，`TranscriptStep` 加 `params`，评估器按 Python 比 `args` vs `params`；SSE 不动；
  (a)「排除该指标」否决。展开见 §10.2，卡片 #1381。
- 2026-09-05 · 评估装置补齐（依李博杰第 7 章「验证器」「失败归因」）：新增确定性终局答复验证器与失败归因记录，
  两者先 report-only，跑满一轮基线周期后由 owner 决定是否入门；统计门维持自建的分层配对 bootstrap（§10.5 给了不换的理由）。
  卡片 #1382 · #1383。

## 三、目标架构

```text
浏览器 ──SSE（连接在时）──> workers/edge
   │ POST /v1/chat        ├─ 身份/Turnstile（不动）
   │ GET /v1/conversations/:id/messages（回来时拉最终结果）
   ↓                      ├─ intake：dedupe + 单 TX 写 Neon（messages + runs + 配额预留）→ setAlarm(now)
                          └─ AgentSession DO class：alarm 内跑 pi loop + 工具 → 结果落库
                                     │ 卡死回收：runs 表超时 + alarm 扫描
                                     ↓
                          Neon = 唯一真相源 · Logfire = trace（@pydantic/logfire-cf-workers）
```

组件职责（全部在 `workers/edge` 内，不新建 Worker）：
- **身份层**：不变。验 Neon Auth JWT / 匿名 Turnstile，受信身份进入 intake。
- **intake**：按 (session, client_message_id) dedupe；单事务写 messages + runs(running) + 配额预留；事务提交后 `setAlarm(now)` 叫醒该 session 的 DO（快路径）。**兜底必须独立于 session DO**（提交与 `setAlarm` 之间崩溃时该 DO 未被武装，它自己的 alarm 永远不会响）：一个单例 `RunSweeper` DO 以周期 alarm 扫 `runs` 表中 `running` 且租约过期/从未取得租约的行，对其 session DO 重新 `setAlarm(now)`；扫描幂等（重复叫醒无副作用，由 DO 侧租约保证）。这就是 at-least-once 的来源。
- **AgentSession DO**：alarm handler 内载入转录 → pi Agent（mimo-v2.5 经 `createProvider` custom Model）→ 工具执行 → 若有连接在则按 SD-9 帧推 SSE；结束 = assistant message + usage 结算 + run=succeeded 同一 TX。落库粒度按工具步骤 + 文本段聚合（不需要可寻址 delta）。单写者语义 = turn 租约；admission 沿用现有 `turn_admission` 语义移植（忙时并发回合拒绝/排队）。
  - **alarm → SSE 交接契约**：`alarm` 与 `fetch` 是同一 DO 实例上的两次调用，共享内存。`fetch(POST /v1/chat)` 在实例内存里登记一个订阅者（`WritableStream` writer），返回 SSE 响应；alarm 内的 loop 每产出一帧就对当前订阅者集合 `write`（await，天然背压）；写失败或客户端断开 → 移除订阅者，loop 不受影响。订阅者**不持久化**：DO 被驱逐、或 alarm 在没有订阅者时跑完，客户端拿不到直播，按 §二"断线语义"回落 `GET …/messages` 取最终结果。这是 best-effort 直播，不是投递保证；W1-5 的 browser AC 覆盖"连接在时看到帧、切走回来 GET 拿到完整结果"两条路径。
  - **工具步骤幂等（alarm 重试安全）**：每个工具步骤的结果以 `(run_id, step_index)` 为键**先落库再继续**；alarm 因驱逐/重启重跑同一 run 时，从已落库的步骤回放，不再执行已有结果的步骤。有副作用的工具（当前只有 route 工具的落库、未来的 BYOK 出站）必须接受该幂等键；只读工具（catalog、web search）天然幂等。S4 的"驱逐/重启恢复"用例必须包含"工具成功但结果未落库前崩溃"这一分支，验证只执行一次。
- **取回面**：现有 `GET /v1/conversations/{id}/messages` 加 run 状态（running / succeeded / failed+reason）；web 今天断线本来就是整体重拉这个接口（`use-stream-recovery.ts:62-66`），改动 = 多读一个状态字段。

## 四、Phase 0 spike 门（= 8/29 note 五痛点表 + GO 硬条件的工程化）

按新报告 §七 S1–S7 执行，全部**真部署 Worker + 真实网关**，wrangler dev 不算数：

- **S1**：三 provider matrix + deployed Worker + abort 三处断点 + cold/warm 唤醒毫秒数实测（写回本 spec 附录）。
  - 结论：**通过**。cold / warm 唤醒 477 / 803 ms，唤醒 <1s 的收益成立；mimo 与 Gemini 往返均 200 且 clean；三处 abort（provider_stream / tool_call / final_frame）全部 aborted=yes clean=yes。Anthropic 因本地无 key 未测（非 workerd 故障），作为 [U] 带入 W1，不构成硬失败。（附录 A）
- **S2**：mimo-v2.5 网关方言定版（compat 开关阵逐项实测：tool calling 往返 / strict / maxTokensField / streaming usage）。
  - 结论：**通过**。19 个直连用例（默认 + 9 个开关各两值）全部完成工具往返且带流式 usage，mimo 直连不需要任何 compat 覆盖；单轮 wall 4–12 s、中位数约 6.5 s。zen 路由无 `ZEN_GO_API_KEY` 未测，W1 用直连，故不阻塞。（附录 B）
- **S3**：esbuild `.lazy` chunk bug——file upstream issue；我方 CI 加"bundler 产物 smoke 执行"门；先用已验证 workaround。
  - 结论：**通过**。常驻门 `pnpm --filter edge-worker run test:bundle-smoke` 打包 `workers/edge/bundle-smoke/pi-kernel.worker.ts` 并在 workerd 内**执行**产物；把入口换回 `api/openai-completions.lazy` 即转红，workaround 因此被机器盯住。（CI 门 #1263 已合并；upstream 报告 `docs/specs/2026-09-01-pi-ai-esbuild-lazy-chunk-report.md`）
- **S4**：DO 状态机：并发同 session、eviction/restart、provider/tool 中途故障 → 进行中 turn 必须能恢复到"收尾一致"（不依赖上游 harness）。**硬条件（Q1 定）**：在真部署 DO 的 alarm handler 内跑一个刻意 5 分钟、含 3 次工具调用的回合，期间客户端断开，最终 Neon 里 run=succeeded 且转录完整；同时实测 alarm 内一次回合的 DO 计费 wall-clock。**该 spike 使用独立的 spike-only 回合 deadline（≥ 6 分钟，spike 配置项，不进生产默认值）**——生产的整回合 deadline 仍是 100s（§二），5 分钟只是为了逼近 alarm 的 15 分钟上限做压力验证；恢复用例必须含"工具成功但结果未落库前崩溃"分支（§三 幂等契约）。
  - 结论：**通过**。同 session 的第二个回合被唯一索引 `runs_one_running_per_session` 以 409 直接拒绝；"工具成功、步骤行未落库"崩溃分支重放精确一次（3 个步骤共 4 次工具执行）；刻意 5 分钟、3 次工具调用的回合在客户端断开后仍在 alarm 内跑完，staging Neon 里 run=succeeded 且转录完整，DO 计费 wall-clock 100.9 s。（附录 C）
- **S5**：BYOK/egress 红线（8/29 note 条件 6 全表：allowlist、非空 key、无 server-key fallback、SSRF 边界、redirect、日志脱敏）。
  - 结论：**通过**。应用层每条红线都 deny 且带出拒绝原因（`host_not_allowlisted` / `unknown_provider` / `scheme_not_https` / `port_not_443` / `metadata_address` / `own_infrastructure` / `empty_key`）；allowlist 内的三个供应商 host 真实到达对端，假 key 得 401/400 且错误文本不含 key；恶意 302 在第 1 跳即 deny；平台出站代理对私网/元数据目标另有一层拒绝（9 个目标，403；`metadata.google.internal` 为 530）。DNS 混合 A 记录与"验证→连接"之间的重绑定仍 [U]（需自控 nameserver），作为 [U] 带入，不构成硬失败。（附录 D）

**Kill-switch**：S1–S5 任一硬失败 → 内核层回退 Vercel AI SDK ToolLoopAgent（#1106 的 39/60 基线，输出回喂自建 ~50–100 行）；**架构壳（DO/Neon/intake/GET）不变**，只换 loop 层。spike 结论与复测数据必须回填本 spec 后才进 W1。

**裁决（2026-09-03，W0-KS #1249）**：S1–S5 全部通过硬条件，kill-switch 不触发；内核层保持 pi-agent-core + pi-ai，W1 按 §五 开工。

- 带入的 [U]（都不是硬条件的一部分，拿到条件后各补一行即可）：Anthropic 在 workerd 上的往返未证实（本地无 key，附录 A）；DNS 混合 A 记录与"验证→连接"之间的重绑定未测（需自控 nameserver，附录 D）。
- spike 产出的两条实现硬要求：assistant 的 tool-call 消息必须与 `run_steps` 一起持久化并从转录重放，重放才能落在同一 `step_index`（附录 C，W1-3 #1252）；Google BYOK 走 pi-ai 的 OpenAI 兼容面，因为其 `google-generative-ai` 拒绝注入 fetch（附录 D，W2）。

## 五、波次（顺序，非减法）

| Wave | 内容 | 出口判据 |
|---|---|---|
| W0 | spike S1–S5 + kill-switch 裁决 | 已回填（#1249） |
| W1 | 核心环路（全部在 `workers/edge` 内）：intake + AgentSession DO（alarm 内跑回合）+ pi + mimo + 4 个 catalog 工具 + 连接在时的 SSE + `GET …/messages` 加 run 状态 + 配额结算 | staging 匿名可完整对话；切走再回来拉到完整结果（手动验证，无自动 eval） |
| W2 | parity：web 工具×2、route 工具、BYOK、上下文与记忆（fact_ledger 适配；按 §九 = 跨轮结构化重放 + 写入时冻结的工具返回摘要 + 阈值批量压缩 + `<agent_status>` 状态栏，**不是**每轮滑动窗口再压缩） | 功能对等清单逐项勾（手动验证）+ 同一 session 两轮的系统提示词字节相同 |
| W3 | eval 搬到 TS：框架用 `logfire/evals`（与 pydantic-evals 同数据模型与文件格式，`run_agent_eval.py:133` 的 `Dataset.to_file` 导出 → TS `Dataset.fromFile` 读取；"零迁移"的前提：导出文件里序列化的 8 个评估器名必须以 TS 实现通过 `customEvaluators` 注册、runner 在 Node/Bun/Deno 跑（Workers 内无文件 helper）、两侧包版本钉死；W3 第一张卡 = Python 导出 → TS 导入的 round-trip fixture，跑通前不得声称零迁移）；task = 对 staging 的 HTTP 调用；自写 8 个评估器（4 个官方 agentic：ToolCorrectness / TrajectoryMatch / ArgumentCorrectness / MaxToolCalls，TS 版无内置，轨迹从转录取；4 个自定义照抄 `evaluators.py:162-215`）+ 移植 `gate.py` 的分层配对 bootstrap 统计门 + ANY-of-N + 662 case 双跑；**评估装置按 §十**：staging-only 环境初始化（先建机制 + 5 个 `seeded_pending` 用例；把 76 个用例改造成轨迹前缀任务需 owner 确认并同批重做 Python 基线）、取回面发布已结算参数让 `argument_correctness` 恢复两见证人比较，二者在双跑前；终局答复验证器与失败归因 report-only，在双跑后 | 双跑无回归（8/29 note 硬条件 3）；#1380 / #1381 在双跑前合入 |
| W4 | 删除 `apps/agent` + uv CI 臂 + 容器构建 + `[[containers]]`/`RuntimeContainer`/#1239 等待逻辑；CD/文档里的 `root` 旧名统一为 edge；空壳 jobs Worker 处置（DONE，#1316）；docs/AGENTS.md/coverage floors 更新；launch 链（#1181/#1183/#1184）接上新架构 | repo 无 Python agent 残留 |

## 六、验收标准

- [ ] **(unit)** DO 状态机：alarm 回收 stuck run、配额回冲 exactly-once、admission 拒绝、dedupe 重放幂等。
- [ ] **(integration)** staging 全链：POST → DO → Neon → GET 取回，run 状态机 running/succeeded/failed 各可达。
- [ ] **(browser)** staging 实测断线续跑：回合中切走 → 回来 GET 拿到完整结果（owner 的核心场景）。
- [ ] **(security)** BYOK/egress 红线全绿（S5 清单逐项）+ 无 Supabase-auth/下游自验证引入。
- [ ] **(eval)** 662 case × 8 evaluator（4 官方 agentic + 4 自定义，与 §五 W3 同一清单）+ 统计门按现行阈值无回归；model-backed，非 faux provider。
- [ ] **(unit)** bundler 产物 smoke 执行门在 CI 常驻。
- [ ] **(api)** 生产行为契约：edge 转发的受信身份 = 唯一身份来源；契约包 zod surface 未破坏。
- [ ] W4 后：`make check` 无 uv 臂；CD 无 agent 容器构建；全仓 `pnpm` 单流水线。

## 七、风险登记

- pi 0.x 破坏性变更 ~2–4 周一次 → 钉版本 + 每周跟进列入 ops 日历；升级窗口固定。
- DO 按 wall-clock 计费（含 LLM 等待）→ W1 出实测账单数字再评估，超预期则把 fanout 拆回普通 Worker + SSE 中继。
- eval 搬迁成本降为 M（`logfire/evals` 与 pydantic-evals 同数据模型与文件格式，框架与数据集零成本）；剩余成本 = 8 个评估器 + `gate.py` 统计门的移植，照抄不重发明。
- 上游 `AgentHarness` 未来落地 → 我们的 DO/Neon 编排以 core Agent 为界，保持可平移。
- **2026-09-01 14:33 staging 的一次 D5（前端 110s 看门狗超时）不在容器层**：容器当时已休眠、Logfire 无 POST 记录，请求在到达 DO 之前就挂在 edge 侧（候选：Turnstile siteverify / `RATE_LIMITER` DO fail-closed / 身份流程）。重写不解决它，不得计入重写收益；需 edge 侧 Workers Logs 定位（现有 API token 无 observability 权限）。
- W1/W2 无自动 eval（owner 接受）→ 这段时间的回归只能靠 staging 手动发现；W3 双跑是 Python 退役的硬前置，不可再往后挪。
- eval 只对真实环境测 → 依赖 staging 可用且 CD 队列畅通；#1204 的 prod 审批门阻塞问题在 W3 前必须修，否则每次合并都要手动拒一次才能跑 eval。

## 附录 A · W0-S1 实测（2026-09-02，#1244 / PR #1260）

真部署 Worker `animichi-spike-pi`（`workers.dev`，无正式路由；测完即删）。脚本 `scripts/spike/pi-s1-measure.sh all`，
13:29–13:31Z：

| case | label | ms | status | detail |
| --- | --- | --- | --- | --- |
| cold | cold wake-up (GET /healthz) | 477 | 200 | 部署后首个请求，无前置流量 |
| warm | warm wake-up (GET /healthz) | 803 | 200 | idle=0 |
| turn-mimo | round trip via mimo（直连 `MIMO_API_KEY`） | 51957 | 200 | clean=yes |
| turn-anthropic | round trip via anthropic | 477 | 503 | 未提供 `ANTHROPIC_API_KEY`，**未测**（非 workerd 故障） |
| turn-gemini | round trip via gemini | 3484 | 200 | clean=yes |
| abort-provider_stream | abort at provider_stream | 9621 | 200 | aborted=yes clean=yes |
| abort-tool_call | abort at tool_call | 26141 | 200 | aborted=yes clean=yes |
| abort-final_frame | abort at final_frame | 34992 | 200 | aborted=yes clean=yes |

结论：
- **唤醒延迟 <1s**（477/803ms），对比 Python 容器睡醒 28–32s、部署后 74s——重写的核心收益成立。
- mimo-v2.5 直连一次回合 **52s**，是模型侧响应时长而非平台开销（同一 Worker 上 Gemini 3.5s）；S2（#1245）定方言时必须把这个数字当基线，若 zen 网关路由显著更快应改路由。
- 三处 abort 均无残留状态，S1 的 abort 验收通过。
- Anthropic 在 workerd 上的往返**仍未证实**（本地无 key）；拿到 key 后跑 `scripts/spike/pi-s1-measure.sh turn --provider anthropic` 补一行即可，不阻塞 S2/S4/S5。
- 已知未覆盖：`enable_request_signal` 开/关对照（8/29 报告 S1 清单项）被 Q1"回合独立于连接"的决定取代，未做。

## 附录 B · W0-S2 实测（2026-09-02，#1245 / PR #1266）

同一 spike Worker，`scripts/spike/pi-s2-compat.sh --route direct`，17:14–17:17Z，19 轮（默认 + 9 个开关各两值），每轮一次
`lookup_spot` 工具往返。zen 路由无 `ZEN_GO_API_KEY`，记为 skipped。

| route | switch | value | tool round trip | streaming usage | wall ms | first token ms |
| --- | --- | --- | --- | --- | --- | --- |
| direct | (defaults) | auto | yes | yes | 6320 | 2288 |
| direct | supportsStore | true / false | yes / yes | yes / yes | 5671 / 7185 | 1586 / 2981 |
| direct | supportsDeveloperRole | true / false | yes / yes | yes / yes | 6908 / 7595 | 1085 / 1901 |
| direct | supportsReasoningEffort | true / false | yes / yes | yes / yes | 11179 / 5611 | 3325 / 1873 |
| direct | supportsUsageInStreaming | true / false | yes / yes | yes / yes | 5777 / 5444 | 711 / 1100 |
| direct | supportsFinishReason | true / false | yes / yes | yes / yes | 8875 / 6702 | 1912 / 1129 |
| direct | supportsStrictMode | true / false | yes / yes | yes / yes | 10795 / 6534 | 1308 / 1281 |
| direct | requiresToolResultName | true / false | yes / yes | yes / yes | 5952 / 11817 | 1358 / 3436 |
| direct | requiresAssistantAfterToolResult | true / false | yes / yes | yes / yes | 4015 / 7534 | 774 / 1788 |
| direct | maxTokensField | max_tokens / max_completion_tokens | yes / yes | yes / yes | 5232 / 28667 | 966 / 2298 |

结论（S2 定版）：
- **mimo 直连不需要任何 compat 覆盖**：pi-ai 的 `detectCompat()` 不认识 `api.xiaomimimo.com`，按 `api.openai.com` 的默认集处理，19 个取值全部完成工具往返且带流式 usage。W1 的 mimo Model 保持"无 `compat`"即可；`maxTokensField` 两种字段名都被接受，沿用默认 `max_completion_tokens`。
- 单轮 wall **4–12s，中位数约 6.5s**，唯一离群值 28.7s（`max_completion_tokens` 那轮）。附录 A 记录的 52s 未复现，按偶发慢响应处理，不作基线。
- zen 路由（`opencode.ai/zen/go`）落在 pi 的 `isNonStandard` 默认集，与直连不同；拿到 `ZEN_GO_API_KEY` 后跑 `--route zen` 补齐即可，不阻塞 W1（W1 用直连）。

## 附录 C · W0-S4 实测（2026-09-02，#1247 / PR #1268）

真部署 spike Worker 的第二个 DO class（`DurableTurnSession`，alarm 内跑回合，`RunStore` 直写 staging Neon 的
`runs` / `run_steps` / `messages`；staging 迁移由 CD 33639988005 落地）。`scripts/spike/pi-s4-durable.sh all`，
17:31–18:03Z，测完即删 Worker。

| case | label | status | detail |
| --- | --- | --- | --- |
| concurrent-turn | 同 session 第二个回合 | 409 | `runs_one_running_per_session` 直接拒绝，无读-改-写竞态 |
| crash-replay | 工具返回后、步骤行写入前崩溃 | succeeded | steps=3，工具真实执行 **4** 次（= 3 + 崩溃那步重跑 1 次），重放不重复执行已落库步骤 |
| long-turn | 5 分钟、3 次工具调用，客户端 5 秒后挂断 | succeeded | steps=3 tools=3，转录完整；DO 计费 wall-clock **100.9s**（脚本侧 1010s 含轮询等待） |

结论：
- **§四 S4 硬条件通过**：回合在 alarm 内独立于客户端连接跑完并落库；admission 由数据库唯一索引承担；
  `(run_id, step_index)` 先落库再继续的幂等契约在真环境成立（崩溃分支精确一次）。
- **§七 计费实数**：一次 3 工具的长回合 DO 活跃 wall-clock ≈ 101s（工具 hold 之和）；按 Paid 计划 400,000 GB-s/月免费额度与
  basic 实例，日常回合（附录 B 中位数 6.5s）远在免费额内，账单风险登记可降级为"W1 上线后按实际用量复核"。
- **给 W1-3（#1252）的硬要求**：spike 的长回合是脚本驱动的；真模型下要让重放落在同一 `step_index`，assistant 的
  tool-call 消息必须与 `run_steps` 一起持久化并从转录重放——这是 W1-3 的实现条件，不是优化项。
- 未覆盖：DO 驱逐后由**新实例**接手的路径只在单元层（fresh host over same storage）证明，真部署未刻意触发驱逐。

## 附录 D · W0-S5 实测（2026-09-03，#1248 / PR #1271）

真部署 spike Worker，`scripts/spike/pi-s5-egress.sh`，02:57–02:58Z，无任何 secret（key 为故意的假值）。策略模块是
生产代码 `workers/edge/src/agent/egress/`（W2 BYOK 卡直接复用）。

| 红线 | 用例 | 结果 |
| --- | --- | --- |
| provider allowlist | openai / anthropic / google 三个精确 host | allow → 真实到达供应商，假 key 得 401/400，**错误文本不含 key** |
| 非 allowlist / 未知 provider / 错误家族 | 3 条 | deny（`host_not_allowlisted` / `unknown_provider`） |
| HTTPS + 443 | `http://`、`:8080` | deny（`scheme_not_https` / `port_not_443`） |
| metadata | `169.254.169.254`、`metadata.google.internal`、IPv4-mapped IPv6 | deny（`metadata_address`） |
| private / loopback / link-local / CGNAT | v4 + v6（含 ULA、`[::1]`、`100.64.0.1`） | deny，各自原因 |
| own infra | `*.workers.dev`、`catalog.internal` | deny（`own_infrastructure`） |
| userinfo 伪装、DNS 指向 loopback 的公共域名 | `localtest.me`、`*.nip.io` | deny |
| 空 key、无 server-key 回退 | — | deny（`empty_key`），从未发出请求 |
| 302 重验 | 指向 metadata / 非 allowlist / 明文 | 第 1 跳即 deny；控制组（合法 302）被跟随 |
| 平台层（无策略直连） | 9 个私网/元数据目标 | Hosted Workers 出站代理自身返回 403（`metadata.google.internal` 530） |

结论：
- **条件 6 的应用层红线全绿**，且平台层对私网/元数据目标有独立的 403——两层防御都实证。
- 仍 **[U]**：DNS 混合 A 记录、验证→连接之间的重绑定，需要自控的 nameserver 才能测；不阻塞 W1（BYOK 在 W2）。
- pi-ai 的 `google-generative-ai` 拒绝注入 fetch（`dist/api/google-generative-ai.js:33`）：W2 的 Google BYOK 走其 OpenAI 兼容面。
- httpbingo 不能发跨域 302，恶意跳转用隔离内 302 源模拟；真实网络只验证了"合法 302 被跟随"这一条。

## 八、留给后续复杂 spec 的 open items

DO 计费实数与并发模型（S4 出数）；typebox↔zod 桥的落点代码；`runs`/Drizzle schema 细节与 migration；`GET …/messages` 的 run 状态字段形状（web 端只多读一个字段）；launch 链（#1181/#1183/#1184）接线顺序；CI lane（coverage floors 迁移、nightly eval 工作流改造为对 staging 的 HTTP 跑）；edge 侧 D5 挂死的定位路径（Workers Logs 权限）。

## 九、上下文与状态栏（owner 2026-09-05，依李博杰第 2 章）

裁决入口 #1297（W2 跨轮工具返回重放 vs 每轮压缩窗口）。参考书为《深入理解 AI Agent》第 2 章，下文按其小节标题引用。本节改的是**上下文粒度**；§三 的**落库粒度**（工具步骤 + 文本段聚合）不变，`messages` / `run_steps` 仍然只追加、不重写。

三条动作合起来的目标是一个可被机器检验的性质：**同一 session 的两轮之间，系统提示词与工具定义逐字节相同，变化的部分全部追加在转录末尾**——即书中「KV Cache 友好的上下文设计」开头三条核心结论的第 1、2 条。收益是跨请求的 Prompt Cache 命中（书「KV Cache 与 Prompt Cache：两个层级的缓存」：缓存读取约为首次计算的十分之一），而不是单次请求内的 KV Cache。

### 9.1 转录重放每一轮的工具调用与结果 → #1377

今天 `workers/edge/src/agent/session/turn-transcript.ts:17-18` 明说：早先一轮的 tool-call 行「degrades to its plain text」，实现在同文件 `messagesForRow` 的 `turn-transcript.ts:115`。这正是书中实验 2-3（「KV Cache 的原理与约束」）点名的两个反模式叠加：**滑动窗口对话历史**（工具结果滑出窗口后 Agent「忘记已获得的结果」，反复重复同一次调用）与**文本格式化方法**（把结构化 role-content 消息压成纯文本流，模型要额外花注意力推断角色边界，表现为「忽略工具调用结果、重复执行已完成的操作」）。

**定案**：转录重放每一轮的 assistant tool-call 消息及其工具结果，作为**结构化消息**（`assistant` + `toolResult`），不再降级为文本。

- 早先各 run 的 `run_steps` 一并载入（今天只载入本 run 的，`turn-transcript.ts:100-104` / `turn-store.ts:75-81`）。
- **崩溃恢复的按 run 配对不变**：`turn-transcript.ts:51-56` 的 `toolCallEnvelopeOf` 用 `messages.response_data` 里的 `run_id` + `step_index` 显式配对，早先 run 的行按各自的 run 配对，本 run 的行仍只与本 alarm 载入的本 run steps 配对；尾部截断分支（`turn-transcript.ts:22-28`）只对**当前 run** 生效，`settledSteps`（`turn-transcript.ts:140-142`）只数本 run 的结果，否则 `StepSequence`（`turn-step-sequence.ts:21-36`）会从错误的序号起步。
- 早先一轮的结果以其**冻结摘要**（9.2）而非原文重放，所以「更大的上下文」是有界的。

### 9.2 工具返回摘要在写入时定稿并冻结 → #1378

书「缓存作为架构约束」：「工具结果的替换字符串在首次出现时就被冻结……即使后续会话重启，系统也会使用完全相同的替换字符串——以保证恢复后的消息序列与缓存中的字节流一致」；「生产级的分层压缩机制」第 1 层「工具结果预算控制」同义。

今天相反：`context-compaction.ts:11-12` 自述「the raw history is replayed and re-compacted on every alarm」，且 `context-compaction.ts:188-190` 明说 pi 每次模型请求都调一次 `transformContext`，于是 `KEEP_RECENT_MESSAGES = 8`（`context-compaction.ts:52`）这个「最新 8 条」窗口在**一轮之内**就随消息增长而滑动：同一条工具结果在第 1 次请求里是原文、第 3 次请求里变成摘要，前缀字节因此每次请求都变。函数本身是纯的（`context-compaction.ts:167-182`），但它产出的**上下文不是字节稳定的**。

**定案**：

1. 摘要在**写入时**决定一次：一个工具结果落 `run_steps` 时，若其文本长度超过 `TOOL_RETURN_MAX_CHARS`（`context-compaction.ts:55`，200 字符），同时持久化它的确定性摘要，与该 step / message 一起写。此后任何 alarm、任何模型请求都读同一个字符串——跨 alarm 字节稳定。
2. **确定性 summariser 保留**：`tool-return-summary.ts:81-85`（含 `tool-return-summary.ts:31-35` 逐字保留 `ordered_candidates` 的分支）不变。理由与书「压缩策略的设计原则」的「语义完整性」一致，也与 `tool-return-summary.ts:6-13` 已写下的理由一致：序数追问（「第二个」）只能对着逐字保留的候选 id 解析。
3. **删除「最新 8 条」的每轮/每请求再压缩**：`KEEP_RECENT_MESSAGES` 及基于它的 `compactToolReturns` cutoff（`context-compaction.ts:177-180`）退役。当前 run 的结果本来就是新写入的，按 (1) 已在写入时定稿。
4. **阈值批量压缩**作为唯一的动态压缩路径，且默认不触发。常量 `CONTEXT_COMPACTION_TRIGGER_TOKENS = 102_400`（= 128k 窗口的 80%），取自书「压缩与 KV Cache：看似矛盾，实则互补」的「最好在上下文接近阈值时批量压缩，而不是每轮都压」与实验 2-10 策略六的阈值触发 + 批量压缩 + 防重复标记三机制。**按现有量级它不会触发**：`context-compaction.ts:26` 记录的实测是本层构建的 3 轮转录 `estimateContextTokens = {tokens:870}`，离 102,400 差两个数量级。它存在是为了给「某个 session 真的逼近窗口」留一条不撞窗的出路，不是日常路径。
5. 实体救援（`context-compaction.ts:119-133` → `retained-entity-ledger.ts`）跟着写入时机走：摘要定稿的那一刻救援一次。`retained-entity-ledger.ts:20-25` 现有的「dedup 是因为每轮重新压缩同一段历史」的自述前提随之失效，dedup 保留但理由改为 alarm 重试的幂等。

### 9.3 `SessionEnvelope` 渲染为 `<agent_status>` 用户消息 → #1379

今天 `turn-instructions.ts:157-161` 的 `turnSystemPrompt(envelope)` 把 `trustedLines`（`turn-instructions.ts:147-153`）拼进系统提示词，`turn-envelope.ts:116` 每轮重算一次。书实验 2-3 的第一条就是**动态系统提示词**：「正确的做法是把时间信息作为用户消息追加到对话末尾」。书「Agent 状态栏在上下文中的具体位置」写得更死：状态栏「实际上是作为**一条 user 角色的消息**插入到上下文末尾的——而不是修改开头的 system 消息。原因正是前面讨论的 KV Cache 约束」。

**定案**：`SessionEnvelope` 的内容改为一条 `role: "user"`、内容以 `<agent_status>` 标签包裹的消息，追加在转录**末尾**（在本轮用户消息之后），每轮**替换**上一条——书「状态更新的两种实现与缓存代价」的**实现一：每轮替换**。选实现一而非实现二（Claude Code 的 `<system-reminder>` 持久追加）的依据是书给的分界：状态较大、每轮都更新时选实现一；且本层转录每次 alarm 从 Neon 重建，状态消息不落 `messages`，实现二会让陈旧状态在上下文里累积却拿不到「只追加」的缓存好处。失效范围只覆盖末尾一轮新增的后缀，整个前缀仍可复用。

状态栏内容（书「Agent 状态栏的构成」的「环境当前状态的观察摘要」一类，逐项对应今天已有的字段）：

| 行 | 来源 | 今天在哪 |
|---|---|---|
| 当前 anime（title + bangumi id，已解析，勿重解析） | `SessionEnvelope.currentAnime`（`session-envelope.ts:79`） | `turn-instructions.ts:104-106` |
| 未决澄清：reason + 有序 `candidate_ids` | `PendingClarification`（`session-envelope.ts:50-54`） | `turn-instructions.ts:109-112` |
| 生效中的用户硬约束（pacing） | `FactLedger.activeHardConstraint()`（`fact-ledger.ts:143`） | `turn-instructions.ts:119-125` |
| 场景引用（用户显式选中的点位） | `FactLedger.activeSceneReferences()`（`fact-ledger.ts:148`） | `turn-instructions.ts:127-129` |
| 压缩救回的逐字实体 | `RetainedEntityLedger.entities`（`retained-entity-ledger.ts:71`） | `turn-instructions.ts:139-144` |
| 本轮各工具的调用次数（成本低才做） | 本 run 的 step 序列（`turn-step-sequence.ts:21-36`） | 不存在，本卡新增 |

约束：

- **只由代码维护**。书状态栏一节的第 1 条注意事项：「状态栏尽量用代码维护……绝不要让它一次性批量统计」，因为「模型几乎无条件地相信状态栏」。本层本来就没有模型抽取环节（`fact-ledger.ts:8-10`：事实来自本轮已落库的 step，不是模型说的），这条继续成立；不得为状态栏引入任何 LLM 汇总。
- **投毒防线不变**：值仍经 `trusted-text.ts` 清洗并按 `turn-instructions.ts:138-143` 的 `「」` 包裹，因为状态栏这条消息虽然挂在 user 槽位，内容全由服务端生成（书同节：「Harness 是在借用 user 角色这个消息槽位」）。
- 澄清的 `id` 仍**不**进状态栏，理由照旧（`turn-instructions.ts:96-100`：那是给客户端和服务端校验器的，不是给模型的）。
- **不删原始上下文**。书同节第 2 条注意事项：状态栏是有损投影，只算了预想会被问到的维度。9.1 的结构化重放是原始记录，状态栏是它之上的加法。

### 9.4 系统提示词里留下什么

`turnSystemPrompt` 去掉 `## Trusted runtime context` 之后，系统提示词 = 一个**常量**，只随模型/工具集变化：

- 静态指令：`TURN_SYSTEM_PROMPT`（`turn-instructions.ts:37-52`，身份、语言、web 工具政策）。
- 输出词汇：`## Answering` 与 `## Compact output`（`turn-instructions.ts:54-67`）——`respond` 工具的 `kind` 词表，是 Python 五个响应模型的移植（`turn-instructions.ts:16-22`）。
- **SD-19 未受信工具输出不变量**：`turn-instructions.ts:69-80`。它是架构级安全要求，不是提示调优（`turn-instructions.ts:24-27`），任何情况下不得移出系统提示词。

由此得到本节的验收锚点：**同一 session 连续两轮，系统提示词字符串逐字节相同**。这条是可测的，也是 9.3 的变异判据。

### 9.5 卡片

| 卡 | 内容 | blocked by |
|---|---|---|
| #1377 | 转录结构化重放（9.1） | — |
| #1378 | 摘要写入时冻结 + 删除滑动再压缩（9.2） | #1377 |
| #1379 | `<agent_status>` 状态栏 + 系统提示词字节稳定（9.3 / 9.4） | #1377 |

## 十、评估（owner 2026-09-05，依李博杰第 7 章）

裁决入口 #1309（111 处 in-process 会话种子没有 wire 形态）与 #1311（`argument_correctness` 在线上只有一个见证人）。参考书为《深入理解 AI Agent》第 7 章，下文按其小节标题引用。§五 W3 的出口判据（662 例双跑无回归）不变；本节改的是**评估装置**本身 —— 用例怎么回到同一起点、由谁核实、失败之后说得出为什么。

书「一条评估任务的解剖」把一个可重复运行的评估环境拆成五个要素：数据集、环境状态、工具接口、评分标准、执行协议。本仓今天有其中三个 —— 数据集是导出的六个集合（`packages/eval/src/dataset-sets.ts:15-22`），工具接口是 edge 的六个模型工具，执行协议是 `StagingTurnTask`（`packages/eval/src/staging-turn-task.ts:105-126`）。缺的是**环境状态可重置**（10.1）与**评分标准里的独立核实**（10.2 / 10.3），失败之后的可读性（10.4）则是书「失败归因」要求的第四件事。

### 10.1 环境初始化与轨迹前缀用例 → #1380

**先更正两处口径，两处都由代码证伪，owner 需据此确认范围（见本节末的待确认项）。**

**其一，"111 个用例"是种子字段数，不是用例数。** `agent_eval_v3` 的 `context.last_search_data` 65 处、`context.last_location` 42 处，落在 **72** 个用例上（35 个两者都有）；`agent_eval_heldout_v1` 另有 4 处 `last_search_data`。合计 **111 处种子、76 个用例**，其余四集为零。另有 5 个用例带 `inputs.seeded_pending`。

**其二，这 111 处种子在 Python 基线里本来就不生效。** `_seed_tool_state`（`apps/agent/src/animichi/agents/animichi_runner.py:168-181`）只认 `last_location`、`origin_lat/lng`、`session_state_v2`、`current_bangumi_id`/`current_anime_title` 五类，并为 hydrate 出来的 ref 做 `reserve`；**`last_search_data` 根本没有分支**，而且有一条单测把这件事钉死：`test_seed_tool_state_does_not_restore_historical_payload_bags`（`apps/agent/src/animichi/tests/unit/test_animichi_runner.py:95-105`）断言喂进 `last_search_data` 后 `session == SessionState()`。`last_location` 虽被赋值，但 `apps/agent/src` 里除了 `tool_state.py:17` 的字段声明与那三行赋值**没有任何读者**。六个集合的 `context` 键实测只有 `last_search_data` / `last_location` / `origin_lat` / `origin_lng` / `message_history` 五种 —— **没有 `session_state_v2`，也没有 `current_bangumi_id`**。而 `origin_lat/lng` 早就走 wire（`packages/eval/src/case-submissions.ts:61-66`），`message_history` 走重放。

结论：#1309 的问题陈述"TS 复现不了 Python 的种子"是**反的** —— Python 也没有复现它们。真正的缺口只有一处，而且是 5 个用例：`seeded_pending`。它们在 Python 里走的是**另一条任务路径** `selection_task`（`apps/agent/src/animichi/tests/eval/agent_eval_task.py`，#1493 从 `eval_harness.py` 拆出），在进程内直接构造带 `pending_clarification` 的 `SessionState`；HTTP 这一侧，一次选择回合要能校验，session 的 envelope 里必须真的有那个未决澄清（`workers/edge/src/agent/session/session-envelope.ts:50-54`）。而且评估器**已经在按种子存在的前提打分**：`packages/eval/src/evaluators/accepted-chains.ts:113-115` 给 `seeded_pending.reason === "place_ambiguity"` 的用例判最小步数 1。

**定案（#1309 选项 b，塑形为环境初始化而非模型可见的头部）**：建一个 **staging-only 的初始化过程**，把冻结前缀 —— 先前的 user 轮、工具调用、工具返回、session envelope —— 经**产品自己的 store 代码**写进目标 session。依据是书「评估环境 · 五个组成要素」对环境状态的两条要求（「真实性要求状态变化符合业务逻辑，可控性要求每次运行前都能回到同一起点」）以及 τ²-bench 用 `initialization_actions` **调用产品自己的函数**建立初始状态；书「端到端回归任务与轨迹前缀回归任务」把这类用例定义为「把已有的上下文、对话、工具返回和环境状态冻结下来，只要求 Agent 执行下一步」，并称「对于需要高可靠性的生产级 Agent，构建轨迹前缀回归任务集往往比端到端回归任务集更重要」。

**范围（#1380 只做第一档，第二档等 owner 一句话）**：

- **第一档（本卡）**：机制本体 + 5 个 `seeded_pending` 用例。它们今天在 TS 侧是拿"从未建立起来的起点"计分，补上就是纯修复，不动任何基线口径。
- **第二档（owner 2026-09-06 定 A：暂不做，不在本卡）**：把那 76 个用例真的改造成轨迹前缀任务。它有独立价值（书的论证成立），但**必须同时重做 Python 基线** —— 现行基线是在这些种子不生效的条件下跑出来的，只给 TS 侧加上起点会让双跑比的不是同一件事，正好踩中「配对的含义是让两组共享任务与随机条件」。同时要决定第 76 组用例的可接受动作集合与 `accepted-chains.ts:29-45` 的期望链是否随之改写。
- **第三档（数据集债，另开卡）**：69 处 `last_search_data` + 42 处 `last_location` 是两侧都不读的死字段，留着只会让下一位读者重犯同一个判断。

约束（每条都来自已核实的代码）：

- **必须在该 session 的 DO 内执行。** envelope 不在 Neon 列里，而在 Durable Object 自己的存储中，键为 `"envelope"`（`durable-envelope-store.ts:4-17,44`），且 §三 让 session 的 DO 做唯一写者。转录与 `run_steps` 经 `NeonTurnStore`（`neon-turn-store.ts:105-121,179-209`），envelope 经 `DurableEnvelopeStore`；不得另写一份 SQL。
- **前缀 run 必须写成终态。** `runs_one_running_per_session` 是唯一索引（`neon-turn-records.ts:35-36`），留在 `running` 的前缀 run 会让被测回合被 409 拒绝。`result` 与 `finished_at` 同在（`run_steps_settled_check`，`migrations/neon/20260902000000_agent_runs.sql:106`），工具返回的 `minted` 与结果同写（`turn-store.ts:45-55`）。
- **生产上不存在，且鉴权不止于挂载开关。** 挂载判据 `APP_ENV === "staging"`（`workers/edge/wrangler.toml:100,265,457`），fail closed。但 `APP_ENV` 只是挂载开关，**不是授权**：staging 今天的周界是 WAF + `x-staging-key`（`infra/src/staging.ts:5-20` 写明"Why WAF and not Cloudflare Access"），Cloudflare Access 与 service token 要等 #1369（其 N4 还未验证）。因此 —— **这条会改状态的路径在 #1369 关闭前不得部署**；处理器本身还要校验调用者对目标 session 的**归属**，与取回面同一条判据（`conversation-retrieval.ts:79-82`），不得只靠周界。
- **harness 侧的调用点是 `CaseLifecycle.setup()`**：`logfire@0.22.5` 的 `CaseLifecycle` 声明 `setup()`（任务之前）、`prepareContext()`（任务之后、评估器之前）、`teardown()`（`node_modules/logfire/dist/index-Dd6NCwQg.d.ts:241-253`），经 `Dataset.evaluate({ lifecycle })` 传**类**而非实例。评估器一个都不改。

**留给 owner 的两处（本卡不得自行拍板）**：(1) 上面的第二档做不做、做则同批重做 Python 基线；(2) `minted-refs.ts:1-9` 写明 ref 的寿命只到本 run 结束，前缀 run 铸的 ref 在被测回合里是 `stale_ref` —— 要么接受（可接受动作集合里不含"引用上一轮的 ref"），要么让 session 的 ref 注册表从先前各 run 的 `run_steps.result.minted` 复活，而后者是**改产品行为**，需单开卡。

**与 §九 的关系**：前缀的工具返回要以结构化消息进入被测回合的上下文，靠的是 #1377（9.1）—— 今天 `turn-transcript.ts:106-117` 的 `messagesForRow` 只为**本 run** 配对 tool-call 信封。W2 在 W3 之前，顺序不冲突；本卡不改转录构建。

### 10.2 第二见证 → #1381

书「验证器」一节的判据：「评估框架必须核实机器可独立复核的事实，而非 Agent 的自我陈述」。模型原样吐出的参数是自我陈述，工具**真正执行时**用的参数是环境的记录。Python 的 `OfficialArgumentCorrectness` 比的就是这两者；TS 侧今天只有前者，于是每个已结算调用都与自己相等，指标恒为 `1.0`（`official-argument-correctness.ts:14-32` 已把这件事写在头注，实现是常量桩 `official-argument-correctness.ts:47-54`）。Python 基线 0.9959 —— 1.0 不是"更好"，是没测。

**两个见证人在本仓确实可能不同（已核实）**：SSE 帧发的是 `event.args = toolCall.arguments`，即从模型流解析出的原始参数（`turn-frames.ts:73-79`）；`run_steps.input` 记的是 pi 交给 `execute` 的 `prepared.args`（`turn-step.ts:157-162` 的 `asJsonValue(call[1])`），而 `prepared.args = validateToolArguments(...)` 会 `structuredClone` 一份、删掉可选 `null`、跑 `Value.Convert` 与 JSON-Schema 强转（`node_modules/@earendil-works/pi-ai/dist/utils/validation.js`）。`"3"` 变 `3`、可选 `null` 被删，都会让两者分歧 —— 正是 Python 那条指标抓的东西。

**定案（#1311 选项 b）**：从 `run_steps` 把**已结算参数**发布到取回面 `GET /v1/conversations/{id}/messages`，`TranscriptStep`（`packages/eval/src/turn-transcript.ts:71-75`）增 `params`，评估器按 Python 比 `args` vs `params`。**直播流不动**。

- **契约非目标在此处明确修订**：§一 Non-goals 的"不改 `packages/contract` 的 zod 契约"自 W1-5 起就已有一次**可加**例外（`GetSessionHistoryResponse` 加 `run`，`packages/contract/src/agent-contract.ts:246-262`）。本节把口径写死：**取回面 payload 只允许可加式增补**（nullable/optional，旧 payload 仍要 parse），**SD-9 帧 surface 与其余 zod 契约一行不动**。（SD-9 帧 surface 这一半在 10.2.1 让出一个同款的可加式例外，#1462。）
- **两个见证人今天不在同一条路径上**：SSE 是尽力而为的直播（§三 交接契约、`turn-frames.ts:29-30`），断线即无；取回面今天只发布 `intent`/`success`，会把持久化的 tool-call 信封剥掉（`workers/edge/src/agent/retrieval/transcript-message.ts:53-67`）。对**评估**够用 —— 任务始终握着流并与转录一起成型（`staging-turn-task.ts:119-126`）；对**断线后的复核**不够。是否把 raw 参数也一并持久发布（一个同时带 raw / settled / status / step 身份的取回形状），是一处比裁决更大的接缝，**留给 owner**；本卡按裁决只发 settled 参数。
- 授权面不放宽：`run_steps` 不授权给 `readonly` 角色，因为「a tool's input and result carry the visitor's own query text」（`migrations/neon/20260902000000_agent_runs.sql:10-12`）。发布对象是该 session 的 owner 本人（`conversation-retrieval.ts:79-82`），数据库授权一行不改。

### 10.2.1 服务端发起的步骤不参与 `argument_correctness` → #1462

10.2 让这条指标有了第二见证人；这一节决定**哪些调用值得比**。

`serverStepOpened`（`workers/edge/src/agent/session/turn-frames.ts`）为确定性绕过开步——`plan_selected`、`plan_multi`、地点选择那次半径 `search_nearby`（`selection/turn-selection.ts:105,119,133`）——`input` 是 `{}`，因为**没有模型参数可填**；结算下来的 `run_steps.input` 带的却是访客真正的请求（`{"candidate_ids": […]}` / `{"point_ids", "origin"}`）。两个见证人于是**按构造永不相等**，每一个成功的绕过回合 `argument_correctness` 都读 0.0：`D3_multi_success_two`、`D3_multi_partial_success`、`D3_place_selection_radius`、`K1_ja_001`、`K1_en_002`（#1454 结算时发现）。

Python 从来不给这些步骤打分——`official_evaluators.py:77-81` 的循环条件是 `item.is_success and item.model_initiated`，而 `selection.py:212`、`selected_route.py:120,168`、`step_recording.py:21` 都把绕过步骤记成 `model_initiated=False`。已提交的 Python 基线就是这条规则的实证：662 例里 15 个 `K1`/`K3` 用例**根本没有 `argument_correctness` 这个键**。

**定案（owner 2026-09-08，选项 1）**：把这件事发到 SD-9 帧上，评估器照 Python 过滤。

- **修订 10.2 的契约口径**：那里写的「SD-9 帧 surface 一行不动」在此处让出一个例外，边界与取回面同款——**只允许可加式增补，且缺省即旧义**。开步帧（`tool-input-start`）多带 `toolMetadata.origin`；`toolMetadata` 是 SD-9 自己为这两类 chunk 定义的自由 `Record<string, JsonValue>`（`ai@7.0.77`，`node_modules/ai/dist/index.js:6554-6590`），不是靠 `z.looseObject` 蒙混过去的顶层字段。**缺省读作 `model`**，所以 #1462 之前录下的每一帧含义不变、读它的每一侧分数不变，`apps/web` 也照旧读过去。
- 声明落在 `packages/contract/src/agent-step-origin.ts`，**零 zod**：edge 要把它打进 bundle（`bundle-smoke/entry-bundle.test.ts`），eval 的转录成型器要读它。边写 `serverStepOrigin()`、评估侧读 `stepOriginOf()`，一处拼写两端共用。
- `TranscriptStep.origin` 随之落地；`OfficialArgumentCorrectness` 与 10.4 失败归因里的 `misArguedSteps`（用的是同一条谓词）都跳过服务端步骤。
- **连带修一处孪生漂移**：`run-metric-names.ts` 原按「取回面是否发布过 `steps`」决定这一列，Python 的孪生（`run_metric_names.py:40`，#1496）按「有没有用例真的打出这个分」决定。本节之后 `phase1c_selection_v1` 五个用例全是绕过、无人打分，旧规则会让 `aggregateScores` 对一次**健康**的跑抛 `Missing metric(s): argument_correctness`。改为读分数，与 Python 一致，也与该文件里 `step_efficiency` 的既有写法一致；`run-judgement.ts` 的先后顺序（#1496/#1510）保留，它挡的是「被饿死的一跑不得参与比较与铸基线」。
- **拒掉的两条**：选项 2（把真实 input 填进开步帧）会让帧宣称一个模型从未产出的 `input`；选项 3（成型时按工具名排除）要维护第二张表，而 `search_nearby` 一名两义，按名字排除会把模型自己发起的那次调用一起丢掉。
- **代价说清楚**：这三个 stage 的 `argument_correctness` 从此是 `{}`（未测量）而不是 0.0。#1303 双跑时这三列少了用例——少的恰是 Python 基线里同样没有的那些用例，所以两侧比的仍是同一批。

### 10.3 最终答复验证器 → #1382

书「"做对了但说错了"问题」给了全部理由：τ²-bench 带信息告知要求的 704 次运行失败 240 次，其中 **80 次（占全部失败的三分之一）环境状态正确、信息告知错误**；「多数评估只检查环境状态」，所以这类失败被整体成功率掩盖。书「失败归因」表里对应行是「对用户的信息反馈错误」，定位方式是「把答复里的每个事实断言与工具返回值逐条对齐，取第一条无法溯源或与工具返回矛盾的断言」。今天本仓八个评估器只看轨迹与 `data` 的键（`packages/eval/src/metric-names.ts:14-26`），**没有一条对答复散文设断言**。

**定案**：新增一个**确定性**验证器（不是 LLM 判官）。散文是自由文本，所以它的**覆盖面必须先被界死** —— 只判以下三类可判定的断言，其余一律记未测量：

1. **作品名**：散文中出现的作品名，须等于某个工具返回里的 `anime_title`（`workers/edge/src/agent/tools/catalog-tool-outcomes.ts` 的 outcome `details`，随 `tool-output-available` 上线）。
2. **计数**：散文中的条数，须与 `row_count` / `data` 行数一致。
3. **地名**：**仅当**本次答复带 `data.results` / `data.itinerary` 时才判（行由 stored payload 投影而来，`turn-answer-part.ts:137-146,199-212`）；纯散文答复的 `data` 是 `{}`（同文件 212 行），没有行可对照，地名一律记未测量而不是记错。

可溯源来源必须**完整列举**，否则它会把对的判成错的：本次 run 的工具返回、本次答复的 `data` 行、**本轮用户自己的输入**、以及 §九 落地后进入上下文的**先前各 run 的结构化工具返回**（9.1 / #1377）与 `<agent_status>` 状态栏（9.3 / #1379）。只认"本次 run"会与 §九 直接冲突。

- eval 侧转录需保留每步已发布的 output，今天 `turn-transcript.ts:71-75` 只留 name/args/status。
- **先 report-only**：新指标在结果文件里单列一列，**不得**进 `metricNames()` —— 那份清单按**位置**与 Python 基线文件和报告表对齐（`metric-names.ts:1-12`），插一列会让整套基线错位，双跑就不再是比较。跑满一轮基线周期后由 owner 决定是否入门。
- 判不了的断言记 `{}`（未测量），既不记 1 也不记 0。真空通过与假阳性是这条验证器自身最容易犯的两个错。

### 10.4 失败归因 → #1383

书「失败归因：从整条轨迹定位首个错误」：端到端评估只给成功/失败，「要让评估结果真正驱动修复，必须对每条失败轨迹进行失败归因：标出主要错误类别、首次出现不可接受行为的步骤、对应的工具调用或模型输出，并附上可复核的证据」；且「归因对象是轨迹中的**首个**导致任务偏离的错误，后续错误往往只是连锁反应」。

**定案**：每个失败用例产出一条结构化记录 —— 首个偏离步骤的下标 + 类别（书中那张表裁剪成一份**封闭**词表）+ 证据引用，主因与后果分开记。**report-only，不参与门禁判决。**

首错定位**规则先筛、不引入 LLM**（书：「规则先筛、LLM 再定位，比把全部轨迹喂给 LLM 更便宜也更准」）：轨迹与用例可接受链的首处分歧（`packages/eval/src/evaluators/accepted-chains.ts`）、第一个 `status === "error"` 的步骤（`turn-transcript.ts:63` 的三态之一）、10.3 给出的第一条无法溯源的断言 —— **取最早的一个**。

**证据的存放位置是硬约束**：提交进仓的结果文件只放**聚合与引用** —— 用例 id、首错下标、类别、工具名、指标 —— 不放原文。理由是这些文件之所以能提交，正因为「Nothing here is a secret: scores, intervals and case counts」（`packages/eval/src/gate-run/result-file.ts:11-13`），而 `run_steps` 连 `readonly` 角色都不授权，因为它带访客自己的查询文本（`migrations/neon/20260902000000_agent_runs.sql:10-12`）；`injection_g1_v1` 的失败用例里更可能带着注入原文。**原文证据落 CI 工件**（有访问控制、有保留期），不进 git。

书里那个 AndroidWorld 案例是这套东西为什么值得做的注脚：32 步没有一步报错、Agent 自行宣告完成，首错落在第 8 步的一句自述上，而根因是 **Harness 的观察通道缺失**而不是模型能力 —— 归错了就会去换模型。

### 10.5 统计门不变（配对分层 bootstrap，固定种子）

不变：`packages/eval/src/gate/paired-bootstrap.ts` 的分层配对 bootstrap（种子 309、2000 次重采样、95% 区间、按行为路径分层），逐字移植自 Python 的 `stats.py`，同种子下与 Python 位相同（同文件 4-14 行）。

**为什么没有框架能替掉它**（2026-09-05 一手文档调研，13 个框架；调研笔记是会话产物，结论逐条列在下面，需要复核的按各家官方文档核）：

- 书「评估结果的统计显著性」要求的是**配对分析** —— 「同一批任务比较两个配置时，应优先做配对分析：逐题记录谁胜出，用 McNemar 检验或配对 bootstrap 判断差异，而不是直接相减两个独立成功率」。W3 双跑正是"同一批任务、两个配置"，所以这条是本仓的判据本身。
- TS 优先的框架里**没有一个**提供配对显著性检验：`logfire/evals` 的 report evaluator 只有 ROC / PR / KS 与 `repeat`；Braintrust 只有 row-level diff；Mastra、promptfoo、Evalite、Langfuse 都没有。唯一有一手证据的具名统计原语是 Inspect AI 的 `bootstrap_stderr` / `ci` / `ci_wilson`，但它是 Python 且是 task/solver/sandbox 形态 —— 采用它意味着把 agent 跑进它的进程模型，而 §二 已定「eval 只对真实环境测」，agent 是 HTTP 后的黑盒。
- 换框架还会丢掉与 Python 基线的**位相同**性质，而"位相同"正是双跑能当作比较的前提。

因此：框架继续用 `logfire/evals`（数据模型与文件格式与 pydantic-evals 同源，662 例零迁移），统计门继续是我们自己的 `paired-bootstrap.ts`。

### 10.6 卡片

| 卡 | 内容 | blocked by |
|---|---|---|
| #1380 | 初始化过程 + harness `CaseLifecycle.setup()`（10.1 第一档：机制 + 5 个 `seeded_pending` 用例） | #1369（部署与 `(api)` 验收；过程本体与 unit/integration 可先落） |
| #1381 | 第二见证：取回面发布已结算 params + 评估器恢复比较（10.2） | — |
| #1382 | 最终答复验证器（10.3） | #1303 |
| #1383 | 失败归因（10.4） | #1303 |
| #1462 | 服务端发起的步骤不参与 `argument_correctness`（10.2.1） | #1381 |

顺序：#1380、#1381 在 W3-5 双跑（#1303）**之前**落地 —— 前者决定 5 个选择用例是否有起点，后者决定 `argument_correctness` 是否是一个真指标，两者都会改变双跑要比的数字；#1382、#1383 在双跑**之后**，它们读的是那一轮跑出来的答复与失败轨迹。

### 10.7 评审记录（spec dual-review，2026-09-05）

- **Seat A（Fable）**：改 4 处失效 file:line 引用；补上"评估器已按种子存在打分"（`accepted-chains.ts:113-115`）；把 10.3 的报告位置写死（结果文件单列，不进 `metricNames()`）。
- **Seat B（Codex `gpt-5.6-sol`，`/codex:adversarial-review`，工作树 diff）**：verdict `needs-attention`，5 条 findings，逐条核实后**全部采纳**：(1) [high] 111 处种子在 Python 基线里不生效（`animichi_runner.py:168-181` + `test_animichi_runner.py:95-105` 证实）→ 10.1 拆成三档、第二档需 owner 确认并重做基线；(2) [high] 10.3 无法对自由散文做完整判定（纯散文答复 `data` 为 `{}`）且"只认本次 run"与 §九 冲突 → 覆盖面界死为三类、来源完整列举；(3) [medium] 契约非目标与新增字段冲突、断线后只剩一个见证人 → 显式修订非目标为"取回面仅可加"，两见证人的持久化留 owner；(4) [medium] staging 今天是 WAF 不是 Access（`infra/src/staging.ts:5-20`）→ 该路径 #1369 关闭前不得部署，且要校验 session 归属；(5) [medium] 原文证据不得进已提交结果文件（`result-file.ts:11-13`）→ 落 CI 工件。
- 复核轮与 owner 签核：**owner 2026-09-06 签核**（10.1 第二档定 A：76 例暂不改造）；Seat B 复核轮由 owner 免除（与 CI/CD spec 同一口径：Codex 席不再作为阻塞）。
