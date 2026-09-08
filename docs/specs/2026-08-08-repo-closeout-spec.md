# Repo Close-Out Campaign (2026-08-08)

- Status: ACTIVE (owner-approved plan; supersedes per-wave ordering of `2026-08-06-repo-restructure-spec.md` and `refactor-skeleton-2026-08/GOAL.md`)
- Tracking: this spec + GOAL checkboxes + restructure §5 checks; ADRs 0003/0004/0005 record the architecture decisions
- Definition of done: GOAL W0–W8 `[x]` · restructure §5 verification green · issues #829/#845 closed

## Confirmed decisions

1. One merged campaign (ADR 0004); waves ordered by dependency, not document numbering.
2. Branch discipline (ADR 0005): merge-based updates, GitHub squash-merge (the ruleset's `allowed_merge_methods`, amended from rebase on 2026-08-08 — the same day as this spec), force-push banned on all branches except owner-authorized rewrite windows.
3. W1 docs/ reorg uses a **fresh inventory** of the current tree, not the 08-06 mapping.
4. Secrets architecture (ADR 0003): Neon-hosted role passwords, Pulumi `neon.Role` IaC, Cloudflare Secrets Store for worker runtime, connection strings composed by Pulumi, GitHub secrets only for CI-consumed values.
5. IaC stack is Pulumi only (no Terraform; Neon via bridged provider).
6. Deferred: Harness rebuild (#827), landing go-live. In scope: production domain activation + SEO validation, W8 daily-squash.
7. Sourcery reviews PRs via the GitHub App (installed); not a local hook.

## Waves

### P0 — Gates and base discipline

- Two-path comment gate backfill: #901 (2 threads), #902 (4 threads) — inline reply → resolve → top-level 线程判定 → merge.
- Local hooks rework (design: `docs/ops/local-gates.md`): changed-package routing, fast pre-commit, medium pre-push; integration tests stay in CI (Neon/browser environments).
- Ruleset: `non_fast_forward` + `deletion` on all branches, bypass = owner.
- Merge #902 (hooks) after gate; then merge #901 (migration chain rebuild).
- Acceptance: zero unresolved threads on #901/#902; hooks green on a populated worktree; ruleset listed.

### P1 — Documentation and docs/ reorg

- Matt-skill docs: ADR 0003/0004/0005 (written); campaign spec (this file); hook design (`docs/ops/local-gates.md`); merge as one docs PR.
- W1 docs/ reorg: fresh inventory → `git mv` (superpowers specs → `docs/specs/` + archive buckets) → reference rewrites (scripted, enumerated by `git grep`) → DOCS_POLICY map/pointer update → zero-check (`git grep docs/superpowers` = 0; `docs/adr/` stays canonical — ADRs 0003-0005 are registered in DOCS_POLICY/CONTEXT-MAP and are not a legacy path).
- W0 remainder: GitHub deployments record sweep (inactive → DELETE, admin token), `.codacy.yml` path verification, `.gitignore` + `.DS_Store`.
- Restructure §4 verification leftovers: deno.lock discovery, sqlfluff upward discovery, Sonar config file, zero-ref specs, `make dev-local` wrangler dependency, `git filter-repo --analyze` blood report, R2 image-link form.
- Acceptance: zero grep hits on legacy paths; DOCS_POLICY map matches the tree; verification table with conclusions.

### P2 — Edge ownership

- Root `package.json` purification: runtime deps (hono/jose/…) + `test:worker` → `workers/edge/package.json`; root keeps orchestration.
- `workers/edge/AGENTS.md` (the only package without one) + root AGENTS.md layout row.
- Edge `src/` layout: remaining flat files → `src/` + `test/`; update the four file-pins (`auth.ts`, `turnstile.ts`, `containerEnv.ts`, `migrationBoundary.test.ts`) with mutation probes; READS + read-set sync; `node --test` green under the new layout.
- Acceptance: staging deploy green with `/healthz` + smoke.

### P3 — Workspace and config placement

- `infra` into pnpm workspace (drop `infra/pnpm-lock.yaml`, root lockfile absorbs, CI infra install path updated).
- `docker/test-postgres` → `apps/agent/docker/`; `fixtures/vision` into agent test tree; `spikes/` removal check; `atlas.hcl` → `db/`; `.sqlfluff` → `db/`; `deno.lock` verification; `apps/agent` stub `package.json`; `.gitignore` re-anchor.
- Acceptance: workspace install green; config discovery verified.

### P4 — Secrets re-architecture

- Pulumi `neon` stack: `neon.Role` ×4 (import existing roles; passwords Neon-generated) → compose connection strings → write Cloudflare Secrets Store (wrangler/API, once, not readable back).
- `wrangler.toml` Secrets Store bindings for catalog/users/jobs/edge; remove `wrangler secret bulk` steps and GitHub `*_DATABASE_URL` secrets; delete `scripts/staging-roles-login.sh`.
- `STAGING_GATE_TOKEN` value cross-check vs Pulumi `stagingGateToken`; staging deploy chain validation (#826 close-out).
- Acceptance: staging deploy green; secrets hash rows in deploy report; zero `*_DATABASE_URL` GitHub secrets.

### P5 — Meta-gate and production DSN

- New meta-check: every `docs/`-prefixed string in tracked files resolves (agnix-adjacent job).
- #855: production least-privilege DSNs via the P4 stack (production is an empty data plane today; cutover at owner window).
- Acceptance: meta-check in CI; prod wiring documented.

### P6 — Production domain + SEO

- Pulumi prod stack: `webDomain=animichi.com` + `webRoutesEnabled=true` (activation confirmed with owner; DNS/apex on the Cloudflare account).
- SEO validation: sitemap/robots/og/jsonld/hreflang/IndexNow live on the apex; Lighthouse lane green.
- Acceptance: apex serves the web app; SEO probes 200.

### P7 — History rewrite window (single force-push day)

- Pre-fix #494 (healthz `git_commit` always "unknown" — bake build info).
- Freeze main → double backup (bundle + private archive repo) → daily-squash (#857 script, ~1820 → ~98 commits) → `git filter-repo` binary strip (blood report from P1) → owner-bypass force-push → CI green + staging re-deploy → `main-legacy` ≥30 days.
- Acceptance: tip tree unchanged vs pre-rewrite; CI green; staging `/healthz` git_commit matches.

### P8 — Close-out

- Small debts: `workers/maintenance/CONTEXT.md` missing (post-#836), `check-skeleton-w0-docs.sh` failure, staging empty `atlas_schema_revisions` schema, tsx-dependent tests.
- GOAL checkboxes W2/W6/W7/W8 + change log; restructure §5 full verification; issues #829/#845 closed; both clones aligned; worktrees pruned.

## HITL stops

| Wave | Stop |
|---|---|
| P4 | Secrets Store availability check; Neon password confirm; gate-token cross-check |
| P6 | Production domain activation + apex DNS confirmation |
| P7 | Freeze declaration + force-push authorization (owner bypass) |
| P8 | #829/#845 close confirmation |

## Verification (per wave)

Each wave runs its subset; P8 runs the full restructure §5 list (check-agents-refs, test-docs, test:worker, read-set, link check, double-zero grep, `make check`, required-lane positive assertion, staging `/healthz` + smoke).
