# Platform features over a hand-written pipeline: the rejected alternatives and the CI identity boundary

> **Status**: accepted — owner sign-off 2026-09-05 (grilling the same evening; decisions 1–16 are
> owner's). Recorded by **#1368** (card D2 of the CI/CD redesign, Epic **#1356**). Source of the
> decisions: `docs/specs/2026-09-05-cicd-redesign-spec.md` §二 (rejected alternatives), §3.5
> (identity and authorisation boundary), §五 W-D. This ADR amends
> `docs/adr/0003-secrets-architecture.md`: 0003's "No Pulumi Cloud dependency" and "CI-only values
> stay in GitHub environment secrets" premises are retired here; its runtime half — Pulumi composes
> the DSN and writes it into Cloudflare Secrets Store — stands unchanged (decision 12).

Delivery selection and queue semantics are amended by [ADR 0007](0007-selected-release-artifacts.md):
main pushes build complete snapshots; the sole trusted controller selects an existing artifact ID.
The original decisions below remain the historical rationale for the platform-native principle.

The delivery lane had grown into a second product. Measured at spec time: `.github/actions` 11
composite actions / 851 lines, `.github/scripts` 108 files / 10,586 lines, `scripts/local-gates` 39
files / 4,559 lines, five workflows / 949 lines. Under a hundred of those lines are business rules
(agent and edge ship together, migrator only reaches staging, the migration handshake, which two
surfaces smoke probes); the rest re-implements things GitHub, Cloudflare and Pulumi already ship —
affected-package routing written three incompatible times, a `route` job that runs seven contract
tests on itself before it can plan, 47 `test_*` scripts guarding copies against their own copies.
The same sprawl produced the authorisation drift: two hand-written OIDC verifiers plus a WAF token,
each a door we wrote ourselves.

## Decision

**Owner decision 1**: 平台或官方 action 有的功能不自己写；自己写的只剩业务规则 — where the platform
or an official action already provides a capability, we do not write our own; what stays
hand-written is business rules only. This governs the whole redesign, and it is the tie-breaker
whenever a hand-written mechanism would be "just a few lines".

### Rejected alternatives (§二, owner's wording of 2026-09-05, verbatim)

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

Unchanged by this ADR: required checks stay `PR Verification` and `Security`, the ruleset is not
touched (decision 8); the "runtime DSN written by Pulumi into Secrets Store" half of ADR 0003 stands
(decision 12).

### Identity and authorisation boundary (§3.5)

There is exactly one identity provider: GitHub Actions' OIDC issuer
(`https://token.actions.githubusercontent.com`, `packages/contract/src/oidc-github.ts:26`). It
proves *which repository, ref, environment and workflow file is running* (`sub`, `ref`,
`environment`, `job_workflow_ref`); it does not prove *what may be done*. Authorisation belongs to
each relying party, and each one owns two things: an `aud` that is only its own, and its own policy.

| relying party | `aud` | who authorises, and how |
|---|---|---|
| Pulumi Cloud | `urn:pulumi:org:lifeodyssey` | Pulumi Cloud's issuer policy. `pulumi/auth-actions` exchanges the job's OIDC identity for a **personal** token (`requested-token-type: urn:pulumi:token-type:access_token:personal`, `scope: user:lifeodyssey`, `.github/workflows/cd.yml:295-300`) — `lifeodyssey` is an individual-edition organization and Pulumi Cloud rejects organization tokens for non-enterprise organizations. The policy is being pinned from `sub: repo:lifeodyssey/animichi:*` to the two environment subjects `repo:lifeodyssey/animichi:environment:staging` and `…:environment:production` (D1, #1367), with both GitHub environments' deployment branches restricted to `main`. |
| migrator Worker | `animichi:github-actions:migrator` (`workers/migrator/src/policy.ts:21`) | The Worker verifies the token itself: staging requires `ref == refs/heads/main`, `environment == staging` and `job_workflow_ref == lifeodyssey/animichi/.github/workflows/cd.yml@refs/heads/main`. Production uses a separate `PRODUCTION_OIDC_POLICY` with only production shapes (C3, #1365): `workers/migrator/src/policy.ts` declares both allowlists and `policyFor` picks between them on the `MIGRATOR_OIDC_POLICY` var, so production migrations go the same way staging does — `scripts/delivery/migrate-through-worker.sh production` (`cd.yml:716`), with no database credential in CI at all. It must never be appended to the staging allowlist, because `refAnchored` is a `some()` over `refAllow` and one mixed allowlist would let a staging-minted token through the production door (MED-2). |
| staging | none — **staging 不自验** | The door is Cloudflare Access, a platform access layer: people log in through an identity policy, CI and local automation present a service token (decision 13). The hand-written staging-gate verifier (`aud = animichi:github-actions:staging-gate`, `workers/edge/src/staging-gate/policy.ts:26`) is deleted with D3 (#1369). |

Owner's rule behind that third row: **门交给平台的访问层；只有平台没有原生机制的地方才自验 OIDC** —
give the door to the platform's access layer, and self-verify OIDC only where the platform has no
native mechanism. Pulumi Cloud has native GitHub OIDC federation, so we use it. Workers have no
federation mechanism, so the migrator verifies for itself. Staging has Access, so it stops
verifying.

A token minted for one `aud` is refused at every other door — the signature is checked in
`createGitHubOidcVerifier`'s `jwtVerify`, and the claims are asserted in the order `iss` → `aud` →
repository → workflow ref → environment anchor (`packages/contract/src/oidc-github.ts:119-135`). So
the two self-verified doors cannot cross-accept, and GitHub's only job is to say who the caller is.
People are not on this line at all: people go through Access's identity policy.

## Why

- The hand-written surface was not free: it produced the incidents that started this redesign
  (a production approval holding the whole CD concurrency group; a deploy that returned before the
  new bundle served; three routers disagreeing; a local pre-push that needs Docker).
- Every hand-written door is a policy that has to be re-derived, tested and kept in sync by us.
  Platform doors (GitHub environments, Pulumi Cloud's issuer policy, Cloudflare Access) come with
  their own audit trail and their own enforcement.
- One `aud` per relying party is what keeps "who is calling" separable from "what they may do";
  it is also what makes the staging door removable without touching the other two.
- Recording the rejected alternatives is the point of this ADR: each was considered and refused with
  a reason, and re-proposing one costs a new ADR rather than a new argument.

## Consequences

- ADR 0003's two retired premises are marked there and replaced. The #1077 half is fact: Pulumi
  Cloud is the state and `secure:` encryption backend for all four stacks (merged as PR #1329,
  `815666995`). The ESC half is pending: #1078 (PR #1330) moves CI-consumed values off GitHub
  environment secrets, and until it lands `pulumi/esc-action` appears nowhere under `.github/`
  while `cd.yml` still carries 37 `secrets.` references (`docs/ops/deployment.md:365-366`).
  Emptying the three `gh secret list` scopes is D1's (#1367) acceptance target.
- Pulumi Cloud's issuer policy, the two GitHub environments' deployment-branch rules and the ESC
  environments are the authorisation surface to audit; D1 (#1367) pastes the policy text into its
  card as acceptance evidence.
- `workers/edge/src/staging-gate/**`, `scripts/setup-staging-gate.sh`, the WAF ruleset and the
  `stagingGate*` keys go away with D3 (#1369); the staging-gate `aud` retires with them. It returns
  in middleware form only if the Access design fails its open question §七 N4 (§六 item 4).
- New hand-written CI machinery needs a reason that names the platform gap it fills; "the platform
  can do this" is a sufficient objection on its own.
- Supersedes nothing wholesale. It amends ADR 0003 and constrains every later CI/CD change.
