# Spec — CI/CD 重设计（平台功能替代手写流水线）

> Current test/composition amendment: #1563 supersedes the earlier inline-only policy and Ruby
> script locations. Old `test_*_contract.rb` names and pinning-ownership claims below are historical;
> follow `.claude/rules/ci.md`, `docs/ops/deployment.md` and the assertion migration map in
> `docs/iterations/production-readiness-2026-08/WORKFLOW-ASSERTION-MAP.md` for the active structure.

- Status: Approved — owner sign-off 2026-09-05（Fable 四轮评审；Codex 席 owner 免除）
- 修订 3（席 A 三轮评审 + owner 定案后，改动记录见文末）。grilling 已完成，§二 与各卡引用的决策 1–16 都是 owner 2026-09-05 定的；两轮评审提出的修正请求里，owner 已定：并发组加 `queue: max`（§六 第 3 条）、PR 时的 L0 eval lane 随 B1 删（§七 #21）、staging 的门 = Cloudflare Access 罩住 `staging.animichi.com` 与两个 workers.dev URL + ESC 里的 service token（§七 #12）、semgrep 只留六条自定义规则（#5）、edge 运行时密钥直接进 Secrets Store（#17，新卡 D4）、web 的 `RUNTIME_CONFIG` 按环境提交（#18）、三个文档卫生脚本留下（#19）。没有待 owner 的项了；owner 免去席 B（Codex）评审，本修订后直接签核。§七 是最终的待核清单。
- 事实基线：现状图 `docs/iterations/cicd-redesign-2026-09/current-state.html`，文字版是同日的 cicd-map（HEAD `357d0bf24`）。本文的 `file:line` 已对 worktree HEAD `212506fef` 复核：两者之间 `cd.yml`、`pr-verification.yml`、`.github/actions/**` 无改动；`scripts/local-gates/pre-push.sh` 在 `gate_eval` 之后插入了 9 行 `gate_test-postgres`（#1335），其后行号 +9；`.github/ci/components.json` 多了 `test-postgres` 组件。
- 输入审计：tooling 审计 T-01…T-29、architecture 审计 ARCH-02 / ARCH-05 / ARCH-09 / ARCH-10、`docs/specs/2026-09-05-repo-smell-audit.md` §7.2 战役 B（B1–B9，owner 已把它们排进本次重设计）。
- 前置：#1077 的 Pulumi Cloud 迁移已于 2026-09-05 ~06:00Z 由 orchestrator 执行完（commit `8b757fcb5`，分支 `card/1077-pulumi-cloud-oidc`：两个项目的四个 stack 都在 Pulumi Cloud 的 `lifeodyssey/{staging,prod}` 下，两个 staging stack `pulumi preview` 无 passphrase 干净，config 已重加密；R2 里的旧 state 留作回退直到 #1081）。剩下的前置只是 OIDC 探针 run 绿后合 PR #1329 / #1330，本文的卡在其上进行（§五 W-A）。
- 后继：Atlas→Drizzle 的替换发生在 migrator Worker 内部，属之后的 Drizzle spec（owner 2026-09-05：与本 spec 定案后合写）。

## 一、动机

2026-09-05 晚的 grilling 从五个冲突点出发。本文的编号与 owner 当晚的编号对应关系：本文 ① = owner ②，③ = owner ④，④ = owner ③，⑤ ≈ owner ①；② 是评审期间新立的 #1332；owner 的 ⑤（机器人时间戳 vs rebase）是合并 hook 的事，记在 §七 #23。

① **生产审批门占住整条 CD。** `cd.yml:10-12` 把整个 workflow 放进单一 `concurrency.group: affected-cd-main`，`promote-production`（`environment: production`，`cd.yml:264`）是 run 的最后一个 job，一个停在生产审批的 run 让之后每次合并的 staging 部署排队。#1204 记录了 run 32772001263 等审批时 run 32799575964 一个 job 都起不来；#1325 的现状是 orchestrator 看守在几秒内拒掉每个生产门，审批从没机会成为一个真的决定。

② **部署返回 ≠ 生效。** #1332：run 33937949553 里 `stage-migration` 在 02:06:51Z 部署完 `migrator-staging`，02:06:54Z 就 POST `/migrate`，应答的是旧 bundle（`appliedHead` 仍是 `20260902000000_agent_runs`），阶段失败。`promote-release-unit.sh:211-218` 把 `wrangler deploy` 返回当作"新版本已在服务"，中间没有按版本的就绪握手。

③ **受影响判断有三套，互不一致。** CI 与 CD 读 `.github/ci/components.json` 经 `change-plan.py`（CD 再经 `cd-cohort-plan.py`），本地 pre-push 是另写的 bash 路由 `changed-packages.sh`，差异列在 map §2.5，靠 `test_ci_routing_consistency.rb` 守住不漂（T-07）。结果：只改 `packages/contract` 的分支本地不跑 `gate_agent`，CI 却选中 agent（#1323，PR #1310 只在 CI 红）；web-only 的 main delta 被 cohort 解析成 `migrator, db, agent, edge, web`（#1204 第 3 条）。

④ **本地 pre-push 跑 Docker 套件。** `gate_agent` 末尾 `docker build`（`pre-push.sh:179`），`db-fresh-schema.sh` 无离线回退（map §5.8）；路由落到 `all` 时 catalog 的 `test:spike` 在本地起容器，2026-09-04 两次串行 push 因 `57P03` 挂掉（#1322），一次 `pnpm-lock.yaml` 改动就能把 push 堵在这里。

⑤ **流水线在验证自己。** `route` job 每次先跑七个契约测试再算计划（`pr-verification.yml:34-50`，T-25）；`static-quality` job 就是 `quality.sh` 的 ~140 条手写调用（map §3.7、§5.3）；`.github/scripts` 里 47 个 `test_*` 守的多半是复制品之间的一致性——edge 密钥名 9 处、Postgres 镜像 tag 7 处、promote 循环 10 块、YAML loader 14 份、路由器两种语言（tooling 审计 §5 第 1 条，T-05/T-06/T-08/T-09）。另一侧，CodeQL 的 merge-ref 竞争把全绿 PR 锁成 `BLOCKED`（#1204 第 1 条）。

手写面积（HEAD `212506fef` 实测）：`.github/actions` 11 个复合 action 851 行；`.github/scripts` 108 个文件 10,586 行；`scripts/local-gates` 39 个文件 4,559 行；五个 workflow 949 行。它们各是什么，见 map §1（workflow）、§3–§4（CI/CD 闸与脚本）、§5–§6（本地门禁与契约测试）。这些行数里，业务规则（agent 与 edge 同发、migrator 只到 staging、迁移握手、smoke 探哪两个面）不到一百行，其余是平台已经提供的东西的再实现。

## 二、原则与不做的事

原则（owner 决策 1）：平台或官方 action 有的功能不自己写；自己写的只剩业务规则。

owner 明确否掉的方案，本文不再讨论：

| 否掉的 | owner 2026-09-05 的口径 |
|---|---|
| GitOps（部署状态存仓库、reconciler 收敛） | 骨架保留为 push main → build 一次 → staging 五段 → smoke → `environment: production` 审批 → 同一 artifact 晋级（决策 2） |
| 独立的晋级 workflow（doorbell、`workflow_dispatch` 晋级，#1079 一类） | 同一 run 内晋级同一 artifact；没有第二条部署路径 |
| 部署记录基线（`resolve-cd-base.sh` 那种"找上一次成功 run 的 head"） | CD 的受影响范围就是 `github.event.before..sha`；中途失败的 run 用 `gh run rerun --failed` 补发（决策 3） |
| 全量幂等发布（每次把所有单元都发一遍） | 只发受影响的；pnpm 图是唯一的受影响判定 |
| artifact attestation / provenance | 不加；`actions/upload-artifact` 的不可变 + 摘要够用（决策 4） |
| 删 migrator Worker、CI 直接持有 DSN 做迁移 | CI 永远不持有数据库凭据，短期的也不行；staging 与 production 都经 migrator（决策 6） |
| `cancel-in-progress: true` | 正在发的发完；生产门口的 run 由 owner 手动批/拒，看守退役（决策 5）。评审后 owner 追加：`cd-staging` 与 `cd-production` 都加 `queue: max`，排队按序、不取消（§六 第 3 条） |
| CI 对 staging 不设门（2026-08-27 接受过的 workers.dev 裸探） | owner 要求只有固定的人和固定的自动化能到 staging；定案 = Cloudflare Access 罩住 `staging.animichi.com` 与两个 staging workers.dev URL，人登录，CI 与本地自动化带 ESC 里的 service token（决策 13，§七 #12 已定） |
| CI 把运行时密钥推给 Worker（`wrangler secret bulk`，或 wrangler-action 的 `secrets:` 输入） | 运行时密钥一律 Pulumi → Secrets Store，edge 的 8 个也是（决策 12 的延伸，owner 2026-09-05，§七 #17）；CI 永不上传运行时密钥 |
| 自己写一道门 | owner 定的原则：**门交给平台的访问层；只有平台没有原生机制的地方才自验 OIDC**——Pulumi Cloud 有原生的 GitHub OIDC 联邦，就用它；Workers 没有联邦机制，migrator 才自验 OIDC；staging 有 Access，就不再自验（§3.5） |

保持不变：required checks 仍是 `PR Verification` 与 `Security`（ruleset 19974534 的 `required_status_checks`，map §1.6），ruleset 不改（决策 8）；ADR 0003 里"运行时 DSN 由 Pulumi 写 Secrets Store"那一半不变（决策 12）。

## 三、目标形态

### 3.1 workflows 与 job 图

| workflow | 触发 | job（按依赖顺序） | 手写残留 |
|---|---|---|---|
| `pr-verification.yml`（name `CI`） | `pull_request`、`merge_group` | `plan`（`pnpm ls -r --depth -1 --json --filter "...[<merge-base>]"` 出包名，减去根项目与 `@animichi/agent`；`dorny/paths-filter` 出 `agent` / `web` / `migrations` / `deps` 四个布尔）→ `affected`（`if: packages != '[]'`；matrix = 包名；`pnpm --filter <pkg> run --if-present` 依次 `lint`、`typecheck`、`test`、`test:integration`；需要 Postgres 镜像的包先构建镜像；catalog 另加一步 `test:spike`——它起容器，而 `test` 正是 pre-push 对每个受影响包都要跑的东西（#1473）；`codecov/codecov-action` 按包打 flag）∥ `agent`（Python 一臂，`make check`）∥ `db`（schema 闸）∥ `e2e`（browser）∥ `commits`（commitlint）∥ `docs`（三个文档卫生脚本，`affected` 之外）∥ 六个安全 job（B1 期间外加一个过渡 `codeql` job，B3 删）→ `Security` → `PR Verification` | `plan` 的十来行；两个汇总 job 各一行表达式；三个文档卫生脚本（业务） |
| `cd.yml`（name `CD`） | `push: main` | `plan`（同上，ref = `github.event.before`，首推全零时退到 `HEAD~1`；paths-filter 出 `agent` / `migrations` / `infra`）→ `build`（一次；`tar` → `upload-artifact`）→ `stage-foundation` → `stage-migration` → `stage-services` → `stage-edge` → `stage-web` → `smoke` → `promote-production` | 配对规则各两三行 `if:`；迁移握手 `scripts/delivery/migrate-through-worker.sh`（≈25 行）；smoke 的两个 URL；`plan` 的两行 base 守卫与 head 守卫 |
| `agent-eval-nightly.yml` | cron | 不变；`agent-eval` composite 在 D1 内联；`ZEN_GO_API_KEY` 改自 ESC；随 W4 删除 | — |
| `codeql.yml` | — | 删除（B3），改 GitHub CodeQL default setup | — |
| `rollback.yml` | — | 删除（C1），回退 = `wrangler rollback` | — |

安全 job 六个，各是官方 action 或官方命令：`gitleaks`（`gitleaks/gitleaks-action`）、`trufflehog`（已用）、`osv`（`google/osv-scanner-action`，已用）、`semgrep`（只跑 `.semgrep/` 的六条自定义规则，`semgrep scan --config .semgrep --error`，无账号；公共 rule pack 由 CodeQL default setup 覆盖，owner 定，§七 #5）、`zizmor`（`zizmorcore/zizmor-action`）、`sqlfluff`。都不按路径门控——每个几十秒，门控本身就是一套路由。它们与 `Security` 汇总 job 随 B1 一起落地：`Security` 是 required check（ruleset，map §1.6），今天由 `security` job 汇总 `route` 算出的 matrix（`pr-verification.yml:152-154`），B1 停掉 `route` 的那一刻它必须已经有新的来源，否则 B1 之后每个 PR 都 `BLOCKED`。过渡 `codeql` job **不进** `Security.needs`：ruleset 的 `code_scanning` 规则本身就要求它的结果，而 default setup 一打开，在途 PR 的 CodeQL 上传立刻失败，进了 `Security` 会把那些 PR 连带锁红。`Security` 与 `PR Verification` 都是 `needs: [...]` + `if: always()` + 一步 `if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')` 判红：`*` 是 GitHub 表达式的 object filter，`contains` 对数组按元素匹配[^gha-expr]。

### 3.2 本地门禁

| 阶段 | 内容 | 来源 |
|---|---|---|
| pre-commit | `trailing-whitespace`、`end-of-file-fixer`、`check-yaml`、`check-toml`，加 `check-executables-have-shebangs` 与 `check-shebang-scripts-are-executable`（替代 `shebang-exec-bit.sh`）[^pch]；`ruff` / `ruff-format`；`gitleaks`；`oxlint`（`oxlint-changed.sh` 留）；`shellcheck`；`actionlint`；`semgrep-orm` | `.pre-commit-config.yaml:29-114` 的现有框架（决策 9） |
| commit-msg | `commitlint`（`alessandrojcm/commitlint-pre-commit-hook` + `@commitlint/config-conventional`）；`commitlint.config.js` 的 `type-enum` / `scope-enum` 沿用 `commit-message.py:10-41` 的两张表，`header-max-length` 72；一个本地 plugin 规则拒绝 Claude / Anthropic / Codex / OpenAI 的 `Co-Authored-By` 与 `Generated with` 尾注（commitlint 允许且只允许一个本地 plugin）[^commitlint] | 替代 `commit-message.py`（决策 9） |
| pre-push（必须保留，owner：不接受 CI 红） | `scripts/local-gates/pre-push-affected.sh`（原定 **≤40 行**；E1 落地为 **68 行**，评审席 2026-09-08 的三条修正各要真代码：读 git 的 pre-push stdin 记录以**拒绝**本地 sha 不是 HEAD 的那次推送（门控的始终是 checkout 的 HEAD 的 diff：路径若取自被推的 ref，而 `pnpm ls` 与每个包脚本都跑在 checkout 的树上，就是拿另一条分支的绿灯放行；一卡一 worktree，这条规则不花成本）、把「没人认领的路径」检查从「包集合为空时」提到**每次 diff 都跑**、以及空 `pnpm ls` 那一行空行的守卫。为凑行数删掉其中任何一个都是删守卫，故按偏差记录而不隐藏；第一项按落地的 `scripts/local-gates/pre-push-affected.sh` 与它的 `pre-push-affected.test.sh` 更正，原文写反了方向，#1487）。**不能把选包交给 pnpm 的 `[<ref>]`**：pnpm 10.33.2 在 linked worktree 里对 `--filter "[HEAD~3]"` 答 `No projects matched the filters`，同一命令在主 checkout 选中 `.` 与 `./apps/web`，而 `git diff --name-only HEAD~3 -- .` 在 worktree 里正常（2026-09-05 在 `.worktrees/main-lane` 与主 checkout 各测一次，席 A 在 `.worktrees/card-1316` 复现相同结果）——每张卡都在 linked worktree 里开发，交给 pnpm 就是 fail-open。做法：`git diff --name-only origin/main...HEAD` 出改动文件；`pnpm ls -r --depth -1 --json` 出各包 `path`；jq 按目录前缀把文件映射到包名，去掉根项目 `animichi-cloudflare-worker` 与 `@animichi/agent`（后者由下面的 `make check` 分支负责）；对每个包名显式 `pnpm -r --filter "...<name>" run --if-present` 依次 `lint`、`typecheck`、`test`（`...` 带上依赖方）[^pnpm-run]。四个桶（第四个由 E1 / #1371 的评审席加，见本行末）：`apps/agent` 或 `packages/contract` 有改动则 `make check`（W4 前；`Makefile:110` 的 `check` 含 `test-integration`，那是离线 Docker arm——这是 pre-push 里唯一保留的 Docker 用法，随 W4 消失）；`migrations/neon` 有改动则 `atlas migrate validate --dir file://migrations/neon`（无 Docker）；`docs/**`、`*.md`、`.claude/**`、`AGENTS.md`、`CONTEXT-MAP.md` 有改动则跑三个文档卫生脚本（`check-agents-refs.sh` / `check-docs-paths.sh` / `check-root-allowlist.sh`，搬到 `scripts/local-gates/`，§七 #19）。不需要任何包或桶的路径白名单（脚本里一个常量）：`docs/**`、根级 `*.md`、`.claude/**`、`.github/**`（zizmor / actionlint 守）、`.semgrep/**`、`.semgrepignore`、`codecov.yml`、`.pre-commit-config.yaml`、`Makefile`、`scripts/**`（pre-commit 的 shellcheck / ruff 已覆盖）。改动非空、包集合为空、没有命中任一桶、又有文件不在白名单里时，**失败关闭**并列出这些文件。**第四个桶（E1 评审席定，2026-09-08）**：`pnpm-lock.yaml` / 根 `package.json` / `pnpm-workspace.yaml` / `.npmrc` 有改动 → **选中全部 workspace 包**。根依赖文件不属于任何 project 目录，pnpm 也只把它算给根项目（`...` 不加依赖方），所以「受影响」只能是全部；CI 的 `plan` 用 `deps` paths-filter 做同一件事（§3.1、B1）。此前它落进失败关闭分支，等于每次 lockfile 改动都挡住 push 且无本地出路 | 替代 `pre-push.sh` + `quality.sh` + `changed-packages.sh`（决策 9） |
| 手动 | `make check-full`：`pnpm -r run` 全包 `lint` / `typecheck` / `test` / `test:integration` + `db-fresh-schema.sh` + catalog `test:spike` + `make check` | Docker 套件只在这里和 CI |

包内自己的检查（`contract-drift.sh`、`eval-fixture-drift.sh`、`infra-check.sh`、edge 的 `test:bundle-smoke` 与 `check-edge-ratelimit-namespace.sh`、contract 的 OpenAPI vet）挂进各包 `package.json` 的 `test`。包名就是 lane 名；CI 与 pre-push 跑的是同一份包脚本，"CI↔本地对等"不再需要一个测试去证明。

### 3.3 凭据来源

| 消费者 | 今天 | 目标 |
|---|---|---|
| Pulumi 面（`stage-foundation`、production 的 foundation 步） | GitHub secrets ×7（`cd.yml:103-114`，map §4.8） | `pulumi/auth-actions`（OIDC）[^paa] → `pulumi/esc-action` 打开 `lifeodyssey/animichi/staging` 或 `…/prod`[^esc]：`CLOUDFLARE_API_TOKEN`、`NEON_API_KEY`（W-A 落地） |
| Worker 发布（migration / services / edge / web） | `secrets.CLOUDFLARE_API_TOKEN` 步级注入 | 同一 ESC 环境的 `CLOUDFLARE_API_TOKEN`（发布面）；`CLOUDFLARE_ACCOUNT_ID` 改 `vars` |
| edge 运行时密钥（`edge-runtime-secrets.py:11-19` 的 8 个名，含 `SUPABASE_DB_URL`） | GitHub secrets → `wrangler secret bulk`（`sync-edge-runtime-secrets.sh:14`），每次 edge 部署都推一遍 | 值放 ESC，读它的是 Pulumi 不是发布 job：stack 的 `environment:` 导入 ESC 环境，`pulumiConfig` 里的 `fn::secret` 进程序就是 secret[^esc-iac]，`infra/database-access` 声明 `cloudflare.SecretsStoreSecret` ×8（`index.ts:222-231` 已有同类声明）；edge 用 `[[secrets_store_secrets]]` 绑定（`wrangler.toml:329-332,545-548` 的形状）经 `readStoreOrString`（`container-env.ts:172`）读；CI 永不上传运行时密钥，wrangler-action 的 `secrets:` 输入不用（D4，§七 #17；#1057 修正案 seat-1(a) 由此吸收）。C1 到 D4 之间 Worker 上既有的 wrangler secret 原样保留：`secret put` / `delete` 各自建版本，`deploy` 不动未在配置里声明的 secret[^cf-secrets] |
| `NEON_AUTH_JWKS_URL`（staging / production GitHub secret）、`CORS_ALLOWED_ORIGIN`（production GitHub secret） | 两个 GitHub 副本没有任何 workflow、action、脚本读取（2026-09-05 grep）。`NEON_AUTH_JWKS_URL` 是公开 URL，按 #1047 是 per-environment 的 wrangler **var**，不是 secret（`workers/edge/wrangler.toml:33-39` 注释；staging 值在 `:495` `[env.staging.vars]`；production 刻意不设，未 provision 前失败关闭，`workers/edge/test/auth-config.test.ts:57-66` 两条测试钉着）；`CORS_ALLOWED_ORIGIN` 是 `wrangler.toml:309` 的 var | D1 删掉两个 GitHub 副本；值留在 wrangler var 里，production 的 `NEON_AUTH_JWKS_URL` 继续不设；两者都不进 ESC、不进 `secrets:` 名单 |
| web 的 `RUNTIME_CONFIG`（per-env 公开值：Neon Auth SDK 端点、Turnstile site key、showcase 开关） | promote 时 `inject-release-web-runtime-config.mjs:11` 从 GitHub 变量 `VITE_*`（`release-web-runtime-config.mjs:6-8` 的 8 个名）拼出并写进 `wrangler.jsonc` | 提交在 `apps/web/wrangler.jsonc` 的 `env.<stage>.vars.RUNTIME_CONFIG`（staging 已在 `:63-68`，production 补上），`__root.tsx:15,51` 的 SSR 内联读取不变；build 一次，构建期不再有按环境不同的 `VITE_*`；GitHub 变量 `VITE_*` 删（D1）（owner 定，§七 #18） |
| 迁移（staging + production） | staging：OIDC → migrator；production：`secrets.NEON_DATABASE_URL` + Atlas（`cd.yml:309`，`promote-release-unit.sh:261-269`） | 两边都 OIDC → migrator；`NEON_DATABASE_URL` 从 GitHub 删除（#1057 终局）；C1 到 C3 之间 production 暂留 Atlas 过渡步（§五 C1） |
| 运行时 DSN | Pulumi → Secrets Store（ADR 0003） | 不变 |
| staging 访问（CI smoke / e2e、本地 lane、eval、人） | `STAGING_GATE_TOKEN`（GitHub secret + `Pulumi.staging.yaml:53-57` 双写；GitHub 副本今天没有 workflow 读者，`Pulumi.staging.yaml:30` 的说明已过时，smoke 探的是 workers.dev） | Cloudflare Access 同时罩住 `staging.animichi.com` 与两个 staging workers.dev URL（owner 2026-09-05 定，§七 #12）。人：identity policy 登录。CI 与本地自动化：service token（`CF-Access-Client-Id` / `CF-Access-Client-Secret`，policy action 用 Service Auth[^cf-st]），值在 ESC，CI 经 `pulumi/esc-action`，本地 `esc env get`[^esc-get] |
| Codecov | OIDC（`coverage/action.yml:19-51` 的 `use_oidc: true`） | 不变 |
| nightly eval | `secrets.ZEN_GO_API_KEY`（`agent-eval-nightly.yml:35`） | ESC |
| 终态 | 今天 repo 20 个、staging 13 个、production 11 个 secret 名（`gh secret list`，2026-09-05） | `gh secret list` 三处为空 |

ADR 0003 修订：删掉 "No Pulumi Cloud dependency" 与 "CI-only 值留 GitHub secrets" 两句（`docs/adr/0003-secrets-architecture.md:27,22`），以 #1077 / #1078 为准；#1078 的契约 (b)/(c)（"publish job 不开 ESC"、"只有两个环境名"）改成"每个 job 只打开自己 stage 的环境"（决策 12）。

OIDC subject：job 引用了 environment 时 GitHub 的 `sub` 是 `repo:lifeodyssey/animichi:environment:<name>`，否则是 `repo:lifeodyssey/animichi:ref:refs/heads/main`[^gh-oidc]。PR #1329 的 runbook 只写了"用 job 的 GitHub OIDC 身份换 organization token"，既没有记录 Pulumi Cloud 侧 issuer policy 绑定的是哪种 subject，写的 token 类型也是错的：2026-09-05 在分支 `ci-test/pulumi-oidc-probe` 上跑的探针 run 以 `401 … policy authorization error: Org tokens are not supported for non enterprise organizations` 失败——`requested-token-type: urn:pulumi:token-type:access_token:organization` 只在 Team / Enterprise / Business Critical 版可用，`team` 只在 Enterprise / Business Critical，`personal`（`urn:pulumi:token-type:access_token:personal` 配 `scope: user:lifeodyssey`）在所有版本可用[^pl-oidc]；Pulumi org `lifeodyssey` 是个人版，所以本文一律换 personal token（Pulumi 用户名 `lifeodyssey`）（分支 `card/1077-pulumi-cloud-oidc` 的 `docs/ops/deployment.md` "Pulumi state, encryption, and CI identity (#1077)" 段）。本文把每个要 token 的 job 都挂上 environment（`smoke` 与 nightly 用 `environment: staging`，staging 环境无审批人），policy 里只留 §3.5 列的两个 environment subject；D1 的验收把 policy 原文贴进卡（§七 N1）。

### 3.4 `cd.yml` 骨架示意

```yaml
name: CD
on: { push: { branches: [main] } }
permissions: { contents: read }

jobs:
  plan:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      packages: ${{ steps.pnpm.outputs.packages }}   # 例 ["catalog","edge-worker","web"]
      agent: ${{ steps.paths.outputs.agent }}
      migrations: ${{ steps.paths.outputs.migrations }}
      infra: ${{ steps.paths.outputs.infra }}
    steps:
      - uses: actions/checkout            # fetch-depth: 0
      - uses: pnpm/action-setup
      - uses: actions/setup-node          # cache: pnpm
      - id: pnpm
        env: { BASE: "${{ github.event.before }}", HEAD_SHA: "${{ github.sha }}" }
        run: |
          # 首推 / 强推的 before 是 40 个 0 或不在历史里 → 退到 HEAD~1（不查 run 历史，决策 3 不变）
          if [ "$BASE" = 0000000000000000000000000000000000000000 ] || ! git cat-file -e "$BASE"; then BASE=$(git rev-parse HEAD~1); fi
          # 旧 run 的 rerun 不得覆盖更新的 main（§六 第 3 条）
          [ "$(git ls-remote origin refs/heads/main | cut -f1)" = "$HEAD_SHA" ] || { echo "::error::main has moved past $HEAD_SHA"; exit 1; }
          # 根项目与 Python 的 apps/agent 都是 pnpm 项目，但都不走 matrix（§六 第 8 条）
          echo "packages=$(pnpm ls -r --depth -1 --json --filter "...[$BASE]" | jq -c '[.[].name] - ["animichi-cloudflare-worker","@animichi/agent"]')" >> "$GITHUB_OUTPUT"
      - id: paths
        uses: dorny/paths-filter
        with:
          filters: |
            agent: ['apps/agent/**']
            migrations: ['migrations/neon/**']
            infra: ['infra/**']

  build:
    needs: plan
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      # 受影响的单元各自构建：web `pnpm --filter web build`；四个 Worker `wrangler deploy --dry-run --outdir`；
      # migrations/ 与 infra/ 原样复制；agent / migrator 镜像：docker/build-push-action（load: true，tag sha-<sha>）
      # → wrangler containers push；一行把镜像引用写进 wrangler 配置（W4 前）
      - run: tar -cf release.tar release/              # 保权限
      - uses: actions/upload-artifact
        with: { name: release-${{ github.sha }}, path: release.tar, retention-days: 14, if-no-files-found: error }

  stage-foundation:
    needs: [plan, build]
    if: ${{ !failure() && !cancelled() && needs.plan.outputs.infra == 'true' }}
    environment: staging
    concurrency: { group: cd-staging, cancel-in-progress: false, queue: max }
    permissions: { contents: read, id-token: write }
    timeout-minutes: 20
    steps:
      - uses: actions/download-artifact  # name: release-${{ github.sha }}
      - uses: pulumi/auth-actions        # organization: lifeodyssey；requested-token-type: urn:pulumi:token-type:access_token:personal；scope: user:lifeodyssey
      - uses: pulumi/esc-action          # environment: lifeodyssey/animichi/staging
      - uses: pulumi/actions             # command: up, stack-name: lifeodyssey/staging, work-dir: release/infra

  stage-migration:
    needs: [plan, build, stage-foundation]
    if: ${{ !failure() && !cancelled() && (contains(fromJSON(needs.plan.outputs.packages), 'migrator') || needs.plan.outputs.migrations == 'true') }}
    environment: staging
    concurrency: { group: cd-staging, cancel-in-progress: false, queue: max }
    permissions: { contents: read, id-token: write }
    timeout-minutes: 20
    steps:
      - uses: actions/download-artifact
      - uses: pulumi/auth-actions
      - uses: pulumi/esc-action
      - uses: cloudflare/wrangler-action  # command: deploy release/migrator/index.js --no-bundle --config … --env staging --tag sha-${{ github.sha }}
      - run: bash scripts/delivery/migrate-through-worker.sh staging   # 轮询 bundleHead == 期望 head，再 POST /migrate {expectedHead}

  stage-services:   # needs: [plan, build, stage-foundation, stage-migration]；if 看 packages 是否含 'catalog' / 'users'；每个 Worker 一步 wrangler-action deploy --tag；同样的 concurrency
  stage-edge:       # needs 列出全部前序；if 含 'edge-worker' || needs.plan.outputs.agent == 'true'   ← agent+edge 同发，W4 后删这半句
  stage-web:        # needs 列出全部前序；if 含 'web'
  smoke:
    needs: [plan, build, stage-foundation, stage-migration, stage-services, stage-edge, stage-web]
    if: ${{ !failure() && !cancelled() }}
    environment: staging               # 让 OIDC subject 落在 environment:staging（§3.3）
    concurrency: { group: cd-staging, cancel-in-progress: false, queue: max }
    permissions: { contents: read, id-token: write }
    timeout-minutes: 10
    steps:
      - uses: pulumi/auth-actions
      - uses: pulumi/esc-action          # 取 CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET（D3 之后两个 workers.dev URL 都在 Access 后面）
      - run: bash .github/scripts/staging-smoke-check.sh https://animichi-staging.zhenjiazhou0127.workers.dev https://animichi-web-staging.zhenjiazhou0127.workers.dev   # 带两个 Access header

  promote-production:
    needs: [plan, build, stage-foundation, stage-migration, stage-services, stage-edge, stage-web, smoke]   # 全列：只靠 smoke 会把上游失败看成 skipped
    if: ${{ !failure() && !cancelled() }}
    environment: production            # 审批门：Required reviewers，一人批准即放行，拒绝则 run 失败
    concurrency: { group: cd-production, cancel-in-progress: false, queue: max }
    permissions: { contents: read, id-token: write }
    timeout-minutes: 40
    steps:
      - uses: actions/download-artifact  # 同一个 release-<sha>，没有任何构建步
      - uses: pulumi/auth-actions
      - uses: pulumi/esc-action          # environment: lifeodyssey/animichi/prod
      # 之后按 foundation → migration → services → edge → web 各一步，if 条件与 staging 相同。
      # C1 到 C3 之间 migration 步是 Atlas 过渡步（ariga/setup-atlas + validate/apply + STAGING_ONLY_BASELINE 守卫 + secrets.NEON_DATABASE_URL）；C3 换成 migrate-through-worker.sh production
```

每个 job 都带 `timeout-minutes`（今天每个 job 都有，由将被删的 `assert-workflow-invariants.rb` 守着；以后靠 zizmor 与评审）。`stage-*`、`smoke`、`promote-production` 的 `needs` 都列出全部前序 job（`cd.yml:78-88` 的 skip 传播设计，保留）：仓库的测量是 `!failure() && !cancelled()` 只看 `needs` 里直接出现的 job，而 GitHub 表达式文档写的是 `failure()` "returns true if any ancestor job fails"[^gha-expr]，两者谁对由 C1 的 skip 传播验收裁定（§七 N3）；无论结果如何全列不吃亏。`build` 只发生一次，`promote-production` 里没有构建步；两个环境的 `download-artifact` 拿的是同一个 artifact，`upload-artifact` 的 `artifact-digest` 输出（"SHA-256 digest of an Artifact"）写进 job summary 作记录[^ua]。审批门的语义来自 GitHub environment 的 Required reviewers（最多 6 人，一人批准即可；"If a job is rejected, the workflow will fail"）[^gh-env]。

### 3.5 身份与授权边界

只有一个身份提供方：GitHub Actions 的 OIDC issuer（`https://token.actions.githubusercontent.com`，`packages/contract/src/oidc-github.ts:26`）。它证明的是"哪个仓库、哪个 ref、哪个 environment、哪个 workflow 文件在跑"（`sub`、`ref`、`environment`、`job_workflow_ref`），不证明"可以做什么"。授权由每个 relying party 自己做，靠两样东西：一个只属于它的 `aud`，和它自己的策略。

- Pulumi Cloud：CI 用 `pulumi/auth-actions` 请求 `aud = urn:pulumi:org:lifeodyssey` 的 token，Pulumi Cloud 按 issuer policy 决定换不换 token。本仓库换的是 **personal** token：`requested-token-type: urn:pulumi:token-type:access_token:personal` 配 `scope: user:lifeodyssey`——organization token 只在 Team / Enterprise / Business Critical 版可用（`team` 类型更窄，只在 Enterprise / Business Critical），`lifeodyssey` 是个人版 org，2026-09-05 的探针 run 用 organization 类型得 `401 … Org tokens are not supported for non enterprise organizations`[^pl-oidc]。issuer policy 里因此必须有一条 **token type = personal、user = `lifeodyssey`** 的策略，subject pattern 才谈得上生效。#1072 落地时按 Pulumi 文档的范例写成了 `sub: repo:lifeodyssey/animichi:*`（owner 2026-09-05 告知）——任何分支、任何 PR 的 run 都能换到 token，太宽。D1 把它钉成两个 subject：`repo:lifeodyssey/animichi:environment:staging`、`repo:lifeodyssey/animichi:environment:production`。`ref:refs/heads/main` 形式不留：D1 之后没有任何 job 在不带 environment 的情况下要 token（`cd.yml` 的 job 全带，nightly 用 `staging`），留着只是多一个入口。同时两个 GitHub environment 的 deployment branches 规则只允许 `main`（今天两个环境都没有分支限制：`GET …/environments/<name>/deployment-branch-policies` 答 404），environment 形式的 `sub` 才等价于"来自 main"。
- migrator：`aud = animichi:github-actions:migrator`（`workers/migrator/src/policy.ts:21`）；staging 策略要求 `ref == refs/heads/main` 且 `environment == staging`，并且 `job_workflow_ref == lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main`（`policy.ts:26-27,37-39` 的 `trustedWorkflowRefs`）。production 用**独立的** `PRODUCTION_OIDC_POLICY`，只含 production 形状（`refAllow: [{ ref: "refs/heads/main", environment: "production" }]` 与 `subAllow: ["repo:lifeodyssey/animichi:environment:production"]`），由 `[env.production]` 的 var 选中，绝不追加进 `STAGING_OIDC_POLICY`：`refAnchored` 是 `policy.refAllow.some(...)`（`oidc-github.ts:77-83`），一个 allowlist 里同时放两种形状，staging 铸的 token 就能过 production 的门——MED-2 禁的正是这个（`oidc-github.ts:11-18`；`policy.ts:9-10` 写明 production 是独立的 worker / DSN / allowlist）。
- staging：不自验。门是 Cloudflare Access（平台访问层），人走 identity policy，CI 与本地自动化带 service token（决策 13；owner 原则：门交给平台的访问层，只有平台没有原生机制的地方才自验 OIDC）。`workers/edge/src/staging-gate/**` 里那道自验的 OIDC 门（`aud = animichi:github-actions:staging-gate`，`workers/edge/src/staging-gate/policy.ts:26`）随 D3 删除；它只在 §七 N4 失败时以中间件形态回来（§六 第 4 条）。

一个 `aud` 的 token 到别的门就被拒（签名在 `createGitHubOidcVerifier` 的 `jwtVerify` 里验，claims 的顺序是 `iss` → `aud` → repository → workflow ref → environment 锚，`oidc-github.ts:119-135`），所以 Pulumi 与 migrator 两道自验的门互不串；GitHub 只负责说清楚来者是谁。人不在这条线上：人走 Access 的 identity policy（登录）。

## 四、逐项替换表

### 4.1 手写 → 官方

| 今天（手写） | 目标（平台 / 官方 action） | 依据 |
|---|---|---|
| `change-plan.py` + `components.json` + `cd-cohort-plan.py` + `changed-packages.sh`（三套路由，map §2） | CI / CD：`pnpm --filter "...[<ref>]"`（"Selects all the packages changed since the specified commit/branch"，`...` 带上依赖方）：PR 用 merge-base，CD 用 `github.event.before`；`pnpm ls -r --depth -1 --json --filter` 出包名做 matrix，减去根项目 `animichi-cloudflare-worker`（根也是一个 pnpm 项目，`docs/**`、`.github/**`、`pnpm-lock.yaml` 的改动按目录包含落到它，而根没有 `lint` / `typecheck` / `test` 脚本，2026-09-05 实测）与 `@animichi/agent`（`apps/agent/package.json` 是 pnpm 项目，`test` = `uv run pytest …`，runner 没有 uv；它由 `agent` job 负责）；`affected.if: packages != '[]'`（空数组进 `strategy.matrix` 是 workflow 错误，不是 skipped）。本地：git diff → 包名 → 显式 filter（§3.2） | pnpm filtering[^pnpm-filter]；`pnpm ls --depth -1` "will list projects only"[^pnpm-ls]；push 事件 `before` = "The SHA of the most recent commit on ref before the push"[^gh-push] |
| `resolve-cd-base.sh`（`:1-30`，找上一次成功 run 的 head） | 不做；失败 run `gh run rerun --failed`（"Rerun only failed jobs, including dependencies"）[^gh-rerun]；`plan` 只带两行守卫：全零 / 不存在的 `before` 退到 `HEAD~1`（首推、强推时 `pnpm --filter "...[0000…]"` 直接 `ERR_PNPM_FILTER_CHANGED … bad object`，2026-09-05 实测），以及 `github.sha` 必须仍是 `origin/main` 的 head | 决策 3 |
| `pr-verification-gate.sh:78-88` sourcing `pre-push.sh` 的 `gate_*`（CI↔本地对等，`test_ci_prepush_parity.rb`）；`pr-verification-gate.sh:22-29,90` 的 OpenAPI 基线与 vet（`packages/contract/test/vet-gate.test.ts:29` 读它） | 各包 `package.json` 的 `lint` / `typecheck` / `test` / `test:integration`；CI 与 pre-push 都只是 `pnpm run`；contract 的基线 + `vet:openapi`（`packages/contract/package.json:28`）进 contract 的 `test`，`vet-gate.test.ts` 改读包脚本 | 对等由同一份脚本成立 |
| `gate_db`（`pre-push.sh:276-281`：`atlas migrate validate`、`migration-boundary.test.ts`、sqlfluff、`db-fresh-schema.sh`）散在 `affected (db)` 里 | PR 的 `db` job：paths-filter `migrations/neon/**` → `ariga/setup-atlas@v0` → `atlas migrate validate --dir file://migrations/neon` → `packages/test-postgres` 镜像 → `db-fresh-schema.sh` → `pnpm --filter migrator test`；`migrations/neon` 在所有包目录之外，pnpm 图看不见它，没有这个 job 迁移就只剩 sqlfluff 一道闸 | 决策 14 的同一手法 |
| `security-tool` / `secret-scan` 复合 + `resolve-secret-scan-range.sh` + `security-aggregate.sh` | `gitleaks/gitleaks-action`（个人账号不需要 license）[^gl]；`trufflesecurity/trufflehog`、`google/osv-scanner-action`（已用，`security-tool/action.yml:27,32`）；`zizmorcore/zizmor-action`（persona `regular`，online audits）[^zz]；semgrep 只留 `.semgrep/` 六条自定义规则（`py-no-direct-driver-client` / `py-no-sqlalchemy-text-literal` / `py-no-inline-sql-execute` / `ts-no-complete-sql-statement` / `ts-no-direct-neon-seam-bypass` / `ts-no-sql-raw`，#999 的 ORM-only 边界）：`semgrep scan --config .semgrep --error . --exclude '**/tests/**' --exclude '**/test/**'` + `scripts/semgrep-raw-sql-test.sh` 的 fail-closed 自测；`p/python` / `p/typescript` / `p/javascript` 三个公共 pack 删，CodeQL default setup 覆盖；无账号、无 `SEMGREP_APP_TOKEN`；pre-commit 的 `semgrep-orm` 已是同一条命令（`.pre-commit-config.yaml:111`）；sqlfluff（官方仓库只提供 workflow 范例，无 marketplace action[^sqlfluff]：`pip install sqlfluff` + `sqlfluff lint migrations/neon --dialect postgres --config db/.sqlfluff`，与 `security-tool/action.yml:86` 同参数）；`Security` = 表达式；B1 期间外加一个过渡 `codeql` job（`github/codeql-action` init / analyze，三语言，不门控），让 ruleset 的 `code_scanning` 规则在 default setup 打开之前一直有结果 | 决策 7 |
| `codeql.yml` + `security-codeql-{actions,javascript,python}` 三条 lane（`components.json:63-73`） | GitHub CodeQL default setup（Settings → Advanced Security → CodeQL analysis → Set up → Default）[^cq-default]；default setup 检测到 workflow 文件即自动分析 Actions[^cq-actions]，JS/TS、Python 自动识别[^cq-langs]；`gh api repos/lifeodyssey/animichi/code-scanning/default-setup` 今天答 `state: not-configured`，`languages` 已列出 `actions`、`javascript-typescript`、`python`；切换时 GitHub "will disable the existing workflow file and block any CodeQL analysis API uploads"[^cq-default]，所以过渡 `codeql` job 与 `codeql.yml` 同一 PR 删（B3） | ruleset 的 `code_scanning` 规则保留 |
| `check-actions-pinned.sh` | zizmor 的 unpinned-uses 审计 | 决策 7 |
| `build-release-unit` 复合 + `artifact-manifest.json` + `verify-release-artifact.py` + `download-release-cohort.sh` | `tar` → `actions/upload-artifact`（"Artifacts created by upload-artifact@v4 are immutable"；`retention-days` 1–90）；两个环境 `actions/download-artifact` 同名 | 权限："File permissions are not maintained during zipped artifact upload"，README 建议先 `tar`[^ua] |
| `promote-release-unit.sh` 的 `run_worker_deploy` / `deploy_web`（`:61-65,118-124`）+ `promote-release-phase` 复合 | `cloudflare/wrangler-action`，`command: deploy <entry> --no-bundle --config <cfg> --env <stage> --tag sha-<sha>`（本仓库 wrangler 4.114.0 的 `deploy --help` 列出 `--tag` / `--message` / `--no-bundle`） | `wrangler deploy` 一步建版本并全量生效，tag 与 message 存在版本上[^cf-vd]；不需要 `versions upload` + `versions deploy` 两步 |
| `sync-edge-runtime-secrets.sh` + `edge-runtime-secrets.py`（`wrangler secret bulk`，每次 edge 部署从 GitHub secrets 推 8 个名） | 不再有任何 CI 上传步：Pulumi 从 ESC 读值、声明 `cloudflare.SecretsStoreSecret` ×8，edge 绑定 + `readStoreOrString`（§3.3，D4）。wrangler-action 的 `secrets:` 输入**不用**；它的事实留作记录：README "Worker secrets can optionally be passed in via `secrets` as a string of names separated by newlines … using the `wrangler secret put` command"[^wa]，`main` 分支源码顺序 `authenticationSetup` → `installWrangler` → `preCommands` → `uploadSecrets` → `wranglerCommands` → `postCommands`，wrangler ≥ 3.4.0 时一次 bulk 上传（`secret:bulk`，3.60.0 起写作 `secret bulk`），密钥先于 `deploy` 上传、对不存在的 Worker 非交互命令会先建草稿 Worker（memory `feedback_cli_prod_writes`）——这些都是不用它的理由之一。C1 删这两个脚本后到 D4 之前，Worker 上既有的 wrangler secret 原样保留[^cf-secrets]，轮换靠 owner 手动 `wrangler secret put` | 名单只在 Pulumi 里出现一次（T-06 的 9 处归一） |
| `promote_image` / `push_image` / `promote_production_image` / `pin_production_worker_image`（`:71-110`） | `docker/build-push-action`（`load: true`，tag `sha-<sha>`）[^dbp] + `wrangler containers push <TAG>`（"Push a tagged image to a Cloudflare managed registry"）[^cf-cp]；production 不再 re-tag，引用同一 `sha-<sha>` | `docker/login-action` 直登 `registry.cloudflare.com` 无官方文档，§七 #4 |
| `migrate_production`（Atlas 直连 `NEON_DATABASE_URL`，`:261-269`） | migrator Worker 同 staging 路径；`expectedHead` 不在 bundle 内答 409；CD 先轮询版本再 POST（#1332）。C1 与 C3 之间保留 Atlas 过渡步（同一段逻辑：`atlas migrate validate` / `apply`、`STAGING_ONLY_BASELINE` 守卫），C3 删 | 决策 6 |
| `migrator_oidc_token`（`:204-209`，手写 curl）与孤儿 `request-github-oidc-token.sh`（T-03） | `actions/github-script` 的 `core.getIDToken(audience)`[^core]；job 声明 `id-token: write`（`cd.yml:126-129` 今天已这样） | 一处 |
| `rollback.yml` + `rollback-release` + `validate-rollback-release.py` | `wrangler rollback [version-id] --name <worker>`（wrangler 4.114.0 `--help`）；版本带 `sha-` tag，`wrangler versions list` 可查[^cf-cmd]；镜像 = 重发旧 `sha-` tag（W4 后无镜像）。`rollback-release/action.yml:95-135` 用 `validate-rollback-release.py`、`verify-release-artifact.py`、`setup`、`promote-release-unit.sh`，C1 删了这些它就是死的，所以三个文件随 C1 一起删 | 决策 10 |
| `setup` 复合（`setup/action.yml:11-23`）与 `install-atlas` 复合 | `pnpm/action-setup` + `actions/setup-node` 内联（今天就是它们）；`ariga/setup-atlas@v0`[^atlas]。`setup` 还被 `agent-eval/action.yml:10` 用着，nightly 内联（D1）之后才删 | — |
| workflow 级 `affected-cd-main`（`cd.yml:10-12`，`rollback.yml:31-33` 同名） | job 级 `cd-staging`（五段 + smoke）与 `cd-production`，都 `cancel-in-progress: false` + `queue: max`（owner 定，§六 第 3 条） | 等待审批的 run 占住组：#1204 / #1325 的实测，社区讨论同样结论[^gha-17401] |
| `pre-push.sh`（325 行）+ `quality.sh`（~140 条）+ `changed-packages*.sh` + 自测 | `pre-push-affected.sh` ≤40 行（§3.2） | 决策 9 |
| `commit-message.py` | commitlint（conventional，type / scope 表沿用）[^commitlint]；PR 侧 `commitlint --from <base> --to <head>` + PR title[^commitlint-ci] | 决策 9 |
| `shebang-exec-bit.sh` | `check-executables-have-shebangs` + `check-shebang-scripts-are-executable`[^pch] | — |
| `staging-access-gate` ruleset（`infra/src/staging.ts:114-129`）+ `workers/edge/src/staging-gate/**` + `setup-staging-gate.sh` + `STAGING_GATE_TOKEN` | Cloudflare Access：identity `allow` policy（人）+ Service Auth policy（service token）[^cf-pol]，同一套策略罩住 `staging.animichi.com` 与两个 staging workers.dev URL（Workers 文档：Access "can protect one Worker's production workers.dev URL"[^cf-wdev]）；Pulumi 资源 `cloudflare.ZeroTrustAccessApplication` / `ZeroTrustAccessPolicy`（`decision: nonIdentity`，`includes: [{ serviceToken: { tokenId } }]`）/ `ZeroTrustAccessServiceToken`（输出 `clientId` / `clientSecret`，默认 8760h）[^pl-st][^pl-pol]；secret 经 ESC 的 `pulumi-stacks` provider 读 stack output，不经人手复制[^esc-stacks]；`staging-gate/**` 的自验 OIDC 门删除 | 决策 13；§七 #12 已定 |
| `inject-release-web-runtime-config.mjs` + `release-web-runtime-config.mjs`（+ 两个 `.test.mjs`）+ `check-web-runtime-config-payloads.sh`（+ `.test.sh`） | 删；`RUNTIME_CONFIG` 按环境提交在 `apps/web/wrangler.jsonc`（§3.3） | owner 定，§七 #18 |
| `check-agents-refs.sh` / `check-docs-paths.sh` / `check-root-allowlist.sh`（`quality.sh` 的三条文档卫生检查） | 保留：搬到 `scripts/local-gates/`；PR 的 `docs` job（`affected` 之外一个 job）跑三条；pre-push 的 docs 桶跑同三条 | owner 定，§七 #19 |
| Python 一臂散在 `affected` matrix 的 `if:` 里（`pr-verification.yml:213-224`） | `dorny/paths-filter`（`agent: [apps/agent/**, packages/contract/**]`）门控一个 `agent` job[^dpf]；W4 整段删 | 决策 14；#1323 |

### 4.2 删除清单（按文件，括号里是执行删除的卡；删除随所守对象同 PR）

**`.github/workflows/`**：`codeql.yml`（B3）、`rollback.yml`（C1）删；`pr-verification.yml`（B1）、`cd.yml`（C1）重写；`agent-eval-nightly.yml` 内联 composite（D1）。

**`.github/actions/`（11 个全删）**：`coverage`、`static-quality`、`secret-scan`、`security-tool`（B1）；`agent-eval`（PR 的 L0 lane 在 B1 删，owner 已定；composite 本身在 nightly 内联时删，D1）；`cross-stack-e2e`（B4）；`build-release-unit`、`promote-release-phase`、`rollback-release`（C1，`cd.yml:73,103-210` 与 `rollback-release/action.yml:95-135` 在用到 C1 为止）；`install-atlas`（C1：过渡步与 B5 的 `db` job 都用 `ariga/setup-atlas@v0` 并以 `version:` 钉 0.30.0，composite 在 C1 就没有调用方了）；`setup`（D1，`agent-eval/action.yml:10` 用到 nightly 内联为止）。

**`.github/ci/components.json`**：C1 删（`cd.yml:47-49` 的 `route` 在用到 C1 为止；B1 只让 `pr-verification.yml` 不再读它）。

**`.github/scripts/`（108 个）**：

- 路由与计划（C1）：`change-plan.py`、`change_plan_test_support.py`、`cd-cohort-plan.py`、`component_manifest_schema.py`、`validate-component-manifest.py`、`resolve-cd-base.sh`。（B1）：`pr-verification-route.sh`、`pr-verification-gate.sh`、`pr-verification-aggregate.sh`、`resolve-secret-scan-range.sh`、`security-aggregate.sh`、`security-check-runs-canary.rb`。
- 发布与回滚（C1）：`promote-release-unit.sh`（迁移握手那 ~25 行迁到 `scripts/delivery/migrate-through-worker.sh`；Atlas 过渡步在 C1 内联、C3 删）、`download-release-cohort.sh`、`verify-release-artifact.py`、`validate-rollback-release.py`。（C1，随 `cd.yml` 不再有上传步）：`sync-edge-runtime-secrets.sh`、`edge-runtime-secrets.py`、`inject-release-web-runtime-config.mjs`、`release-web-runtime-config.mjs`。（C3）：`request-github-oidc-token.sh`。（E2）：`database-access-adopt.sh`（T-18：adopt 已执行，出处留在 runbook）。
- 工作流不变量、对等与 pin（B1）：`assert-workflow-invariants.rb`、`assert-workflow-invariants-expression.rb`、`assert-workflow-invariants.test.rb`、`assert_workflow_invariants_test_part_1.rb` … `_part_5.rb`、`assert_workflow_invariants_test_support.rb`、`actionlint-queue-contract.rb`、`run-actionlint.sh`、`ci_prepush_parity.rb`、`ci_prepush_parity_extract.rb`、`ci_prepush_parity_test_support.rb`、`ci_prepush_parity_yaml.rb`、`ci-prepush-parity-exemptions.yml`、`check-actions-pinned.sh`（+ `.test.sh`、`.test-cases.sh`）。（B4）：`check-e2e-promotion.sh`（+ `.test.sh`）、`check-web-runtime-config-payloads.sh`（+ `.test.sh`，它比对的两份 PR 侧占位配置随 B4 消失；§七 #18 的归类）。（B0，迁入 edge 包）：`check-edge-ratelimit-namespace.sh`（+ `.test.sh`）。
- `test_*` 47 个全删（决策 11），按所守的 workflow 归卡。（B1）：`test_actionlint_queue_contract.rb`、`test_ci_contract.rb`、`test_ci_contract_ruleset_migration.rb`（+ `_mutation.rb`）、`test_ci_contract_security.rb`（+ `_mutation.rb`）、`test_ci_prepush_parity.rb`（+ `.test.rb`）、`test_ci_routing_consistency.rb`、`test_codecov_patch.rb`、`test_config_read_sets.py`（+ `.lock`）、`test_dependabot_config.py`、`test_neon_test_infra_absence.rb`、`test_pr_verification_aggregate.sh`、`test_pr_verification_contract.rb`（+ `_mutation.rb`）、`test_pr_verification_route.sh`、`test_run_actionlint.sh`、`test_secret_scan_contract.rb`（+ `_mutation.rb`）、`test_security_check_runs_canary.rb`、`test_workflow_inventory.py`。（C1）：`test_cd_affected_routing_contract.rb`、`test_cd_cohort_plan.py`、`test_cd_infrastructure_safety_contract.rb`、`test_cd_skip_propagation_contract.rb`、`test_cd_worker_promotion_contract.rb`、`test_cd_workflow_contract.rb`、`test_change_plan.py`、`test_change_plan_delivery.py`、`test_component_manifest.py`、`test_database_credential_boundary.rb`、`test_migration_promotion_contract.rb`、`test_production_safety_contract.rb`、`test_promote_release_unit.sh`、`test_promotion_ac5_contract.rb`、`test_promotion_ac5_mutation.rb`、`test_resolve_cd_base.sh`、`test_retired_retention_absence.rb`、`test_rollback_edge_pair_mutation.rb`、`test_secret_provisioning_contract.rb`、`test_secret_provisioning_mutation.rb`、`test_validate_rollback_release.py`、`test_verify_release_artifact.py`、以及 #1329 / #1330 带来的 `test_cd_esc_token_source_contract.rb`。（C1）：`test_edge_runtime_secrets.py`。非 `test_` 前缀的自测随其主体：`download-release-cohort.test.sh`、`release-web-runtime-config.test.mjs`、`release-web-runtime-config.mutation.test.mjs`（C1）、`request-github-oidc-token.test.sh`（C3）、`resolve-secret-scan-range.test.sh`、`security-aggregate.test.sh`（B1）、`fixtures/`（E2 扫尾）。
- 保留：`staging-smoke-check.sh`（业务：探哪两个面、重试窗口）及其 `staging-smoke-check.test.sh`（自测随主体）。搬走（B1，到 `scripts/local-gates/`）：`check-agents-refs.sh`、`check-docs-paths.sh`、`check-root-allowlist.sh` 及各自 `.test.sh`（文档卫生，owner 定留，§七 #19）。

**`scripts/local-gates/`（39 个，E1；`pre-push.sh` 被 `pr-verification-gate.sh:78-88` source，B1 先解开 CI 侧的依赖）**：删 `pre-push.sh`、`pre-push.test.sh`、`pre-push-test-driver.sh`、`pre-push-tests-gates.sh`、`pre-push-tests-hygiene.sh`、`pre-push-tests-hygiene-url.sh`、`pre-push-tests-prereqs.sh`、`pre-push-tests-quality.sh`、`pre-push-tests-routing.sh`、`pre-push-worker-gates.sh`、`quality.sh`、`changed-packages.sh`、`changed-packages.test.sh`、`changed-packages-fixtures.sh`、`changed-packages-workspace-tests.sh`、`workspace-packages.sh`、`commit-message.py`、`commit-message.test.sh`、`shebang-exec-bit.sh`、`shebang-exec-bit.test.sh`、`stub-env.sh`、`test-stub.sh`、`pre-commit-config.test.sh`、`why-blocked.sh`、`why-blocked.test.sh`、`why_blocked.py`、`why_blocked_models.py`、`thread_tally.py`（T-10a 的孤儿，≈560 行，唯一调用方是自己的测试）、`fixtures/`。保留并改挂到包脚本（B0）：`contract-drift.sh`（+ `.test.sh`）、`eval-fixture-drift.sh`（+ `.test.sh`）、`infra-check.sh`（+ `infra-check.test.sh`、`infra-check-unauthorized.test.sh`）。保留：`oxlint-changed.sh`、`db-fresh-schema.sh`（+ `.test.sh`，只在 CI 的 `db` job 与 `make check-full`）。新增：`pre-push-affected.sh`；搬入（B1）：`check-agents-refs.sh`、`check-docs-paths.sh`、`check-root-allowlist.sh`（+ 各自 `.test.sh`）。

> E1（#1371）执行时的两处偏差，均属「先接新路径再删旧路径」：**（a）`stub-env.sh` 与 `test-stub.sh` 不删**——本表要保留的 `db-fresh-schema.test.sh`、`infra-check.test.sh`、`infra-check-unauthorized.test.sh` 三个行为测试 source 它们，删掉就是把留下的测试打断；它们是这三个测试共用的 stub 夹具，随那三个测试一起留。**（b）12 个「只有 `quality.sh` 跑」的行为测试改由 CI 的 `contracts` job 跑**——`scripts/local-gates/{db-fresh-schema,infra-check,infra-check-unauthorized,contract-drift,eval-fixture-drift}.test.sh`、`scripts/delivery/migrate-through-worker.test.sh`、`.github/scripts/{bundle-release-worker,staging-smoke-check,check-e2e-promotion}.test.sh` 与 `check-e2e-promotion.sh` 本身；全部离线、合计 <15s，`contracts` job 因此加了 `./.github/actions/setup`（`bundle-release-worker.test.sh` 要真 wrangler）。同时 `test_ci_workflow_contract.rb` 的「quality.sh 跑的契约 CI 也要跑」改成读工作树：`.github/scripts/test_*.rb` 加 `scripts/`、`.github/scripts/` 下每个 `*.test.sh` 都必须被某个 job 点名，否则契约红。`quality.sh` 里其余的 `run shellcheck` 由 pre-commit 的 shellcheck hook 去掉路径过滤（`types: [shell]` 全仓）承接。

**edge / infra / scripts（D3）**：`workers/edge/src/staging-gate/exchange.ts`、`policy.ts`、`session.ts`（267 行）及 `app.ts:9,34-36,55`、`gateway/request.ts:22-23,46,74,82-87,125-129,148` 的接线；`workers/edge/test/lane-gate-header.test.ts` 改写；`scripts/setup-staging-gate.sh`（121 行）；`infra/src/staging.ts:14-129`（注释、`validateIpEntry` / `buildIpClause` / `validateGateToken` / `buildGateExpression`、`staging-access-gate` ruleset）；`infra/Pulumi.staging.yaml:25-57` 的说明与 `stagingGateEnabled` / `stagingAllowedIps` / `stagingGateToken`。GitHub secret `STAGING_GATE_TOKEN` 随 D1 的"全删"一起走（它今天没有 workflow 读者），D3 只验证它不在了；变量 `DOORBELL_STAGING_URL`（无任何引用，map §4.6；D1）。`staging-http-config-settings`（`staging.ts:145-160`，关 BIC 与 security level）保留。

**包内读 workflow 文本的测试**（改 workflow 就红，跟着重写它的那张卡处置；E3 只做扫尾）：

| 文件 | 读什么 | 卡 | 处置 |
|---|---|---|---|
| `workers/edge/test/bundle-smoke-lane.test.ts`、`agent-db-lane.test.ts` | `pr-verification.yml` / `pr-verification-gate.sh` 的 lane 形状 | B1 | 删（流水线形状）；bundle-smoke 与 agent-db 的存在由 B0 挂进 edge `test` 的脚本保证 |
| `packages/test-postgres/test/never-bundled.test.ts` | `components.json` | B1 | 改读 `pnpm-workspace.yaml` / 各包 `package.json`（它守的是"test-postgres 不进任何 Worker bundle"） |
| `packages/contract/test/vet-gate.test.ts:29` | `pr-verification-gate.sh`（vet 用 merge base、不带 `--allow-breaking`） | B0 | 基线 + vet 逻辑进 contract 的 `test`（`vet:openapi` 已在 `package.json:28`），测试改读包脚本 |
| `apps/agent/src/animichi/tests/unit/test_ci_eval_gate_workflow.py:31` | `components.json` 的 `agent-eval` lane | B1 | 删（lane 随 B1 删） |
| `packages/test-postgres/test/image-tag-contract.test.ts` | `pr-verification.yml:226` 的镜像 tag | B2 | 改读镜像 tag 的单一来源（`packages/test-postgres` 自己导出的常量） |
| `workers/edge/test/migration-boundary.test.ts:33-54` | `pr-verification.yml` 与 `cd.yml` 的迁移边界 | C1 / B5 | 断言"迁移只经 migrator、CI 无 DSN"的那半改读 `cd.yml` 新形状（C3 后 `NEON_DATABASE_URL` 为 0 次）；lane 形状那半删 |
| `workers/edge/test/staging-baseline-reset.test.ts:93` | `cd.yml` 的 baseline reset 条件 | C1 | 删（流水线形状） |
| `workers/edge/test/auth-config.test.ts:99-107` | 三个部署文件里不得出现 `secrets.NEON_AUTH_JWKS_URL` / `secrets.CORS_ALLOWED_ORIGIN`（#1047） | C1 | 保留；只把 `paths` 缩成新的 `cd.yml`（两个 composite 没了）。`:57-66` 钉 staging var 与 production 不设的两条不动 |
| `workers/edge/test/migrator-role-isolation.test.ts:51` | `cd.yml` + `promote-release-phase` 的角色隔离 | C3 | 改读 `workers/migrator/wrangler.toml` 的 Secrets Store 绑定 |
| `packages/contract/test/oidc-github.helpers.ts` / `oidc-github.allowlist.test.ts` | 不读 workflow 文本，只是 claim 夹具：`workflow_ref` 的反例字符串 `evil.yml`、`other.yml`、`ci.yml`、`cd.yml@refs/heads/feature`（`oidc-github.allowlist.test.ts:61-82`）恰好匹配 `\.github/workflows` | — | 保留：反例需要这些字符串。不让 contract 去读 `workers/migrator/src/policy.ts`——那会把依赖方向反过来（contract 是被 migrator 依赖的一方） |
| `apps/agent/src/animichi/tests/unit/test_secrets_docs_consistency.py` | `docs/ops/secrets.md` | E3 | 整个文件删（owner 2026-09-08 定「删掉呗」，改归 E3 而非 E2）；secrets.md 同 PR 重写为「无自动守卫」，两条断言降级为人工在同一 commit 维护的纪律 |

规则：断言流水线形状的删；断言运行时契约（密钥名、identity policy、镜像 tag、OIDC allowlist）的改读它守的那个源文件（ARCH-09 与审计 A1 的方向）。表外若还有，E3 扫尾时按同一规则归类，owner 确认（§七 #20）。

## 五、波次与卡

Epic issue：**#1356**（波次图 + §七 待核清单）。每张卡的 `→ #<issue>` 标在卡号旁。

顺序：W-A → W-B（B0、B1 先，B2–B5 并行）→ W-C（C1 在 B1 之后；C3 / C4 在 C1 之后；C2 并入 C1）→ W-D（D1 在 C1 与 C3 之后；D4 在 D1 之后）→ W-E。一卡一 worktree 一 PR；`needs` 列的是硬依赖，下游卡在上游卡的 gate 证据入档后才合并。任何一张卡合入后 main 的 CI 与 CD 都必须仍然能跑，两个 required check 都必须仍然产出（评审 H1–H3、R1 的原则：先接新路径，再删旧路径）。test-type 用 `unit | integration | ci | api | browser`，其中 `ci` = 在 throwaway 分支上跑出的真实 run（§六 第 1 条），证据是 run URL；`api` = `gh api` / `wrangler` / `curl` / `grep` / `git ls-files` 的输出贴进卡。

### W-A · 前置：合并 #1329 / #1330 → #1357

PR #1329 分支上 `docs/ops/deployment.md` 的 "Pulumi state, encryption, and CI identity (#1077) → One-time migration (owner, once per stack)" 已经执行完（2026-09-05 ~06:00Z，orchestrator 操作，commit `8b757fcb5`）：`seichijunrei-infra` 与 `animichi-neon-secrets` 两个项目的四个 stack 都在 Pulumi Cloud 的 `lifeodyssey/staging` / `lifeodyssey/prod` 下，两个 staging stack 的 `pulumi preview` 在没有 passphrase 的情况下干净，`secure:` 值已按 Pulumi Cloud 的 secrets provider 重加密；R2 上的旧 state 对象不删，留作回退直到 #1081（也就是 D1 删掉 `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` 那一刻）。这一波剩下的动作：Pulumi Cloud 侧把 issuer policy 补成 personal token 形态，OIDC 探针 run 绿之后合 #1329，再合叠在它上面的 #1330。

范围里多一条 owner 的控制台动作：Pulumi Cloud 的 issuer policy 必须带一条 **token type = "personal"、user = `lifeodyssey`** 的策略（`pulumi/auth-actions` 侧对应 `requested-token-type: urn:pulumi:token-type:access_token:personal` + `scope: user:lifeodyssey`）。organization token 在个人版 org 上换不到——2026-09-05 `ci-test/pulumi-oidc-probe` 的探针 run 就是以 `401 … Org tokens are not supported for non enterprise organizations` 失败的（§3.5、§3.3 末段）。policies 端点不在我们能到的 API 上，只能 owner 在 Pulumi Cloud 控制台加。

探针的定义：`cd.yml` 只在 push main 触发，`stage-foundation` 只在 `infra` 受影响时跑，所以探针 = 在 `card/1077-pulumi-cloud-oidc` 上临时把该分支加进 `on.push.branches`（§六 第 1 条的做法），推一个只碰 `infra/**` 的空改动，看 `stage-foundation` 的日志。

- [ ] **(api)** Pulumi Cloud 的 issuer policy 里有一条 token type = `personal`、user = `lifeodyssey` 的策略（owner 控制台加），策略原文（token type / subject pattern / decision，不含任何值）贴进卡。
- [ ] **(ci)** 探针 run 的 `stage-foundation` 日志里有 `pulumi/auth-actions` 换到 **personal** token（`requested-token-type: …:personal`、`scope: user:lifeodyssey`）、`lifeodyssey/staging` 的 preview / up，没有任何 `PULUMI_BACKEND_URL` / `R2_*` / `PULUMI_CONFIG_PASSPHRASE` 的读取，也没有 `Org tokens are not supported` 的 401；run URL 记到 #1077。
- [ ] **(api)** 合入后 main 上一次 `stage-foundation` 绿；`PULUMI_BACKEND_URL` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `PULUMI_CONFIG_PASSPHRASE` / `CLOUDFLARE_PULUMI_API_TOKEN` / `NEON_API_KEY` 在 `.github/**` 里 `grep -c` 为 0（从 GitHub 删除在 D1）。

这两个 PR 带来的契约测试（`test_cd_infrastructure_safety_contract.rb` 的反转版、`test_cd_esc_token_source_contract.rb`）在 C1 随其余 `test_*` 一起删。

### W-B · CI

| 卡 | 范围 | needs |
|---|---|---|
| B0 → #1358 包脚本三件套 | 每个 workspace 包暴露 `lint`、`typecheck`、`test`（有的加 `test:integration`）；`packages/contract` 补 `lint:oxlint`（ARCH-16），其 `test` 纳入 OpenAPI 基线 + `vet:openapi`（今天 `pr-verification-gate.sh:22-29,90`），`vet-gate.test.ts` 改读包脚本；`contract-drift.sh` / `eval-fixture-drift.sh` / `infra-check.sh` / edge `test:bundle-smoke` / `check-edge-ratelimit-namespace.sh` 挂进各自的 `test`；`packages/contract/test/chat-answer-part.test.ts` 的执行挂进 edge 的 `test`（ARCH-05：它守的是 edge 的投影，只在 contract 变更时跑是错的 lane）；不改 workflow | 无 |
| B1 → #1359 `pr-verification.yml` 重写 | `plan`（pnpm ls 减根项目与 `@animichi/agent` + paths-filter `agent` / `web` / `migrations` / `deps`；`deps` = 根 `pnpm-lock.yaml` / `package.json` / `pnpm-workspace.yaml` / `.npmrc` 改动则全包运行）、`affected`（`if: packages != '[]'`；matrix；`run --if-present`；`catalog` / `edge-worker` / `@animichi/test-postgres` / `migrator` 这四个包先 `docker build` `animichi-test-postgres:18-3.6-pgvector-0.8.5`，今天 `pr-verification.yml:224-226` 那一步——catalog 的 `test` 当时是 `test:worker && test:spike`，没有镜像 spike 就红；#1473 把 spike 拆成 matrix 里自己的一步，镜像步同样在它之前）、`codecov/codecov-action` 按包 flag、六个安全 job（semgrep 只跑 `.semgrep/` 六条自定义规则 + `semgrep-raw-sql-test.sh`）+ 过渡 `codeql` job + `Security`、`docs` job（三个文档卫生脚本，先 `git mv` 到 `scripts/local-gates/`）、`PR Verification` 表达式；三个过渡 job 原样搬进新文件，B2 / B4 / B5 只改造它们、不新建——`agent`（paths-filter `apps/agent/**` + `packages/contract/**`；今天 `affected (agent)` 的 Python 步骤 + 镜像 + `make check`）、`e2e`（paths-filter `apps/web/**` / `e2e/**` / `packages/contract/**`；今天的 `cross-stack-e2e` 复合原样调用）、`db`（paths-filter `migrations/neon/**`；今天 `gate_db` 的四步内联为 run 步）；删 L0 eval lane（`pr-verification.yml:175-193`，owner 已定）；`pr-verification.yml` 不再读 `components.json` / `change-plan.py` / `pr-verification-gate.sh`，但**不删** `cd.yml` 还在用的文件（§4.2 标 C1 的那些）；删标 B1 的 composite、脚本、`test_*` 与 `quality.sh` 里对应行；处置 §4.2 表里标 B1 的四个包内测试 | B0 |
| B2 → #1360 Python 一臂 | `agent` job：paths-filter `apps/agent/**` + `packages/contract/**`；`make check`；Codecov flags `unit` / `integration`（今天 `coverage/action.yml:23-38` 的两份）；镜像构建步；`image-tag-contract.test.ts` 改读单一来源 | B1 |
| B3 → #1361 CodeQL default setup + commitlint | owner 开 CodeQL default setup；删 `codeql.yml` 与 B1 的过渡 `codeql` job；`commits` job：`commitlint --from <base> --to <head>` + PR title（title 经 `env:` 注入，不内插进 `run:`） | B1 |
| B4 → #1362 browser lane | `e2e` job：paths-filter `apps/web/**`、`e2e/**`、`packages/contract/**`；`pnpm --filter animichi-e2e test` 自己起 `wrangler dev` 与 Playwright（今天 `cross-stack-e2e/action.yml:38` 的 4 个与 `pr-verification-gate.sh:72-74` 的 7 个合一，`web-404`、`web-maplibre-canary` 两者都有，并集 9 个：`web-404`、`web-maplibre-canary`、`web-chat-anonymous`、`web-hero-query`、`web-state-ownership`、`web-a11y-axe`、`web-a11y-keyboard`、`web-a11y-states`、`web-cwv`；**落地为 10 个**，另加 `web-chat-settings-return`，见修订记录 A9） | B0、B1 |
| B5 → #1363 schema 闸 | `db` job（§4.1 `gate_db` 行）；`pre-push-affected.sh` 的 `migrations/neon` 分支 → `atlas migrate validate`；`migration-boundary.test.ts` 的 lane 半删、边界半保留 | B1 |

B1 验收：
- [ ] **(ci)** 只改 `packages/contract/src` 的 PR：`plan` 输出的包名含 `edge-worker`、`catalog`、`users`、`migrator`、`web`（pnpm `...` 的依赖方闭包），不含 `@animichi/agent`，`affected` 对每个都跑了 `typecheck`（ARCH-02 的 lane 半关闭）。
- [ ] **(ci)** 只改 `docs/**` 的 PR：`plan` 的 pnpm 步先选中根项目、减去后输出 `[]`，`affected` skipped（`if` 为假，不是空 matrix），`gh pr checks` 里 `Security` 与 `PR Verification` 都出现且绿。
- [ ] **(ci)** 只改 `pnpm-lock.yaml` 的 PR：pnpm 只选中根（`...` 不会加进任何依赖方），`deps` 为真，全包运行。
- [ ] **(ci)** 只改 `workers/catalog` 的 PR：matrix 里 `catalog` 的 `test:spike` 绿（镜像步在它之前跑）。
- [ ] **(ci)** throwaway 分支上让一个 matrix 成员故意红：`PR Verification` 红；改回来再 push：绿。
- [ ] **(ci)** PR 里放一个零熵假 token（前缀合法、正文全 A，不是真值）：`gitleaks` 红、`Security` 红、`PR Verification` 红。
- [ ] **(ci)** throwaway 分支上一个未 pin SHA 的 `uses:`：`zizmor` 红。
- [ ] **(api)** `gh api repos/lifeodyssey/animichi/rulesets/19974534` 的 `required_status_checks` 仍是 `PR Verification` 与 `Security`，未改；B1 合入后第一个 PR 的 `gh pr checks` 里有 CodeQL 的三条结果（过渡 job），`mergeStateStatus` 不是 `BLOCKED`。
- [ ] **(ci)** 只改 `apps/agent` 的 PR：过渡 `agent` job 跑；只改 `apps/web` 的 PR：过渡 `e2e` job 跑；只改 `migrations/neon` 的 PR：过渡 `db` job 跑——B1 合入后这三条 lane 没有空窗。
- [ ] **(ci)** 只改 `docs/**` 且引用一个不存在路径的 PR：`docs` job 红（`check-docs-paths.sh`）；修好后绿。
- [ ] **(ci)** PR 里加一行 `sql.raw(` 到 `workers/catalog/src` 下：`semgrep` job 红（`ts-no-sql-raw`）；`gh pr checks` 里没有 `p/python` / `p/typescript` 之类的 pack 输出。
- [ ] **(ci)** B1 合入后 main 的下一次 push：`cd.yml` 的 `route` 仍能跑（`components.json` / `change-plan.py` 还在），CD 不红。

B2 验收：
- [ ] **(ci)** 只改 `packages/contract` 的 PR 触发 `agent` job（#1323 关闭）；只改 `apps/web` 的 PR 不触发；只改 `apps/agent` 的 PR：`affected` 的 matrix 不含 `@animichi/agent`，`agent` job 跑。
- [ ] **(unit)** `apps/agent` 的 `--cov-fail-under` 与 `make check`（`Makefile:93-110`）内容不变；run 里 `codecov-action` 两步各上传一个 flag。

B3 验收：
- [ ] **(api)** `gh api repos/lifeodyssey/animichi/code-scanning/default-setup` 返回 `state: configured`，`languages` 含 `actions`、`javascript-typescript`、`python`；`git ls-files .github/workflows/codeql.yml` 为空；`pr-verification.yml` 里没有 `codeql-action`。
- [ ] **(ci)** subject 为 `wip` 的 commit：`commits` job 红；带 `Co-Authored-By: Claude …` 尾注的 commit：红。
- [ ] **(ci)** 切换后第一个 PR：`gh pr view --json mergeStateStatus` 不是 `BLOCKED`（#1204 第 1 条的观察点）。

B4 验收：
- [ ] **(browser)** 只改 `apps/web` 的 PR：`e2e` job 跑完上面那组 spec（**落地为 10 个**，A9 加了 `web-chat-settings-return`；run 日志逐个可见）。
- [ ] **(ci)** 只改 `workers/catalog` 的 PR：`e2e` skipped。

B5 验收：
- [ ] **(ci)** 只改 `migrations/neon/**` 的 PR：`db` job 跑（`atlas migrate validate`、`db-fresh-schema.sh`、migrator 测试三段都在日志里）；只改 `apps/web` 的 PR：`db` skipped。
- [ ] **(integration)** 本地只改 `migrations/neon` 后 push：pre-push 跑 `atlas migrate validate`，`docker ps` 前后一致。

### W-C · CD

| 卡 | 范围 | needs |
|---|---|---|
| C1 → #1364 `cd.yml` 重写：`plan` + 一次构建 + artifact + 并发 + 发布 + 镜像 + smoke | §3.4 骨架整体落地：`plan` 两行守卫、`build`、五段（每段 `cloudflare/wrangler-action` `deploy … --tag sha-<sha>`，发布 token 先沿用 `secrets.CLOUDFLARE_API_TOKEN`）、`smoke`（探 workers.dev 两个 URL；#1198 在此关）、`promote-production`；两个组都 `queue: max`；agent / migrator 镜像用 `docker/build-push-action`（`load: true`）→ `wrangler containers push`，一行把镜像引用写进 wrangler 配置（取代 `build-release-unit/action.yml:74-76,83-85` 与 `pin_production_worker_image` 的 sed），production 同一 tag 不 re-tag；production 的 migration 步是 Atlas 过渡步（`ariga/setup-atlas@v0` + `atlas migrate validate` / `apply` + `STAGING_ONLY_BASELINE` 守卫 + `secrets.NEON_DATABASE_URL`，逻辑照 `promote-release-unit.sh:261-269`）；没有任何运行时密钥上传步（`sync-edge-runtime-secrets.sh` / `edge-runtime-secrets.py` 删，Worker 上既有的 wrangler secret 保留到 D4）；`apps/web/wrangler.jsonc` 补 production 的 `RUNTIME_CONFIG`，删 `inject-release-web-runtime-config.mjs` / `release-web-runtime-config.mjs` 与其两个测试；删 `rollback.yml`、`rollback-release`、`validate-rollback-release.py`（C1 之后它们已经是死路径）、`install-atlas`（过渡步用 `ariga/setup-atlas@v0`）、§4.2 标 C1 的其余文件、workflow 级并发组、标 C1 的 `test_*` 与包内测试 | B1 |
| C2 → 取消，无卡（wrangler-action 的 `secrets:` 输入不用，owner 定 §七 #17；其删除项并入 C1，运行时密钥的归宿是 D4。C1 到 D4 之间这 8 个值不再从任何地方上传：Worker 上既有的 wrangler secret 原样保留，GitHub 的 8 个 secret 副本到 D1 删时已无读者） | — | — |
| C3 → #1365 迁移握手 + 生产经 migrator | migrator `/healthz` 暴露 `bundleHead`；`/migrate` 对不在 bundle 内的 `expectedHead` 答 `409 stale_bundle`；`scripts/delivery/migrate-through-worker.sh <env>`：轮询（≤12×5s）→ `core.getIDToken` → POST → 409 有界重试；migrator 加 `[env.production]`（`workers/migrator/wrangler.toml:16` 今天刻意没有）+ `MIGRATOR_DATABASE_URL` 的 Secrets Store 绑定（staging 形状在 `wrangler.toml:97-100`）+ `vars.MIGRATOR_PRODUCTION_URL`；新增**独立的** `PRODUCTION_OIDC_POLICY`（`refAllow: [{ ref: "refs/heads/main", environment: "production" }]`、`subAllow: ["repo:lifeodyssey/animichi:environment:production"]`、同一 `trustedWorkflowRefs`），由 `[env.production]` 的 var 选中；`STAGING_OIDC_POLICY`（`policy.ts:33-39`）一个字不动，两种形状永不共存于一个 allowlist（§3.5，#1055 AC）；`animichi-neon-secrets` 的 prod stack 提供 `migrator` 角色与 `MIGRATOR_DATABASE_URL`（`infra/database-access/index.ts:127-128` 今天的路径）；删 Atlas 过渡步、`request-github-oidc-token.sh`、`cd.yml` 里的 `NEON_DATABASE_URL`；处置标 C3 的包内测试 | C1；#1055 要求的 "≥3 次 staging 真实迁移证据"自 2026-08-16 起已累积，链接到卡 |
| C4 → #1366 回退 runbook 与演练 | `docs/ops/deployment.md:369-407` 回退段改 `wrangler rollback`；staging 演练一次 | C1 |

C1 验收：
- [ ] **(ci)** throwaway 分支（临时把该分支加进 `on.push.branches`）连续两次 push：第一次 `before` 是全零，`plan` 退到 `HEAD~1` 且 run 绿；第二次 `before` 是上一次的 sha。两次里 `build` 各只跑一次，`upload-artifact` 输出 `artifact-digest`；五个 `stage-*` 与 `promote-production` 的 `download-artifact` 日志里是同一个 artifact；`promote-production` 没有 `pnpm build` / `--dry-run` 步。
- [ ] **(ci)** 连续两次 push：第二个 run 的 `stage-*` 在第一个 run 停在生产审批期间跑完 staging（#1325、#1204 第 2 条关闭）；第三个 push 排在第二个后面而不取消它（`queue: max`）；owner 拒掉第一个 run 的生产门，只有它失败。
- [ ] **(ci)** 只改 `apps/web` 的 push：`stage-foundation` / `stage-migration` / `stage-services` / `stage-edge` skipped，`stage-web` 跑（#1204 第 3 条关闭）。
- [ ] **(ci)** skip 传播：人为让 `stage-migration` 红，`stage-services` / `stage-edge` / `stage-web` / `smoke` / `promote-production` 全部 skipped；同一分支上再做一次把 `promote-production.needs` 临时缩成 `[plan, build, smoke]` 的对照，记录 `promote-production` 是否被放行（§七 N3 的裁定）。
- [ ] **(api)** `diff <(tar -tvf release.tar 在 build 的列表) <(tar -tvf release.tar 在 promote-production 的列表)` 为空（两个 job 各 `tar -tvf` 一次上传为 step summary，比对贴进卡）。
- [ ] **(ci)** 只改 `apps/agent` 的 push：`stage-edge` 跑（agent+edge 配对），`stage-web` skipped；`promote-production` 的 edge 步引用与 staging 相同的 `sha-<sha>` 镜像；`wrangler containers images list` 列出 `sha-<sha>`。
- [ ] **(api)** 部署后 `pnpm exec wrangler versions list --name catalog-staging` 显示带 `Tag: sha-<sha>` 的版本（四个 Worker 各一）。
- [ ] **(ci)** `smoke` job 对两个面都 200（沿用 `staging-smoke-check.sh` 的 `healthz` + SSR shell 两探）。
- [ ] **(ci)** C1 合入后 main 的下一次带迁移的 push：production 的 Atlas 过渡步绿（路径没有断）。
- [ ] **(ci)** 主动重跑一个已被更新的 main 超过的 run：`plan` 的 head 守卫红，什么都没发。
- [ ] **(api)** `git ls-files .github/workflows/rollback.yml .github/actions/rollback-release .github/scripts/validate-rollback-release.py .github/scripts/inject-release-web-runtime-config.mjs .github/scripts/release-web-runtime-config.mjs .github/actions/install-atlas` 为空。
- [ ] **(api)** `grep -c 'secret bulk\|secrets:' .github/workflows/cd.yml` 为 0；部署后 `wrangler secret list --name animichi-staging` 仍列出 `edge-runtime-secrets.py:11-19` 的 8 个（C1 没有动它们）；`versions list` 里每次部署只多一个版本，且带 `sha-` tag。
- [ ] **(api)** `jq '.env.staging.vars, .env.production.vars' apps/web/wrangler.jsonc` 各含 `RUNTIME_CONFIG`（只有公开值）且 `grep -c VITE_` 为 0；`grep -c VITE_ .github/workflows/cd.yml` 为 0——构建期没有任何按环境不同的 `VITE_*`，同一个 artifact 两边都能用。
- [ ] **(browser)** production 的 `RUNTIME_CONFIG` 提交后，staging 与 production 的首页 SSR 各自内联了自己那份（`__root.tsx:51` 的 `<script>`），Turnstile site key 与 Neon Auth 端点按环境正确。

C3 验收：
- [ ] **(unit)** `workers/migrator`：POST `/migrate` 带不在 bundle 内的 `expectedHead` → 409 + `stale_bundle`；`GET /healthz` 含 `bundleHead`（vitest，扩现有 `create-app` 测试）。
- [ ] **(integration)** migrator 容器测试：`expectedHead` 命中 → 200 且 `appliedHead == expectedHead`（现有 Docker arm）。
- [ ] **(ci)** staging 一次带新迁移的 push：握手日志显示等到 `bundleHead == <expected>` 再 POST，无 409；#1332 关闭。
- [ ] **(api)** `pulumi stack output --stack lifeodyssey/prod`（`animichi-neon-secrets`）列出 `migrator` 角色与 `MIGRATOR_DATABASE_URL` 的 Secrets Store 项（名字，不贴值）。
- [ ] **(api)** 第一次生产迁移之前，对即将改动的每张表查 `pg_tables.tableowner`（staging 的教训：34 张表里 26 张归 `neondb_owner`，migrator 动它们必 `must be owner`，memory `project_staging_table_ownership_debt`）；结果贴进卡，非 `migrator` 所有的表先归属再迁移。
- [ ] **(api)** 第一次生产迁移经 migrator 绿，账本 head 等于期望（#1055 关闭）；`grep -c NEON_DATABASE_URL .github/workflows/cd.yml` 为 0。
- [ ] **(unit)** migrator policy：production 请求的 OIDC token 缺 `environment: production` claim → 403；`job_workflow_ref` 不是 `cd.yml@refs/heads/main` → 403（扩 `workers/migrator/src/policy.ts` 的测试）。
- [ ] **(unit)** 交叉重放（两个 policy 各一组用例）：(a) `aud`、repository、`job_workflow_ref` 全对、`sub = repo:lifeodyssey/animichi:environment:staging`、`environment: staging` 的合法 staging token 打 production policy → 403；(b) `sub` 为 ref 形式（`repo:lifeodyssey/animichi:ref:refs/heads/main`）且**无** `environment` claim → 403；(c) 反向：production token 打 staging policy → 403。注：`sub = …:environment:production` 而无 `environment` claim 的 token 经 `subAnchored` 放行是设计（`oidc-github.ts:85-87,94-96`，MED-2 的第二种完整锚），不算交叉，用例里作为对照标明。
- [ ] **(ci)** 一次性验证步（测完删）：`stage-migration` 用它自己的 staging token 额外 POST 一次 `MIGRATOR_PRODUCTION_URL/migrate` → 403，日志贴进卡。

C4 验收：
- [ ] **(api)** staging 上做一次 `wrangler rollback <上一版 id> --name catalog-staging -y` 演练，`versions list` 显示回到该版；步骤写进 `docs/ops/deployment.md`。
- [ ] **(api)** `grep -c "rollback.yml" docs/ops/deployment.md` 为 0。

### W-D · 密钥与 Access

| 卡 | 范围 | needs |
|---|---|---|
| D1 → #1367 每个 job OIDC → ESC，GitHub 零密钥 | 五段 + smoke + production + nightly 都加 `pulumi/auth-actions` + `pulumi/esc-action`，都挂 environment（§3.3 末段）；nightly 内联 `agent-eval` composite，删 composite 与 `setup`；Pulumi Cloud 的 issuer policy 从 `repo:lifeodyssey/animichi:*` 钉成 §3.5 的两个 subject（token type 保持 W-A 定的 personal / user `lifeodyssey`，不改类型），两个 GitHub environment 的 deployment branches 只允许 `main`；ESC 两个环境装 `CLOUDFLARE_API_TOKEN`、`NEON_API_KEY`、`ZEN_GO_API_KEY`（这些在 `environmentVariables` 下，进 job env）、edge 运行时 8 个名（放在 `pulumiConfig` 下、`fn::secret` 包着，**不放** `environmentVariables`：`pulumi/esc-action` 只导出 `environmentVariables` 与 `files`[^esc]，放错位置这 8 个值就会进每一个发布 job 的 env；D4 的 Pulumi 经 stack `environment:` 导入读它们）——Access 的 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` 不在 D1：值是 D3 的 `ZeroTrustAccessServiceToken` 输出，由 D3 经 `pulumi-stacks` 挂进 staging 环境（production 没有 Access 应用）；`CLOUDFLARE_ACCOUNT_ID` 改 `vars`；删 GitHub 全部 secrets（repo 20、staging 13、production 11，含四个已死的 `SUPABASE_*`、无读者的 `NEON_AUTH_JWKS_URL` / `CORS_ALLOWED_ORIGIN` / `STAGING_GATE_TOKEN`）与变量 `DOORBELL_STAGING_URL`、staging 的 `VITE_NEON_AUTH_BASE_URL` / `VITE_SHOWCASE_MODE` / `VITE_TURNSTILE_SITE_KEY`（读者随 C1 删）；删 `R2_*` 的同时 R2 上的旧 Pulumi state 失去读取方，回退窗口到此关闭（W-A）；#1081 在此关 | C1、C3 |
| D2 → #1368 ADR 0003 修订 + ADR 0006 | ADR 0003 两句作废；新 ADR 0006 记录 owner 决策 1、§二 的否决表与 §3.5 | 无 |
| D3 → #1369 staging 访问控制 = Cloudflare Access（owner 定，§七 #12） | Pulumi：`ZeroTrustAccessApplication` 罩住 `staging.animichi.com` 与 `animichi-staging` / `animichi-web-staging` 两个 workers.dev URL（N4 决定后两个是同一资源的 `destinations` 还是 runbook 里的一次 API 调用）+ identity `allow`（owner 邮箱 / GitHub）+ `nonIdentity` policy + `ZeroTrustAccessServiceToken`，其 `clientId` / `clientSecret` 经 `pulumi-stacks` 挂进 `lifeodyssey/animichi/staging` 的 `environmentVariables`（键 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` 在 D3 加；production 环境没有 Access 应用，不加）；`smoke`、e2e（`e2e/global-setup.ts:55`、`playwright.config.ts:5,45`）、本地 lane / eval（`workers/edge/api-test/lane-origin.ts:50,111-115`、`packages/eval/scripts/eval-staging.ts`）都改发两个 Access header，CI 从 ESC 取、本地 `esc env get`；删 WAF ruleset、`staging-gate/**`、`setup-staging-gate.sh`、`Pulumi.staging.yaml` 的三个键；#539 的 workers.dev 绕过随之关闭 | D1；N4 |
| D4 → #1370 edge 运行时密钥进 Secrets Store（M） | `infra/database-access` 的两个 stack 用 `environment:` 导入 `lifeodyssey/animichi/staging` / `…/prod`，8 个值以 `pulumiConfig` + `fn::secret` 进程序[^esc-iac]，声明 `cloudflare.SecretsStoreSecret` ×8（staging 与 prod 各一套，命名沿用 `AGENT_SVC_DATABASE_URL` / `_PROD` 的后缀习惯，`wrangler.toml:329-332,545-548`）；edge `wrangler.toml` 两个环境各加 8 条 `[[secrets_store_secrets]]`；读取处改经 `readStoreOrString`（`container-env.ts:172`；`CORE_NAMES` / `ANON_NAMES` 的消费点在 `container-env.ts:14-19` 与 `env.ts`）；切换后 `wrangler secret delete` 掉 Worker 上的 8 个旧 wrangler secret；`edge-runtime-secrets.py:11-19` 的名单从此只在 Pulumi 里出现一次；#1057 修正案 seat-1(a)（非 DSN 运行时密钥进 Secrets Store）由此吸收 | D1 |

D1 验收：
- [ ] **(api)** `gh secret list`、`gh secret list --env staging`、`gh secret list --env production` 三者为空；`gh variable list` 含 `CLOUDFLARE_ACCOUNT_ID`、`MIGRATOR_STAGING_URL`、`MIGRATOR_PRODUCTION_URL`，不含 `DOORBELL_STAGING_URL`；`gh variable list --env staging` 不含 `VITE_*`。
- [ ] **(ci)** `grep -c 'secrets\.' .github/workflows/*.yml` 为 0，且一次完整 staging 部署绿，nightly 一次绿。
- [ ] **(api)** `esc env get lifeodyssey/animichi/staging environmentVariables | yq 'keys'`（不贴值）恰好是 job 侧的键（`CLOUDFLARE_API_TOKEN`、`NEON_API_KEY`、`ZEN_GO_API_KEY`，D3 之后再加两个 Access 键）；`esc env get lifeodyssey/animichi/staging pulumiConfig | yq 'keys'` 恰好是 edge 运行时的 8 个名，且每个都是 `fn::secret`；两张清单与本卡的键名表逐个相等；prod 同（无 Access 键）。
- [ ] **(api)** Pulumi Cloud 的 OIDC issuer policy 原文贴进卡：token type 为 `personal`（user `lifeodyssey`），subject pattern 恰好 §3.5 的两个，没有 `repo:lifeodyssey/animichi:*`；`gh api repos/lifeodyssey/animichi/environments/staging/deployment-branch-policies` 与 `…/production/deployment-branch-policies` 的 `branch_policies[].name` 恰好 `["main"]`（今天两者都 404：没有分支限制）；`smoke` 与 nightly 的 run 日志里 `pulumi/auth-actions` 换到 token（§七 N1）。
- [ ] **(ci)** throwaway 分支上一个带 `environment: staging` 的 job：被 GitHub 的 deployment branch 规则拦下，run 日志里的拒绝原文贴进卡——这证明的是环境规则。
- [ ] **(ci)** 同一分支上一个不带 `environment`、只有 `id-token: write` 的 job 去跑 `pulumi/auth-actions`：Pulumi Cloud 拒绝（subject 是 `ref:refs/heads/<branch>`，不在 policy 里），日志贴进卡——这证明的是 issuer policy。

D2 验收：
- [ ] **(api)** `grep -c "No Pulumi Cloud dependency" docs/adr/0003-secrets-architecture.md` 与 `grep -c "stay in GitHub environment secrets" docs/adr/0003-secrets-architecture.md` 都为 0；`git ls-files docs/adr/0006-*.md` 恰一个文件，内容含 §二 表的八行与 §3.5 的三个 `aud`。

D3 验收：
- [ ] **(api)** 无 header 请求 `https://staging.animichi.com/healthz`、`https://animichi-staging.zhenjiazhou0127.workers.dev/healthz`、`https://animichi-web-staging.zhenjiazhou0127.workers.dev/` 三处都被 Access 拦（302 到登录页或 403）；带两个 header 从本地 → 三处 200。
- [ ] **(browser)** owner 经 Access 登录后 `https://staging.animichi.com/` 正常加载（截图）。
- [ ] **(unit)** `laneHeaders()` 设置 `CF-Access-Client-Id` / `CF-Access-Client-Secret`，不再设置 `x-staging-key`（改写 `workers/edge/test/lane-gate-header.test.ts`）。
- [ ] **(ci)** `smoke` 与 `e2e` 从 ESC 取 header 后绿（run 日志里 `pulumi/esc-action` 导出了 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`，值不打印）。
- [ ] **(api)** `gh secret list --env staging` 无 `STAGING_GATE_TOKEN`（D1 已删，这里只验证）；`Pulumi.staging.yaml` 无 `stagingGate*` / `stagingAllowedIps` 键；`git ls-files scripts/setup-staging-gate.sh workers/edge/src/staging-gate` 为空。
- [ ] **(api)** service token 轮换演练一次：Pulumi 重建 `ZeroTrustAccessServiceToken`，ESC 经 `pulumi-stacks` 读到新值，旧 header 对三处都被拦，新 header 200。

D4 验收：
- [ ] **(api)** `pulumi preview --stack lifeodyssey/staging`（`animichi-neon-secrets`）列出 8 个 `cloudflare:SecretsStoreSecret` 新资源，值全部标 secret；`pulumi up` 后 `wrangler secrets-store secret list --store-id 66c9bb0faef644b4a0671bb7d90d98bd` 含 8 个名（名字，不贴值）。
- [ ] **(unit)** edge：8 个键各有一条测试证明经 `readStoreOrString` 从 `SecretsStoreSecret` 绑定读出，字符串回退分支仍在（本地 `.dev.vars`）；扩 `workers/edge/test/container-env.test.ts`。
- [ ] **(ci)** 一次 staging 部署（无任何 `secret` 步）后 `smoke` 绿，并且一次匿名 chat 回合成功（模型 key 与 Turnstile secret 都来自 Secrets Store）。
- [ ] **(api)** 切换后 `wrangler secret list --name animichi-staging` 与 `--name animichi` 都不再列出这 8 个名；`grep -rn "secret bulk\|secret put" .github scripts` 为 0。
- [ ] **(api)** 轮换演练：在 ESC 改一个值（`MIMO_API_KEY` 用一个无效值）→ `pulumi up` → 下一次 chat 回合按预期失败；改回 → 恢复。

### W-E · 清理与文档

| 卡 | 范围 | needs |
|---|---|---|
| E1 → #1371 本地门禁 | `.pre-commit-config.yaml`：加两个 shebang hook、commitlint hook；`pre-push-affected.sh`（§3.2 的设计，含白名单常量与 docs 桶）；`make check-full`；删 §4.2 `scripts/local-gates` 清单；`docs/ops/local-gates.md` 重写 | B0、B1、B5 |
| E2 → #1372 残余删除与文档 | `.github/scripts` 残余（`database-access-adopt.sh`、`fixtures/`）、`.claude/rules/ci.md`（ARCH-10：它写的 `ci.yml` / `deploy.yml` / `reusable-*.yml` 从未存在）、`AGENTS.md`（`commit-message.py` 那段、harness 段的 gate 描述）、`docs/ops/deployment.md`（`:48-50,334-335,406` 仍说自动 smoke 是"deferred technical debt"，与 `post-staging` 实况相反）、`docs/ops/secrets.md`（守卫测试已随 E3 删）、`docs/DOCS_POLICY.md`、`docs/adr/0004` 的 "rebase-merge" | D1、D3 |
| E3 → #1373 包内 workflow 文本测试扫尾 | §4.2 表以外的残余按同一规则删或改读源文件 | C3、D3、E2 |
| E4 → #1374 issue 收尾 | 见 5.1 表 | 全部 |

E1 验收：
- [ ] **(unit)** `printf 'wip\n' | pnpm exec commitlint` 退出 1；`ci(delivery): y` 退出 0；带 Claude 尾注的正文退出 1（与 B3 `commits` job 同一份 `commitlint.config.js`）。
- [ ] **(integration)** 同一个只改 `workers/catalog` 的 commit，分别从 linked worktree（`.worktrees/<card>`）与主 checkout `git push`：两次 pre-push 选中的包集合相同（`catalog` 与其依赖方），日志贴进卡；`docker ps` 前后一致。
- [ ] **(integration)** 只改 `packages/contract` 后 push：pre-push 跑 `make check`（agent），且不对 `@animichi/agent` 跑 `pnpm run test`。
- [ ] **(integration)** 只改 `docs/**` 后 push：零个包、命中 docs 桶（三个文档卫生脚本跑了）、其余全在白名单，退出 0；只改一个不属于任何包也不在白名单里的路径（如新建 `tools/x.sh`）：退出 1 并列出该文件。
- [ ] **(integration)** `make check-full` 跑 Docker 套件并绿。

E2 验收：
- [ ] **(api)** `git ls-files .github/scripts` 只剩 `staging-smoke-check.sh` 与 `staging-smoke-check.test.sh`；`git ls-files scripts/local-gates` 含三个 `check-*.sh` 及其测试；`grep -c "reusable-\*\.yml\|deploy\.yml" .claude/rules/ci.md` 为 0；`grep -c "deferred technical debt" docs/ops/deployment.md` 为 0；`grep -c "commit-message.py" AGENTS.md` 为 0。

E3 验收：
- [ ] **(api)** `grep -rln "\.github/workflows\|components\.json\|pr-verification-gate" apps workers packages infra e2e --include='*.ts' --include='*.py'` 只剩 `workers/edge/test/auth-config.test.ts`（按 #1047 读新 `cd.yml`）、`workers/edge/test/migration-boundary.test.ts`（边界那半读新 `cd.yml`）、`workers/migrator/src/policy.ts`（`TRUSTED_CD_WORKFLOW` 常量里的 workflow 路径，不是注释）、C3 为它新增的测试文件（`workers/migrator/test/policy.test.ts`，同一常量的正反用例）、`packages/contract/test/oidc-github.helpers.ts` 与 `oidc-github.allowlist.test.ts`（claim 夹具，§4.2 表）；`workers/edge/src/staging-gate/policy.ts` 已随 D3 删，`test_secrets_docs_consistency.py` 已随 E3 整个删除（owner 2026-09-08 定「删掉呗」，不是改写；secrets.md 的守卫改为人工纪律）。

E4 验收：
- [ ] **(api)** 5.1 表里标"关闭"的每个 issue `gh issue view <n> --json state` 为 `CLOSED`，关闭评论引用本文与对应卡的 PR；标"owner 确认"的各有一条 owner 评论。

### 5.1 与在途 issue 的关系

| issue | 处置 |
|---|---|
| #1077 / #1078（PR #1329 / #1330） | #1077 的 stack 迁移已执行（commit `8b757fcb5`）；W-A 合入两个 PR；#1078 契约 (b)/(c) 改为"每个 job 打开自己 stage 的环境"（D1） |
| #1072 | Pulumi Cloud 的 issuer policy 在 D1 从 `repo:lifeodyssey/animichi:*` 钉成两个 subject（§3.5）；owner 确认后关 |
| #1325 并发按环境 | 被 C1 吸收（含 `queue: max`）；关闭 |
| #1323 contract 改动进 agent lane | 被 B2（paths-filter 含 `packages/contract/**`）与 E1（pre-push 的 agent 条件）吸收；关闭 |
| #1322 spike data plane readiness | 已关（PR #1324 / #1335）；本文让 Docker 套件离开 pre-push（E1），这一类 flake 不再挡 push |
| #1332 部署返回 ≠ 生效 | 被 C3 吸收；关闭 |
| #1055 生产经 migrator | 被 C3 吸收；关闭 |
| #1057 CI 零数据库凭据终局 | `NEON_DATABASE_URL` 删除与 GitHub 零密钥在 C3 / D1；修正案 seat-1(a)（非 DSN 运行时密钥进 Secrets Store）被 D4 吸收；D4 合入后关闭 |
| #1081 删迁移后的 GitHub secrets | 被 D1 吸收；关闭 |
| #1204 三条 | 第 1 条 CodeQL merge-ref → B3（default setup 后观察）；第 2 条 → C1；第 3 条 → C1；关闭 |
| #1079 doorbell 生产发布、#1080 token-free rollback、#1071 的 doorbell 半 | 与 §二 否掉的"独立晋级 workflow"冲突；建议关闭为 superseded，owner 确认 |
| #1045 残余凭据最小权限、#769 staging IP allowlist + OIDC 换票、#1054 AC5 | 被 D1 / D3 取代（#1054 的 OIDC 通道不再需要，staging 的门是 Access）；建议关闭，owner 确认 |
| #539 workers.dev 绕过 zone 闸 | 随 D3 关闭（两个 workers.dev URL 进 Access） |
| #1198 自动 smoke | `smoke` job 在 C1；关闭 |
| #1315 root→edge 改名、#1317 W4-4 | 新 `cd.yml` 从第一天用 `edge` 名（#1315 的 CD 半在 C1 完成）；B2、E1 的 agent 条款与 C1 的镜像步随 #1317 删除 |
| 审计 §7.2 B1–B9 | B1（单一来源三件）由 C1 / D4 消解——promote 循环、edge 密钥名、镜像 tag 各只剩一处；B2 由 B0 / B1 消解；B3（quality lane、孤儿）由 B1 / E1 消解；B6 的 ARCH-10 在 E2；B4 / B5 / B7 / B8 / B9 不在本文范围 |

### 5.2 与 W4 的关系

`docs/specs/2026-09-01-agent-ts-rewrite-spec.md` §五 W4 删除 `apps/agent`、uv CI 臂、容器构建与 `[[containers]]`。对应到本文：B2（`agent` job）、E1 的 `make check` 条款、C1 的 agent 镜像步、`agent-eval-nightly.yml` 整体随 #1317 删除；`stage-edge` 的 `needs.plan.outputs.agent` 条件与 `docker/build-push-action` 步同时删；`plan` 里减去 `@animichi/agent` 的那一项也随之消失。migrator 的镜像（`workers/migrator/Dockerfile`，一次性 Atlas 容器）随 Drizzle spec 消失，那之后 CD 里没有任何 docker 步，也没有"migrator 只到 staging"这条规则（C3 之后它本来就两边都到）。semgrep 同样在 W4 退役：三条 Python 规则随 `apps/agent` 删，三条 TS 规则搬进 oxlint（owner 定；oxlint 侧的形态到 W4 再定），`semgrep` job 与 pre-commit 的 `semgrep-orm` 一起删。

## 六、风险与回退

1. **GHA 编译面只能在测试分支验证。** 2026-06-24 的 `startup_failure`（reusable job 的 `permissions` 超过 caller）`ruby -ryaml` / `actionlint` / `act` 都抓不到，且不产生 check-run，只有 run 页面顶部的红色横幅可见；`secrets` context 不能出现在 `if:`（memory `feedback_workflow_compile_validation`）。做法：B1 / C1 都先推 throwaway 分支；`cd.yml` 在该分支临时把分支名加进 `on.push.branches`，跑到 staging 与生产门口（owner 拒），再合 main。zizmor 的本地等价命令是 `GH_TOKEN=$(gh auth token) uvx zizmor --persona=regular .github/workflows/`，裸 `uvx zizmor` 看不到 online audits。D1 之后两个 environment 只允许 `main` 部署，throwaway 分支上带 `environment:` 的 CD 探针会被环境规则拦下：测前 `gh api -X POST repos/lifeodyssey/animichi/environments/staging/deployment-branch-policies -f name=<branch>` 临时放行，测完删；production 环境不放行，分支上的试探到 staging 为止。
2. **"部署返回 ≠ 生效"不止 migrator。** #1332 的类别对每一对"部署 → 调用"都成立：C3 的握手按 `bundleHead` 等版本；smoke 保留 `SMOKE_ATTEMPTS=8 × 15s`（`cd.yml:251-256`）的窗口；Pulumi 建 Access 后到策略生效也是最终一致，D3 的验收在部署几分钟后再测一次。
3. **并发组：owner 定 `queue: max`。** 平台默认每组只留一个 pending，新来的把旧的取消[^gha-conc]，而 job 级组里 pending 的是 job 不是 push：五段共用 `cd-staging` 时，run A 的 `stage-services` 与 run B 的 `stage-foundation` 会交替争同一个组，被取消的可能是更新的 run，被取消的旧 run 重跑又会盖掉更新的部署。2026-05-07 起 `queue: max` 可在 `cancel-in-progress` 为 false 或未设时加上，"up to 100 queued jobs or workflow runs per concurrency group"，按序执行、不取消[^gha-queue]——owner 2026-09-05 定：两个组都加，这是对决策 5 的补充，不是替换。留下的两道处置：`plan` 的 head 守卫（`github.sha` ≠ `origin/main` 的 head 就拒绝，§3.4）挡住旧 run 的 rerun 覆盖新部署；`retention-days: 14` 之后 `download-artifact` 拿不到 artifact，超期的 rerun 直接失败关闭。守卫拒绝之后，那个 run 的 delta 只能靠一次新 push 触碰到同一单元才会再发出去——"没有部署记录基线"的代价，owner 知情。
4. **staging 的 CI 自动化门（§七 #12）。** 今天 smoke 探 workers.dev 的原因是 zone 前门对 GitHub runner IP 出 managed challenge，Free plan 不能按主机名或规则跳过（`cd.yml:245-246`、`workers/edge/wrangler.toml:420-424`）；Bot Fight Mode 文档："You cannot bypass or skip Bot Fight Mode using WAF custom rules or Page Rules"，唯一的先决豁免是 "it will not trigger if an IP Access rule matches the request first"，例外要 Super Bot Fight Mode 的 Skip 规则[^bfm]。IP Access rule 每个账户上限 50,000 条（Free / Pro / Business 相同，Enterprise 可加购），只接受 IPv4 单地址 / `/24` / `/16` 与 IPv6 `/128` / `/64` / `/48` / `/32`[^cf-ipar]；`api.github.com/meta` 的 `actions` 段今天 7,251 条（IPv4 5,625、IPv6 1,626），按允许的粒度展开（IPv4 `/16` / `/24` / 单地址，IPv6 四档）IPv4 要 141,833 条、IPv6 176,576 条，合计 318,409 条（2026-09-05 计算，与席 A 的数字一致），所以"给 runner 开 IP Access rule"不成立，CI 走 zone 主机名的预期就是被挑战。Bot Fight Mode 只在 owner 自己的 zone 上跑，workers.dev 不是这个 zone；Workers 文档说 Access "can protect one Worker's production workers.dev URL, preview URLs, or both"，做法是建一个 destination type 为 `worker` 的 self-hosted Access 应用（`POST /accounts/{account_id}/access/apps`），之后 "edit the Access application in Zero Trust"[^cf-wdev]。owner 2026-09-05 定：staging 的门就是 Access——`staging.animichi.com` 与两个 workers.dev URL 一起罩住，人登录，CI 与本地自动化带 ESC 里的 service token（决策 13 原文成立，#539 的绕过关闭）。前提是 §七 N4：workers.dev 上的 Access 应用要接受 Service Auth 的 service token。N4 失败的回退只有一条：把 `workers/edge/src/staging-gate/**` 改写成 OIDC 中间件（复用 `packages/contract/src/oidc-github.ts` 的 verifier，`aud = animichi:github-actions:staging-gate`，CI 每个 job 用 `core.getIDToken` 做 bearer、按请求校验、无会话存储），代价约 50 行 + contract tests，且 `animichi-web-staging` 要么也放一份、要么仍靠 Access，本地自动化仍要 service token。
5. **CodeQL 切换窗口。** default setup 会 "override existing code scanning configurations" 并阻止 API 上传[^cq-default]；ruleset 的 `code_scanning` 规则要求 PR 上有 CodeQL 结果，没有结果就是 `BLOCKED`（#1204 第 1 条的机制）。所以 B1 带过渡 `codeql` job，B3 在无在途 PR 的时段开 default setup 并同一 PR 删过渡 job 与 `codeql.yml`，切换后第一个 PR 观察 merge-ref 竞争是否复现。
6. **零密钥 = OIDC / ESC 故障即部署停摆；Pulumi state 的回退窗口有限。** D1 之前 R2 上的旧 state 还能用 `PULUMI_BACKEND_URL` + `R2_*` 登回去（W-A），D1 之后只剩 Pulumi Cloud 的历史。运行时不受影响（Worker、DB 在 Cloudflare / Neon，DSN 在 Secrets Store），与归档 spec 的分析一致（`docs/archive/specs/2026-08-05-secrets-centralisation-spec.md:272`）。回退 = 临时 `gh secret set` 一枚发布 token 并在 workflow 里 `secrets.` 引用，事后删。
7. **删掉的机器守卫。** skip 传播（`test_cd_skip_propagation_contract.rb`）、按阶段的密钥最小权限（`test_secret_provisioning_contract.rb`）、production 永不重建（`test_promotion_ac5_contract.rb`）、Codecov patch 95%（`test_codecov_patch.rb`）、每个 job 的 `timeout-minutes`（`assert-workflow-invariants.rb`）以后由结构（一个 `build` job、一个 artifact、`needs` 全列）、zizmor（permissions / pin）、ruleset 与评审守；不再有测试在改动时变红。owner 决策 11 接受。
8. **pnpm 图的盲区（四种）。** 目录外的改动（`migrations/neon/**`、`.github/**`）不会让 `[<ref>]` 选中包：前者有 paths-filter，后者由 zizmor / actionlint 守。根项目：`docs/**`、`.github/**`、`pnpm-lock.yaml` 的改动让 pnpm 选中根 `animichi-cloudflare-worker`，`...` 不会因此加进任何依赖方，所以根依赖文件走 `deps` 过滤器触发全包，matrix 减去根（B1）。`apps/agent`：它**是** pnpm 项目（`@animichi/agent`，`test` = `uv run pytest`），agent 改动会让 pnpm 选中它，而 runner 没有 uv、`agent` job 已经跑了同一套——matrix 与本地路由都减去它，`apps/agent` 的路由只走 paths-filter 与 `make check`。linked worktree：pnpm 在其中选不到任何包（§3.2），本地路由不能依赖 pnpm 的选包，CI 在主 checkout 里不受影响（§七 N2）。
9. **`wrangler rollback` 的边界。** 已核（C4 #1366，2026-09-07）：回退窗口是"the 100 most recently published versions"，而 `wrangler versions list` 只打 10 条且随每次部署滑动（`catalog-staging` 实测：一次新部署把最早可列版本从 2026-09-06T15:40:27Z 推到 18:54:36Z），要更早的 id 就用无 version-id 的交互模式（"select from up to 100 recent versions"）或 dashboard 的 Deployments。版本"captures the complete state of your Worker … bindings, and compatibility settings"，所以绑定声明随版本回来、绑定背后的状态（KV / R2 / DO / D1）不回来；DO class lifecycle 变更，或目标版本绑着已不存在的 R2 bucket / KV namespace / queue 时，平台直接拒绝回退[^cf-rollback]。密钥语义文档仍未写明（Secrets Store 绑定读实时值，`wrangler secret put` 自身就是一个版本），本仓库也还没有一次跨绑定变化的部署可供演练，这半条留开放。staging 演练 2026-09-07 做完（`catalog-staging` 回退到上一版再前滚，各留 `--message`；回退产生 deployment 不产生 version，`versions list` 不变），步骤落在 `docs/ops/deployment.md` 的 "## Rollback"。镜像回退 = 重发旧 tag，W4 后消失。
10. **fork PR。** 无 `id-token`，PR 工作流不用 ESC，Codecov OIDC 在 fork 上失败——与今天相同。
11. **skip 传播的护栏是 `if:`，不是 `needs`（§七 N3 已裁定）。** C1 在 throwaway 分支上人为让 `stage-migration` 红：`promote-production` 在 `needs` 全列时 skipped（run 34134624640），把它的 `needs` 临时缩成 `[plan, build, smoke]` 的对照里同样 skipped（run 34134828691，两次均 2026-09-07）。job 级 `if:` 里的 `failure()` 按文档在整条依赖链的**祖先**上求值，不只看 `needs` 里直接出现的 job。所以挡住一个红 stage 进生产的是 `promote-production` 的 `!failure() && !cancelled()` 守卫——它必须留着；`needs` 全列保留（顺序与可读性），但它不是那道护栏。

## 七、待核清单

| # | 事项 | 状态 / 查什么 / 谁定 |
|---|---|---|
| 1 | §一 ①–⑤ 的编号 | 已解：对应关系写在 §一 首段 |
| 2 | `actions/upload-artifact` "10 GB" 上限 | 开放：README 与 GitHub docs 都没写 10 GB（README 的 Limitations 只有 "Number of Artifacts" 与 "Permission Loss" 两节）；社区答案说单 artifact 5 GB。本仓库 artifact 远小于两者，不影响设计 |
| 3 | 当前 major | 开放（卡里一律 pin commit SHA）：`actions/upload-artifact` v7.0.1、`download-artifact` v8.0.1（owner 决策写 v4；不可变 / 摘要语义自 v4 起，README 说 `archive: false` 的单文件直传是 v7 能力）；`wrangler-action` v4.0.0、`pulumi/actions` v7.0.0、`auth-actions` v2.1.0、`esc-action` v3.2.0、`gitleaks-action` v3.0.0、`zizmor-action` v0.6.3、`paths-filter` v4.0.3、`build-push-action` v7.3.0、`login-action` v4.6.0、`setup-atlas` v0.3、`commitlint-pre-commit-hook` v9.26.0（`gh api releases/latest`，2026-09-05） |
| 4 | `docker/login-action` 直登 `registry.cloudflare.com` | 开放：Cloudflare 文档只给 `wrangler containers push`[^cf-img]；今天也是它（`promote-release-unit.sh:82-84`）。C1 用 build-push-action `load: true` + wrangler-action `command: containers push`，不等这条 |
| 5 | `semgrep ci` vs `semgrep scan` | 已定（owner 2026-09-05）：不注册 Semgrep、无 `SEMGREP_APP_TOKEN`；删 `p/python` / `p/typescript` / `p/javascript` 公共 pack（CodeQL default setup 覆盖），只留 `.semgrep/` 六条自定义规则（3 Python + 3 TS，#999 ORM-only 边界），`semgrep scan --config .semgrep --error`，pre-commit 已是这条命令，CI 一步（B1）；W4 后 TS 三条搬进 oxlint、semgrep 退役（§5.2）。事实依据：`semgrep ci` 不接受 `--config`（"Not supported in 'ci' mode"）[^semgrep] |
| 6 | sqlfluff "官方 action" | 已核：不存在；`sqlfluff/sqlfluff-github-actions` 是范例仓库[^sqlfluff]。B1 用 `pip install sqlfluff` + `sqlfluff lint` 一步 |
| 7 | `gitleaks-action` 的扫描范围 | 开放：README 未写 PR / push 各扫哪些 commit；读 `src/gitleaks.js` 确认 PR 走 `base..head`、push 走 `before..after`，以及 `fetch-depth: 0` 是否必需 |
| 8 | 等待审批的 run 是否占住并发组 | 已核（无官方文档）：本仓库实测（#1204 run 32772001263 / 32799575964）与社区讨论 #17401 的原话 "A second workflow run will be blocked and cannot be approved until the first workflow run is approved"[^gha-17401] 一致。设计按"占住"处理 |
| 9 | 决策 5 的补充：job 级并发组的排队语义 | 已定（owner 2026-09-05）：`cd-staging` 与 `cd-production` 都加 `queue: max`（§六 第 3 条）；head 守卫保留；守卫拒绝后的 delta 补发 = 新 push 触碰该单元，owner 知情 |
| 10 | `gh run rerun --failed` 对 cancelled job | 开放：文档只说 "Rerun only failed jobs"[^gh-rerun]；有了 `queue: max` 之后此项只剩理论意义 |
| 11 | pnpm `[<ref>]` 的语义与根文件 | 部分已核（2026-09-05 实测，pnpm 10.33.2）：`[<ref>]` 对工作树与 `<ref>` 做 diff，根 `pnpm-lock.yaml` 改动只选中根项目，`...` 不加依赖方，所以 `deps` 过滤器必需（B1）；根项目会因 `docs/**`、`.github/**` 被选中，matrix 减根；`@animichi/agent` 同样是项目，matrix 减它；全零 `before` 直接 `ERR_PNPM_FILTER_CHANGED`；linked worktree 里选不到任何包（N2）。仍开放：pnpm 源码里两点 / 三点的精确写法——PR 侧先 `git merge-base` 再传 SHA，两种都对 |
| 12 | 决策 13 的 CI 自动化那一半怎么落地 | 已定（owner 2026-09-05）：Cloudflare Access 罩住 `staging.animichi.com` 与两个 staging workers.dev URL，人登录，CI 与本地自动化带 ESC 里的 Access service token。依据：Bot Fight Mode 让 CI 走 zone 主机名的预期是被挑战，IP Access rule 数量不够（§六 第 4 条，[^bfm][^cf-ipar]）；Access 可以罩住 Worker 的 workers.dev URL[^cf-wdev]，那里没有 Bot Fight Mode。代价：ESC 里多一枚可轮换的长期凭据（默认 8760h，Pulumi 管，D3 有轮换演练 AC）。前提 N4；N4 失败的回退见 §六 第 4 条 |
| 13 | `cloudflare.ZeroTrustAccessApplication` 与 policy 的挂接形状 | 部分已核：registry 页确认 `ZeroTrustAccessPolicy.decision` 含 `nonIdentity`，`includes.serviceToken` / `anyValidServiceToken`[^pl-pol]；application 侧是 `policies` 列表还是 policy 的 `applicationId` 未查；`clientSecret` 是否标 secret 未写[^pl-st] |
| 14 | `wrangler containers images list` | 已核：wrangler 4.114.0 `--help` 列出该子命令；输出列未查 |
| 15 | `wrangler rollback` 可回退版本数与绑定语义 | 已核（C4 #1366，2026-09-07）：窗口 100 版、`versions list` 只 10 条且滑动；绑定随版本回来、其背后的状态不回来；DO class lifecycle 变更与失效的 R2 / KV / queue 绑定会让平台拒绝回退[^cf-rollback]。密钥语义无文档且本仓库无跨绑定变化的样本，这半条仍开放。演练与 runbook：§六 第 9 条、`docs/ops/deployment.md` "## Rollback" |
| 16 | CodeQL default setup 与 merge-ref 竞争 | 开放：B3 切换后观察（B3 验收第 3 条） |
| 17 | edge 运行时 8 个密钥的归宿 | 已定（owner 2026-09-05）：直接进 Secrets Store——Pulumi 经 stack 的 `environment:` 导入从 ESC 读值[^esc-iac]，声明 `cloudflare.SecretsStoreSecret` ×8，edge 绑定并经 `readStoreOrString` 读；CI 永不上传运行时密钥，wrangler-action `secrets:` 不用；独立卡 D4（M）；#1057 修正案 seat-1(a) 由此吸收。`NEON_AUTH_JWKS_URL` 不在其中（var，§3.3） |
| 18 | `inject-release-web-runtime-config.mjs` / `release-web-runtime-config.mjs` | 已定（owner 2026-09-05）：删（连同两个 `.test.mjs` 与 `check-web-runtime-config-payloads.sh`）；`RUNTIME_CONFIG` 按环境提交在 `apps/web/wrangler.jsonc` `env.<stage>.vars`（只放公开值；staging 已在 `:63-68`，production 补上），Worker 仍在请求时读（`__root.tsx:51` SSR 内联）；C1 带 AC：没有任何按环境不同的 `VITE_*` |
| 19 | `check-agents-refs.sh`、`check-docs-paths.sh`、`check-root-allowlist.sh` | 已定（owner 2026-09-05）：保留，搬到 `scripts/local-gates/`，PR 的 `docs` job（`affected` 之外一个 job）跑三条（B1），pre-push 的 docs 桶跑同三条（E1） |
| 20 | 包内读 workflow 文本的测试 | 已按卡归类（§4.2 表，含 `vet-gate.test.ts`）；表外残余 E3 扫尾，owner 确认 |
| 21 | PR 时的 L0 eval lane（`pr-verification.yml:175-193`） | 已定（owner 2026-09-05）：随 B1 删；nightly L1 继续跑到 W4 |
| 22 | 文档类 AC 的 test-type | 已解：D2 / E2 / E3 / E4 用 `(api)`（`grep -c` / `git ls-files` / `gh issue view` 的输出） |
| 23 | 合并 hook（owner 侧，决策 15；owner 当晚清单的 ⑤） | 机器外部，不开卡：`~/.claude/hooks/check-pr-comments.sh:160-216` 的"机器人时间戳晚于 head commit"规则改按内容，update-branch / rebase 不算新 diff |
| N1 | Pulumi Cloud 的 OIDC issuer policy 绑定的 subject | 部分已解：token 类型已定（2026-09-05 探针实测 + Pulumi 文档）——个人版 org 只能换 personal token（`scope: user:lifeodyssey`），policy 要带一条 token type "personal" 的策略，W-A 由 owner 在控制台加。subject 仍开放：GitHub 的 `sub` 在 job 引用 environment 时是 `environment:<name>`，否则 `ref:refs/heads/main`[^gh-oidc]；Pulumi 文档的范例是 `repo:<org>/<repo>:*`[^pl-oidc]，#1072 按它落地（owner 告知）；D1 钉成 §3.5 的两个 subject 并贴原文 |
| N2 | pnpm 在 linked worktree 里选不到包 | **已核（E1 / #1371，2026-09-08）**：上游 issue 已存在——[pnpm/pnpm#12626](https://github.com/pnpm/pnpm/issues/12626)（2026-06-24 开，仍 open），标题即「`pnpm --filter '[<ref>]'` finds no changed packages from a linked git worktree nested inside the repo」。根因在 `workspace/projects-filter/src/getChangedProjects.ts`：`find.dir('.git')` 先于 `find.file('.git')` 向上找，worktree 嵌在父仓库里时先命中**父仓库**的 `.git` 目录，改动路径被拼到错的 repo root 上，于是匹配不到任何 project。我们的 `.worktrees/<card>/` 正是「嵌套」这一种。无须新开 issue；`pre-push-affected.sh` 改用 `git diff` × `pnpm ls` 的前缀连接 |
| N3 | `failure()` 是否跨越 skipped 的 job 传播 | 已解（C1 验收第 4 条的对照实验，2026-09-07）：跨越——文档的 "returns true if any ancestor job fails"[^gha-expr] 成立，08-26 的测量与 `cd.yml` 里"只看 `needs` 里直接出现的 job"的注释不成立；两个 run 与由此得出的护栏归属见 §六 第 11 条 |
| N4 | workers.dev 上的 Access 应用是否接受 Service Auth / service token；能否用 Pulumi 建 | 开放（#12 定案的前提，D3 第一步就测它）：Workers 文档说建的是 destination type `worker` 的 self-hosted Access 应用、之后在 Zero Trust 里编辑[^cf-wdev]，self-hosted 应用的文档又说 "Domains must belong to an active zone in your Cloudflare account"[^cf-selfhosted]（workers.dev 不是账户里的 zone，所以是另一条创建路径）；要在 throwaway 上实测：建应用、加 `nonIdentity` + `serviceToken` policy、带两个 header 的 `curl` 得 200；Pulumi 侧看 `ZeroTrustAccessApplication` 有没有 `destinations`（type `worker`）输入，没有就把 `POST /accounts/{account_id}/access/apps` 那一次调用写进 runbook |

脚注（官方文档，2026-09-05 核对）：

[^gha-expr]: GitHub Docs，Evaluate expressions in workflows and actions：object filter `*`（`fruits.*.name`）与 `contains(search, item)` 对数组按元素匹配；status check functions 里 `failure()` "returns true if any ancestor job fails"。https://docs.github.com/en/actions/reference/workflows-and-actions/expressions
[^gha-conc]: GitHub Docs，Concurrency："By default only one run can be pending in a concurrency group—any additional pending runs cancel the previous one."；Control the concurrency of workflows and jobs：job 级 `concurrency`、`cancel-in-progress`。https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency · https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs
[^gha-queue]: GitHub Changelog 2026-05-07，GitHub Actions concurrency groups now allow larger queues：`queue: max`，"up to 100 queued jobs or workflow runs per concurrency group"，opt-in，`cancel-in-progress` 为 false 或未设时可加。https://github.blog/changelog/2026-05-07-github-actions-concurrency-groups-now-allow-larger-queues/
[^gha-17401]: GitHub Community #17401，Concurrency with Environment Manual Approvals："A second workflow run will be blocked and cannot be approved until the first workflow run is approved."（无官方回复）。https://github.com/orgs/community/discussions/17401
[^gh-push]: GitHub Docs，Webhook events and payloads，`push`：`before` = "The SHA of the most recent commit on ref before the push."。https://docs.github.com/en/webhooks/webhook-events-and-payloads#push
[^gh-env]: GitHub Docs，Manage environments（Required reviewers "up to 6 people or teams. Only one of the required reviewers needs to approve"）；Reviewing deployments（"If a job is rejected, the workflow will fail."）。https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments · https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/reviewing-deployments
[^gh-oidc]: GitHub Docs，OpenID Connect reference，example subject claims：`repo:octo-org/octo-repo:environment:Production`、`repo:octo-org/octo-repo:ref:refs/heads/demo-branch`、`repo:octo-org/octo-repo:pull_request`；"the subject claim includes the environment name when the job references an environment"。https://docs.github.com/en/actions/reference/security/oidc
[^gh-rerun]: gh CLI manual，`gh run rerun --failed`："Rerun only failed jobs, including dependencies"。https://cli.github.com/manual/gh_run_rerun
[^ua]: actions/upload-artifact README：immutable since v4；`artifact-digest` = "SHA-256 digest of an Artifact"；`retention-days` 1–90；"File permissions are not maintained during zipped artifact upload" → 先 `tar`；`if-no-files-found`。actions/download-artifact README：`name` / `run-id` / `github-token`。https://github.com/actions/upload-artifact · https://github.com/actions/download-artifact
[^pnpm-filter]: pnpm Filtering：`--filter "[<since>]"` "Selects all the packages changed since the specified commit/branch"，`...[origin/master]` 含依赖方；`--changed-files-ignore-pattern`。https://pnpm.io/filtering
[^pnpm-ls]: pnpm list：`--json`；"`pnpm ls --depth -1` will list projects only"；接受 `--filter`。https://pnpm.io/cli/list
[^pnpm-run]: pnpm run：`--if-present`；`pnpm run "/<regex>/"` 多脚本；`-r`。https://pnpm.io/cli/run
[^dpf]: dorny/paths-filter README：push 事件 "changes are detected against the most recent commit on the same branch before the push"；PR 事件对 base。https://github.com/dorny/paths-filter
[^wa]: cloudflare/wrangler-action README（`secrets` 段原文见 §4.1）与 `main` 分支源码 `src/wranglerAction.ts`（tag v4.0.0 下没有这个路径，引用的是 `main`；`main` 的顺序 `authenticationSetup` → `installWrangler` → `preCommands` → `uploadSecrets` → `wranglerCommands` → `postCommands`；`uploadSecrets` 在 wrangler < 3.4.0 时逐名 `secret put`，< 3.60.0 时 `secret:bulk`，否则 `secret bulk`，都带 `--env`）。https://github.com/cloudflare/wrangler-action · https://github.com/cloudflare/wrangler-action/blob/main/src/wranglerAction.ts
[^cf-vd]: Cloudflare Docs，Versions & Deployments："When you run wrangler deploy, Workers creates a new version and immediately deploys it to 100% of traffic in a single step."；"You can optionally attach a message and tag to a version when you upload it."。https://developers.cloudflare.com/workers/configuration/versions-and-deployments/
[^cf-cmd]: Cloudflare Docs，Wrangler Workers commands：`versions upload --tag/--message`、`versions list`（含 Tag）、`rollback [VERSION_ID] --name`、`deploy --dry-run --outdir`。https://developers.cloudflare.com/workers/wrangler/commands/workers/
[^cf-cp]: Cloudflare Docs，Wrangler containers commands：`containers push <TAG>` "Push a tagged image to a Cloudflare managed registry"；`containers build -t … -p`。https://developers.cloudflare.com/workers/wrangler/commands/containers/
[^cf-img]: Cloudflare Containers，Image management：`registry.cloudflare.com`；推荐 `wrangler containers push`。https://developers.cloudflare.com/containers/platform-details/image-management/
[^cf-wdev]: Cloudflare Docs，workers.dev（"Access can protect one Worker's production workers.dev URL, preview URLs, or both. You can also protect all Workers or all Worker previews in an account."）与 Cloudflare Access for Workers（destination type `worker` / `preview_worker` / `all_workers`；`POST /accounts/{account_id}/access/apps`；"edit the Access application in Zero Trust after you create it"）。https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ · https://developers.cloudflare.com/workers/configuration/cloudflare-access/
[^cf-selfhosted]: Cloudflare Docs，Add a self-hosted application："Domains must belong to an active zone in your Cloudflare account."。https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/
[^cf-ipar]: Cloudflare Docs，IP Access rules："Each Cloudflare account can have a maximum of 50,000 rules"（Free / Pro / Business 相同，Enterprise 可加购）；参数页列出的格式：IPv4 单地址、`/24`、`/16`；IPv6 `/128`、`/64`、`/48`、`/32`。https://developers.cloudflare.com/waf/tools/ip-access-rules/ · https://developers.cloudflare.com/waf/tools/ip-access-rules/parameters/
[^dbp]: docker/build-push-action README：`context` / `push` / `tags` / `load`（"shorthand for --output=type=docker"）/ 输出 `digest`；docker/login-action。https://github.com/docker/build-push-action · https://github.com/docker/login-action
[^paa]: pulumi/auth-actions README：GitHub OIDC 换 Pulumi access token；`organization`、`requested-token-type`（organization / team / personal）；需 `id-token: write`。https://github.com/pulumi/auth-actions
[^pl-oidc]: Pulumi Docs，Configuring OpenID Connect for GitHub：token 的 audience 是 `urn:pulumi:org:<org-name>`；issuer policy = token type + subject pattern + decision，文档范例的 subject pattern 是 `repo:<organization>/<repo>:*`；token 类型的版本可用性——`organization`（`urn:pulumi:token-type:access_token:organization`）Team / Enterprise / Business Critical，`team` Enterprise / Business Critical，`personal`（`urn:pulumi:token-type:access_token:personal`，配 `scope: user:<pulumi-username>`）所有版本。2026-09-05 分支 `ci-test/pulumi-oidc-probe` 的探针 run 实测：organization 类型得 `401 … policy authorization error: Org tokens are not supported for non enterprise organizations`。https://www.pulumi.com/docs/pulumi-cloud/access-management/oidc/client/github/
[^esc]: pulumi/esc-action README：`environment`（`org/project/env`）、`version`、`export-environment-variables`；把 `environmentVariables` 注入 job env；推荐 OIDC。https://github.com/pulumi/esc-action ；pulumi/actions README：`command`（up / refresh / destroy / preview / output）、`stack-name`（org 限定）、`work-dir`。https://github.com/pulumi/actions
[^esc-get]: Pulumi ESC CLI，`esc env get`："Get a value within an environment"。https://www.pulumi.com/docs/esc/cli/commands/esc_env_get/
[^esc-stacks]: Pulumi ESC，pulumi-stacks provider：`fn::open::pulumi-stacks` 的 `stacks:` 映射读取 stack outputs。https://www.pulumi.com/docs/esc/integrations/infrastructure/pulumi-iac/pulumi-stacks/
[^esc-iac]: Pulumi ESC，Use with Pulumi IaC：`Pulumi.<stack>.yaml` 的 `environment:` 列表导入环境（"Environments are merged in order, with later values overriding earlier ones."）；环境里 `pulumiConfig` 的值经 `config.get()` / `config.require()` 进程序；"Values wrapped in `fn::secret` arrive in your program as Pulumi IaC secrets"；"ESC requires the Pulumi Cloud backend"（W-A 之后满足）。https://www.pulumi.com/docs/esc/integrations/infrastructure/pulumi-iac/
[^cf-secrets]: Cloudflare Docs，Workers secrets："`wrangler secret put` creates a new version of the Worker and deploys it immediately."；"`wrangler secret delete` creates a new version of the Worker and deploys it immediately."；bulk 上传时 "Secrets not included in the file are preserved from the previous version."。https://developers.cloudflare.com/workers/configuration/secrets/
[^cq-default]: GitHub Docs，Configuring default setup for code scanning：启用路径；"default setup will disable the existing workflow file and block any CodeQL analysis API uploads"。https://docs.github.com/en/code-security/code-scanning/enabling-code-scanning/configuring-default-setup-for-code-scanning
[^cq-actions]: GitHub Changelog 2025-04-22，GitHub Actions workflow security analysis with CodeQL is now generally available：default setup 检测到 workflow 文件即自动启用 Actions 分析。https://github.blog/changelog/2025-04-22-github-actions-workflow-security-analysis-with-codeql-is-now-generally-available/
[^cq-langs]: GitHub Changelog 2023-10-23，Code scanning default setup automatically includes all CodeQL supported languages。https://github.blog/changelog/2023-10-23-code-scanning-default-setup-automatically-includes-all-codeql-supported-languages/
[^cf-st]: Cloudflare Docs，Service tokens：请求带 `CF-Access-Client-Id` / `CF-Access-Client-Secret`；"set the policy action to Service Auth; otherwise, Access will prompt for an identity provider login"；Client Secret 只显示一次；默认时长 8760h。https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/
[^cf-pol]: Cloudflare Docs，Access policies：动作 Allow / Block / Bypass / Service Auth；"Service Auth rules … enforce authentication flows that do not require an identity provider IdP login, such as service tokens and mutual TLS"；Service Token selector "Requires the Service Auth action"。https://developers.cloudflare.com/cloudflare-one/policies/access/
[^bfm]: Cloudflare Docs，Bot Fight Mode："You cannot bypass or skip Bot Fight Mode using WAF custom rules or Page Rules."；"it will not trigger if an IP Access rule matches the request first"；例外用 Super Bot Fight Mode 的 Skip 规则。https://developers.cloudflare.com/bots/get-started/bot-fight-mode/
[^pl-st]: Pulumi Registry，`cloudflare.ZeroTrustAccessServiceToken`：`accountId` 或 `zoneId`、`name`、`duration`（默认 8760h）；输出 `clientId` / `clientSecret`。https://www.pulumi.com/registry/packages/cloudflare/api-docs/zerotrustaccessservicetoken/
[^pl-pol]: Pulumi Registry，`cloudflare.ZeroTrustAccessPolicy`：`decision` ∈ allow / deny / nonIdentity / bypass；`includes` 支持 `serviceToken: { tokenId }` 与 `anyValidServiceToken`。https://www.pulumi.com/registry/packages/cloudflare/api-docs/zerotrustaccesspolicy/
[^gl]: gitleaks/gitleaks-action README：`fetch-depth: 0`；个人账号无需 `GITLEAKS_LICENSE`；`GITLEAKS_CONFIG` / `GITLEAKS_ENABLE_UPLOAD_ARTIFACT` / `GITLEAKS_ENABLE_SUMMARY`。https://github.com/gitleaks/gitleaks-action
[^zz]: zizmorcore/zizmor-action README：`persona`（regular / pedantic / auditor）、`online-audits`、`advanced-security`（false 则只打印）；上传 SARIF 需 `security-events: write`。https://github.com/zizmorcore/zizmor-action
[^atlas]: ariga/setup-atlas README：`uses: ariga/setup-atlas@v0`，`version` / `cloud-token`。https://github.com/ariga/setup-atlas
[^sqlfluff]: sqlfluff/sqlfluff-github-actions："The official resource for SQLFluff related GitHub Actions and Workflows"——范例集合，非 action。https://github.com/sqlfluff/sqlfluff-github-actions
[^semgrep]: Semgrep CLI reference（`semgrep ci` 的 `--config`："Not supported in 'ci' mode"；`semgrep scan --error`："Exit 1 if there are findings"）；Sample CI configs（`semgrep ci` 需 `SEMGREP_APP_TOKEN`，CE 用 `semgrep scan --config auto`）。https://docs.semgrep.dev/cli-reference · https://docs.semgrep.dev/semgrep-ci/sample-ci-configs
[^commitlint]: commitlint Configuration（`extends: ['@commitlint/config-conventional']`、`type-enum`、`scope-enum`、`header-max-length`）；Plugins（本地 plugin，"you can declare only one local plugin"）；alessandrojcm/commitlint-pre-commit-hook（`stages: [commit-msg]`，`additional_dependencies`）。https://commitlint.js.org/reference/configuration.html · https://commitlint.js.org/reference/plugins.html · https://github.com/alessandrojcm/commitlint-pre-commit-hook
[^commitlint-ci]: commitlint CI setup：`npx commitlint --from <base.sha> --to <head.sha> --verbose`。https://commitlint.js.org/guides/ci-setup.html
[^pch]: pre-commit/pre-commit-hooks README：`check-executables-have-shebangs`（"Checks that non-binary executables have a proper shebang"）、`check-shebang-scripts-are-executable`。https://github.com/pre-commit/pre-commit-hooks
[^cf-rollback]: Cloudflare Docs，Rollbacks："You can only roll back to the 100 most recently published versions."；"When using Wrangler in interactive mode, you can select from up to 100 recent versions."；"Resources connected to your Worker will not be changed during a rollback."；拒绝条件："A Durable Object class lifecycle change … has occurred between the version in the active deployment and the version selected to roll back to."、"If the target deployment has a binding to an R2 bucket, KV namespace, or queue that no longer exists."。Versions & deployments："A version captures the complete state of your Worker at a point in time: its bundled code, static assets, bindings, and compatibility settings."；"State changes for associated storage resources such as KV, R2, Durable Objects, and D1 are not tracked with versions."。wrangler `rollback`：`wrangler rollback [<VERSION_ID>] [OPTIONS]`，无 id 时"defaults to the version uploaded before the latest version"，`--message`"When specified, interactive prompts for rollback confirmation and message are skipped."；`versions list`"Retrieve details for the 10 most recent versions."（`-y` 不在 `rollback` 的文档选项表里，wrangler 4.114.0 的 `--help` 有 `-y, --yes`）。Secrets："`wrangler secret put` creates a new version of the Worker and deploys it immediately."。https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/ · https://developers.cloudflare.com/workers/versions-and-deployments/ · https://developers.cloudflare.com/workers/wrangler/commands/workers/#rollback · https://developers.cloudflare.com/workers/configuration/secrets/
[^core]: @actions/core README：`core.getIDToken(audience)` 取 GitHub OIDC JWT。https://github.com/actions/toolkit/blob/main/packages/core/README.md

## 修订记录：2026-09-05 席 A 评审后

| 发现 | 改动 |
|---|---|
| H1 | §4.2 每个文件标上执行删除的卡；`components.json`、`change-plan.py` 族、`cd-cohort-plan.py`、manifest 两文件、`resolve-cd-base.sh`、composite `setup` 改到 C1 删，`install-atlas` 改到 C3；B1 只让 `pr-verification.yml` 不再读它们，并加 AC "B1 合入后 CD 不红"；包内读 workflow 文本的测试改成一张按卡归属的表，E3 只做扫尾 |
| H2 | 原 C4（镜像路径）并入 C1，骨架的 `build` 注释与 `stage-*` 注释写明 wrangler-action 发布步与镜像步；C2 收窄为 `secrets:` 输入 + 删两份 sync 脚本；原 C5 → C4 |
| H3 | C1 保留 production 的 Atlas 过渡步，C3 删；C3 加两条 `(api)`：prod `animichi-neon-secrets` stack 的 `migrator` 角色与 `MIGRATOR_DATABASE_URL`；首次生产迁移前查表所有者；C3 范围写明 `policy.ts:37` 与 `[env.production]` |
| H4 | 骨架 `promote-production.needs` 与 `smoke.needs` 全列；§3.4 末段与 §七 N3 记录文档与测量的矛盾；C1 skip 传播 AC 加对照实验 |
| H5 | 复现（pnpm 10.33.2）；§3.2 pre-push 改为 git diff → 包路径 → 显式 `--filter "...<name>"`，未归属改动失败关闭；E1 加 linked worktree 与主 checkout 同集合的 AC；§六 第 8 条、§七 #11 / N2 记录 |
| H6 | 新增 B5 schema 闸：PR `plan` 加 `migrations` 过滤器 → `db` job；pre-push 的 `migrations/neon` 分支跑 `atlas migrate validate`；§4.1 加 `gate_db` 行 |
| M1 | 复现（根项目在 `pnpm ls` 里、无三件套脚本）；jq 减根；`run --if-present`；B1 AC2 / AC3 重写 |
| M2 | §3.3 末段写明 OIDC subject 两种形式与 runbook 未记录 policy；`smoke` 与 nightly 挂 `environment: staging`；D1 加 `(api)` 贴 policy 原文；§七 N1 |
| M3 | §六 第 3 条重写为 job 级组的语义；`plan` 加 head 守卫；§七 #9 改为对决策 5 的修正请求 |
| M4 | W-A 定义探针，加 `(ci)` 与 `(api)` 两条 AC |
| M5 | 复现（`ERR_PNPM_FILTER_CHANGED … bad object 0000…`）；`plan` 加全零 / 不存在 `before` 退到 `HEAD~1` 的守卫；C1 AC1 改为"连续两次 push" |
| M6 | B1 范围加镜像构建步，AC "catalog-only PR 的 `test:spike` 绿" |
| M7 | §六 第 4 条与 D3 改为 CI 留 workers.dev（第二轮 R9 / #12 再改） |
| M8 | B1 范围写明 L0 eval lane 随 B1 删，§七 #21 建议删除 |
| L1–L3 | 文件名写全；加 `never-bundled.test.ts`；B4 写全 9 个 spec 名（落地为 10，A9） |
| L4 | §4.1 `secrets:` 行改为 README 原文 + 源码顺序（第二轮 R10 再修正） |
| L5 | §3.2 写明 agent arm 的 `make check` 含离线 Docker arm |
| L6 | 加 `NEON_AUTH_JWKS_URL` / `CORS_ALLOWED_ORIGIN` 一行（第二轮 R2 改正） |
| L7 / L8 | §六 第 3 条加 `retention-days: 14` 的后果；骨架每个 job 加 `timeout-minutes` |
| AC 缺口 | D2 / E2 / E3 / E4 各加 `(api)` AC；C1 的 tar 比对改为 `diff` 为空；D1 的键名比对改为 `esc env get … | yq 'keys'` 逐个相等 |

## 修订记录：席 A 第二轮后

| 发现 | 改动 |
|---|---|
| R1 | 六个安全 job + `Security` 汇总并入 B1，外加过渡 `codeql` job（`github/codeql-action`，三语言，不门控）让 ruleset 的 `code_scanning` 规则在 default setup 打开前一直有结果；B3 收窄为 default setup 切换 + 删 `codeql.yml` 与过渡 job + `commits` job；`secret-scan` / `security-tool` / `resolve-secret-scan-range.sh` / `security-aggregate.sh` / `security-check-runs-canary.rb` 与标 B3 的 `test_*` 改到 B1 删；B1 加 AC "docs-only PR 的 `gh pr checks` 里 `Security` 与 `PR Verification` 都出现"与"合入后第一个 PR 不 `BLOCKED`"；§3.1、§4.1、§六 第 5 条相应改写 |
| R2 | 撤回第一轮 L6 的做法：§3.3 那一行改为"两个 GitHub 副本无读者，D1 删；`NEON_AUTH_JWKS_URL` 是 per-environment wrangler var（`wrangler.toml:33-39`，staging `:495`），production 刻意不设（`auth-config.test.ts:57-66`）；都不进 ESC / `secrets:`"；C2 范围与 AC 只列 8 个名并加 `grep -c NEON_AUTH_JWKS_URL cd.yml` 为 0；D1 的 ESC 键表去掉它；§4.2 表里 `auth-config.test.ts:99-107` 改为"保留，只缩 `paths`"；§七 #17 去掉一个名 |
| R3 | 复核 `apps/agent/package.json`（`@animichi/agent`，`test` = `uv run pytest`）；骨架与 §3.2 的 jq 同时减去 `@animichi/agent`；B2 AC1 加"matrix 不含 `@animichi/agent`"；E1 AC3 加"不对它跑 `pnpm run test`"；§六 第 8 条改为四种盲区 |
| R4 | `affected.if: packages != '[]'`（§3.1、§4.1、B1 范围）；B1 AC2 改为"`if` 为假，不是空 matrix" |
| R5 | D1 `needs` 改为 C2、C3；§五 顺序段同步 |
| R6 | §4.2 表加 `packages/contract/test/vet-gate.test.ts:29`（B0：基线 + `vet:openapi` 进 contract 的 `test`，测试改读包脚本）；B0 范围、§4.1 对等行同步 |
| R7 | composite `setup` 的删除改到 D1（nightly 内联时）；§4.1、§4.2 同步 |
| R8 | `rollback.yml` / `rollback-release` / `validate-rollback-release.py` / 两个 `test_*` 改到 C1 删；C4 = runbook + 演练；§3.1、§4.1、§4.2 同步 |
| R9 | §六 第 4 条的数字改为文档口径：50,000 条 / 账户（Free / Pro / Business 相同），格式限 IPv4 单地址 / `/24` / `/16` 与 IPv6 四档；`api.github.com/meta` `actions` 7,251 条（IPv4 5,625、IPv6 1,626），IPv4 按允许粒度展开 177,533 条（本文计算，与评审的 ≈318k 口径不同，结论相同）；新脚注 [^cf-ipar] |
| R10 | `secrets:` 行与脚注 [^wa]：顺序改为 `authenticationSetup` → `installWrangler`；bulk 自 3.4.0（`secret:bulk`），3.60.0 只改写法；脚注写明引用的是 `main`（tag v4.0.0 下无此路径） |
| R11 | §3.2 列出 pre-push 的白名单常量（`docs/**`、根级 `*.md`、`.claude/**`、`.github/**`、`.semgrep/**`、`.semgrepignore`、`codecov.yml`、`.pre-commit-config.yaml`、`Makefile`、`scripts/**`）；E1 AC4 对应 |
| R12 | `smoke` 只属 C1，#1198 → C1；C4 只剩 runbook 与演练 |
| R13 | `STAGING_GATE_TOKEN` 随 D1 的"全删"走（GitHub 副本无 workflow 读者，`Pulumi.staging.yaml:30` 说明过时），D3 只验证；§3.3、§4.2、D1 范围、D3 AC 同步 |
| R14 | #21 已定（随 B1 删），去掉"挂在 `agent` job"的备选 |
| R15 | #9 已定 (a)，去掉 (b) 与"步级 AC"的备注；骨架两个组都写 `queue: max`；C1 AC2 加"第三个 push 排队不取消" |
| owner #12 | 先按评审改写为 (b) vs (C) 的两选一，随后 owner 当天定 (b)：§七 #12 记为已定，D3 范围与 AC 只写 Access（三处 URL 都被拦、轮换演练），(C) 缩成 §六 第 4 条里 N4 失败时的一句回退；去掉 (a) "CI 不设门"（owner 否掉）；§二 表新增两行（否掉 CI 不设门；owner 原则"门交给平台的访问层；只有平台没有原生机制的地方才自验 OIDC"）；§3.3、§3.5、§4.1、§4.2、5.1（#539 随 D3 关）同步；新脚注 [^cf-wdev]、[^cf-selfhosted]；新 【待核】 N4 |
| 新 §3.5 | "身份与授权边界"：一个 IdP（GitHub OIDC issuer），三个 relying party 各自的 `aud` 与策略（Pulumi `urn:pulumi:org:lifeodyssey` + issuer policy、migrator `animichi:github-actions:migrator` + `policy.ts` 的 ref / environment / `job_workflow_ref`、staging gate `animichi:github-actions:staging-gate`）；#1072 的 `repo:lifeodyssey/animichi:*` 太宽 → D1 钉成三个 subject + environment 的 deployment branches 只允许 `main`，D1 加两条 AC（policy 原文、分支 run 被拒）；5.1 表加 #1072；新脚注 [^pl-oidc] |
| 【待核】 | #1 已解（编号对应写进 §一）；#9 / #21 已定；#12 改写；#17 去掉一个名；新增 N4 |

## 修订记录：owner 定案后（#5 / #17 / #18 / #19，免席 B）

| 项 | 改动 |
|---|---|
| #5 semgrep | §3.1、§4.1、B1：只留 `.semgrep/` 六条自定义规则（`semgrep scan --config .semgrep --error` + `semgrep-raw-sql-test.sh`），删三个公共 pack，无账号；B1 加 AC（`sql.raw(` 让 `semgrep` job 红、无 pack 输出）；§5.2 记 W4 后 TS 三条搬进 oxlint、semgrep 退役 |
| #17 运行时密钥 | §二 新增一行（CI 永不上传运行时密钥）；§3.3 与 §4.1 改为 Pulumi 经 `environment:` 导入从 ESC 读、`cloudflare.SecretsStoreSecret` ×8、edge 绑定 + `readStoreOrString`；wrangler-action `secrets:` 不用（README / 源码事实留作记录）；C2 取消并入 C1（C1 不再有任何上传步，Worker 上既有 wrangler secret 保留到 D4，C1 加两条 AC）；新卡 D4（M，五条 AC，含轮换演练）；D1 的 needs 改 C1、C3；5.1 表 #1057 改为"seat-1(a) 被 D4 吸收，D4 合入后关闭"；新脚注 [^esc-iac]、[^cf-secrets] |
| #18 web `RUNTIME_CONFIG` | §3.3 新增一行；§4.1 新增一行；§4.2 的注入脚本、模块、两个测试改到 C1 删，`check-web-runtime-config-payloads.sh` 留在 B4；C1 范围加"补 production `RUNTIME_CONFIG`"，加两条 AC（`wrangler.jsonc` 两个环境无 `VITE_*`、`cd.yml` 无 `VITE_*`；两边 SSR 各内联自己那份）；D1 删 staging 的三个 `VITE_*` 变量 |
| #19 文档卫生脚本 | §3.1 加 `docs` job；§3.2 pre-push 加 docs 桶；§4.1 新增一行；§4.2 改为"搬到 `scripts/local-gates/`"（B1）；B1 范围与 AC、E1 范围与 AC、E2 AC 同步 |
| 席 B | owner 免去 Codex 席；Status 改为直接签核；owner 待定项清零，§七 为最终待核清单 |

## 修订记录：席 A 第三轮后（F1–F5、L1–L10）

| 发现 | 改动 |
|---|---|
| F1 | production migrator 不再"往 `policy.ts:37` 追加形状"：C3 新增独立的 `PRODUCTION_OIDC_POLICY`（`refAllow` 只含 `{main, production}`、`subAllow` 只含 `environment:production`），由 `[env.production]` 的 var 选中，`STAGING_OIDC_POLICY` 不动；§3.5 migrator 条写明原因（`refAnchored` = `refAllow.some(...)`，`oidc-github.ts:77-83`；MED-2 `oidc-github.ts:11-18`；`policy.ts:9-10`）；C3 加两条 AC：交叉重放 `(unit)`（staging token 打 production policy → 403，反向同样）与一次性 `(ci)`（staging job 的 token POST production `/migrate` → 403） |
| F2 | B1 范围加三个过渡 job（`agent` / `e2e` / `db`，今天的步骤原样搬），B2 / B4 / B5 只改造；B1 加 AC "三种 PR 各触发对应过渡 job，无空窗" |
| F3 | D1 的 ESC 键表去掉 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`（值是 D3 的 token 输出）；D3 范围写明经 `pulumi-stacks` 挂进 staging 环境的 `environmentVariables`，production 不加 |
| F4 | D1 AC4 改引 `GET …/environments/<name>/deployment-branch-policies` 恰好 `["main"]`（今天两者 404）；AC5 拆成两条：带 `environment: staging` 的分支 job 被环境规则拦（证环境规则）、不带 environment 的 job 被 Pulumi Cloud 拒（证 issuer policy）；§六 第 1 条加"D1 之后分支探针要先临时放行 staging 的 deployment branch policy" |
| F5 | E3 `needs` 改 C3、D3、E2；E3 AC 的残留白名单改为 `auth-config.test.ts`、`migration-boundary.test.ts`、`workers/migrator/src/policy.ts`（`TRUSTED_CD_WORKFLOW` 常量） |
| L1 | §3.5 staging 条写全 `workers/edge/src/staging-gate/policy.ts:26` |
| L2 | Pulumi issuer policy 只留两个 environment subject，`ref:refs/heads/main` 删（无消费者，理由写在 §3.5）；§3.3、D1 范围与 AC、5.1 的 #1072 行、§七 N1 同步 |
| L3 | §3.5 末段改为"签名在 `jwtVerify` 里验，claims 顺序 iss → aud → repository → workflow ref → environment 锚（`oidc-github.ts:119-135`）" |
| L4 | §3.1 写明过渡 `codeql` job 不进 `Security.needs` 及原因 |
| L5 | `install-atlas` 改到 C1 删（过渡步与 B5 都用 `ariga/setup-atlas@v0`，`version:` 钉 0.30.0）；C1 范围、C1 AC、C3 范围、§4.2 同步 |
| L6 | Status 与 §二 的"两个 workers.dev URL"改为"`staging.animichi.com` 与两个 workers.dev URL" |
| L7 | C4 删掉"smoke 的验收在此记录" |
| L8 | `staging-smoke-check.test.sh` 随主体保留；§4.2 与 E2 AC 同步 |
| L9 | §六 第 4 条改为按允许粒度展开：IPv4 141,833、IPv6 176,576、合计 318,409（本文重算，与席 A 一致） |
| L10 | C2 已取消（#17 定案），改为在 C2 行写明 C1 到 D4 之间 8 个值不再从任何地方上传、Worker 既有 wrangler secret 保留、GitHub 副本到 D1 删时已无读者 |
| 顺带 | 5.1 表 "C1 / C2" → "C1 / D4"；上一节的字面标记改写，全文不再含 owner 待定标记 |
| 第四轮 F5 | E3 残留白名单再加 `packages/contract/test/oidc-github.helpers.ts`、`oidc-github.allowlist.test.ts`（`workflow_ref` 反例夹具 `evil.yml` / `other.yml` / `ci.yml` / `cd.yml@refs/heads/feature`，`oidc-github.allowlist.test.ts:61-82`，反例需要它们）与 C3 新增的 `workers/migrator/test/policy.test.ts`；§4.2 表里这两个文件的处置改为"保留：claim 夹具，不读 workflow 文本"，不让 contract 读 `workers/migrator/src/policy.ts`（依赖方向） |
| 第四轮 L-a | ESC 里 edge 的 8 个运行时密钥放 `pulumiConfig`（`fn::secret`），不放 `environmentVariables`（`pulumi/esc-action` 只导出后者，否则进每个发布 job 的 env）；D1 范围写明，D1 AC3 改为分别比对 `environmentVariables` 与 `pulumiConfig` 两张键名清单 |
| 第四轮 L-b | C3 交叉重放 AC 改为三组：environment 形式的 staging token → 403、ref 形式且无 `environment` claim → 403、反向 → 403；注明 `environment:production` 的 sub 经 `subAnchored` 放行是设计（`oidc-github.ts:85-87,94-96`） |

## 修订记录：B1 落地后（#1359 评审接受的偏离）

B1 在 draft PR #1400 的真实 run 与六个 throwaway 分支上验收；下面是与 §三 / §四 / §五 B1 行不同、且评审席接受的落地形态。后续卡（B2–B5、C1）以本节为准。

| 项 | spec 原文 | 落地形态 | 理由与证据 |
|---|---|---|---|
| A1 | §3.1 / §六 #8：matrix 减两项（根 `animichi-cloudflare-worker`、`@animichi/agent`） | 减三项，另减 `animichi-e2e`（`pr-verification.yml` `plan` 的 jq） | `animichi-e2e` 的 `test` 是起 served Worker 的 Playwright 套件，不能作为一个 `affected` 腿裸跑；过渡 `e2e` job 到 B4 前负责这条 lane。B4 落地时决定它是否回到 matrix |
| A2 | B1 行：`plan` 出 `agent` / `web` / `migrations` / `deps` 四个布尔 | 五个：加 `e2e`（`e2e/**`） | 过渡 `e2e` job 的触发条件本来就含 `e2e/**`（B4 行），B1 行漏列 |
| A3 | §4.2：47 个 `test_*` 全删；§六 #7：permissions / pin 由 zizmor 守 | 新增 `contracts` job，跑三个**新建**的脚本：`test_workflow_invariants.rb`（全部 workflow 的元不变量，**含每个第三方 `uses:` 必须是 40 位 commit、每个 `docker://` 必须带 sha256 digest** —— pin 的归属在这里，不在 CI 形状那份）、`test_ci_workflow_contract.rb`（新 CI 形状、跑 `.mjs` 的 job 必须先 `./.github/actions/setup`）、`test_package_test_segments.rb`（B0 交接的 lane 段清单）。原 47 个里标 B1 的已全部删除 | 实测 zizmor 1.5.2 默认 persona 对未 pin 的 `dorny/paths-filter@v4` **零发现**；改 `persona: pedantic` 后发现（exit 12）。只靠 zizmor 退役 `check-actions-pinned.sh` 是回退，所以 pin 由 contract 测试守、zizmor 作第二道 |
| A4 | §4.1：标 C1 的 CD 契约测试到 C1 才动 | 标 C1 的七个 ruby（`test_secret_provisioning_*`、`test_production_safety_contract`、`test_promotion_ac5_*`、`test_cd_worker_promotion_contract`、`test_cd_esc_token_source_contract`）与两个 `.mjs` 自测在 `contracts` job 暂住到 C1 | 它们今天由被删的 `static-quality` job 跑；B1 删了那个 job，不能让它们在 C1 之前失去 CI 家 |
| A5 | §4.1：zizmor-action 默认参数，persona `regular` | `version: "1.5.2"`、`persona: pedantic`、`annotations: false` | 1.5.2 不认 `--format github`（`annotations: true` 时 action 会传它）；1.30.0 认，但其 `self-repository` 审计对 `cd.yml` / `rollback.yml` 报 16 条 low，不属 B1——升级随 C1 之后另开卡（#1425） |
| A6 | B1 行：三个过渡 job 各按自己的 paths-filter 触发 | 另加 `deps == 'true'` 也触发（`agent` / `e2e` / `db` 的 `if:`） | 根依赖文件改动时 fail-safe，与 `affected` 全包运行同一语义 |
| A7 | （新增 job，spec 无对应） | `contracts` job 先 `./.github/actions/setup` 再跑脚本 | `release-web-runtime-config.test.mjs` 会 spawn 被测脚本，后者 import `jsonc-parser`（`apps/web` 依赖，hoisted 布局下只在根安装后存在）；首个真实 run 就是这样红的 |
| A8 | B1 验收：「零熵假 token（前缀合法、正文全 A）：`gitleaks` 红」 | 探针改为**随机样、无效**的 token（`ghp_` + 36 位混合大小写与数字、无校验和、不含字母表序列） | 零熵探针永远不会红：gitleaks 8.24.3 的 `github-pat` 规则带 `entropy = 3`（`config/gitleaks.toml`），第一次 throwaway（全零正文）扫了 1 个 commit、"no leaks found"。第二次用 `B1canary` + 字母表序列做正文（熵 4.95）仍不红：全局 `allowlist.stopwords` 含 `abcdefghijklmnopqrstuvwxyz`，大小写不敏感命中。本地 gitleaks 8.30.1 五种变体实验后定为随机样正文。这也是仓库里 fixture token 一直用零熵串的原因——同一条规则，反过来用 |
| A9（B4） | B4 行：browser lane 并集 **9** 个 spec | **10** 个：另加 `web-chat-settings-return`——B1 的过渡 `e2e` job 实际跑 10 个，第 10 个不在 B4 行所并的两份清单里（那两份早于它） | 少跑一个是覆盖回退；清单以 `e2e/package.json` 的 `test` 与 `test_package_test_segments.rb` 的 e2e 段为准 |
| A10（B4） | §4.2 第 252 行：`check-e2e-promotion.sh`（+ `.test.sh`）标 B4 删除 | 保留 | 它守的是 `e2e/generated/`、`e2e/agent-discovered/` 下不得提交 `*.spec.ts`（测试代理产物的晋级规则，`docs/testing-strategy.md`），不是流水线契约的复制品；无替代物就删是回退 |
| A11（B4） | （检查名） | `e2e` job 的检查名由 B1 的 `CI / cross stack` 改为 `CI / browser` | ruleset 只要求 `PR Verification` / `Security`，汇总 job 引用 job id `e2e`，改名无阻断；旧名残留只在 C1 要删的 `components.json` / `test_change_plan.py` 与 E 波要扫的 `docs/ops/deployment.md` |
| A12（B2） | §五 B2 行第 268 处：`image-tag-contract.test.ts` 改读单一来源 | 该测试**删掉**读 workflow 的那一例，只留读单一来源与三个同语言消费者；镜像 tag 漂移改由 `test_ci_workflow_contract.rb` 覆盖 | 那条 ruby 断言遍历**每一个** job，agent（source 形式）、`affected` matrix（字面量）、`db`（字面量）三处漂移都变红（逐条变异验证）。它比对的是声明本身而非副本，所以覆盖没丢，归属更干净 |
| A13（B2） | （Makefile 未在 spec 范围内） | `Makefile:76-77` 的 `test-integration` 由 `--no-cov` 改为 `--cov-report=xml:coverage-integration.xml --cov-fail-under=0`；`make lint` 由 `ruff check src/animichi/ scripts/` 改为 `ruff check .` | 前者：spec 同时要求「`make check` 作为唯一命令」与「两个 Codecov flag」，而集成臂原本不产出报告，两者不可兼得。`make check` 的构成与单测臂的 87 下限一字未动。后者：改用 `make check` 后 CI 的 ruff 范围由整棵树缩到两个目录，`conftest.py`、`pyproject.toml` 与一个 fixture 录制脚本失去全部 CI lint 覆盖（`--show-files` 592→589），属回退，已改回并核对文件集合相同 |
| A14（B2） | §4.2：B1 的 `test_*` 全删后不再新增 | 新增 `.github/scripts/test_agent_lane_contract.rb`（166 行），承载 agent lane 的断言 | 把这些断言并进 `test_ci_workflow_contract.rb` 会让它到 315 行、越过 ≤300 的文件上限；按主题拆分符合该目录既有惯例（`test_cd_esc_token_source_contract.rb` 等），且比删注释凑行数诚实。已接进 `contracts` job 与 `quality.sh` |
| 保留 | B1 行：删 L0 eval lane | 已删 | owner 定 |

证据：#1400 的 run（六个 affected 腿 + `agent` / `e2e` / `db` 过渡 job + 六个安全 job + 过渡 `codeql` + `Security` / `PR Verification`）；throwaway：docs-only 无 affected 腿且三个过渡 job 全跳过，deps-only 全包（含 `infra`，证明 Pulumi CLI 供应）。B1 验收清单里的 (ci) 项在 #1359 逐条附 run 链接。
