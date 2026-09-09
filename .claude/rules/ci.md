---
paths:
  - ".github/workflows/**"
---
# GitHub Actions authoring rules

Three workflows, no reusables and no composites: `pr-verification.yml` (`pull_request` +
`merge_group`), `cd.yml` (push to `main`), `agent-eval-nightly.yml` (cron). #1364 and #1367 wrote
the last shared steps out into the jobs that run them, so the step you are looking for is in the
file you are editing — there is no layer above it and no `uses: ./…` to follow.

- **`pr-verification.yml` is lanes behind two required contexts.** `plan` picks the affected
  workspace packages with pnpm's dependent-closure filter and `affected` runs each one's own
  package scripts as a matrix; beside them sit the `contracts`, `docs`, `agent`, `e2e`, `db` and
  `commits` lanes and the security jobs. `security` and `aggregate` run `always()` and fail on a
  failed or cancelled dependency — they are the two contexts the ruleset requires, so a new lane
  only gates anything once it is one of their `needs`.
- **`cd.yml` is `plan` → `build` → five staging stages → `smoke` → `promote-production`.** One
  build produces one `release-<sha>` artifact and every later job publishes those same bytes; a
  stage runs only when its pairing rule selects it, and the single `production` environment
  approval sits in front of the last job. A push to `main` is the only trigger — no tag, no
  `workflow_dispatch`, no deploy from a workstation.
- **A check no job invokes is a check nothing runs.** Every `test_*.rb` beside these workflows,
  every `*.test.sh` under `scripts/` and `.github/scripts/`, and every other file in
  `.github/scripts` has to be named by a `run:` line after an interpreter.
  `test_ci_workflow_contract.rb` checks exact invocation paths in both directions: committed
  checks must run, and invoked repository scripts must exist. `test_workflow_invariants.rb`
  also catches orphaned files that no invoked script requires. Add or remove a check and its
  invocation in the same change.
- **Pin every third-party action by full 40-char commit SHA** + a trailing `# vX.Y.Z`; never a
  floating tag or branch, and never a `docker://` image without a `sha256:` digest. A `./`-prefixed
  `uses:` must name a composite that is actually in the tree.
- **No `continue-on-error`, anywhere.** `test_workflow_invariants.rb` rejects the string outright;
  the warn-only exception this file used to grant died with the `agnix` lint it was written for.
- **Least privilege**: the workflow default is exactly `contents: read`, widened per job. Every job
  declares `timeout-minutes`. A job that asks Pulumi Cloud for a token must also declare an
  `environment:`, or its OIDC subject is a shape the issuer policy does not list and the exchange
  fails at deploy time rather than in review.
- **Nothing reads a GitHub secret** — not `${{ secrets.X }}`, not `secrets: inherit` (#1367). Every
  credential is opened from Pulumi ESC with the job's own OIDC identity, and each opened name gets
  a one-line emptiness guard, because `pulumi/esc-action` only warns on a missing value and exits
  0.
- **Run what a workflow change actually reaches before claiming it is valid**: `actionlint` on the
  touched files, then the Ruby contracts (`ruby .github/scripts/test_*.rb`) and
  `pnpm run test:worker` — several `workers/edge/test/*.test.ts` assert on workflow text (migration
  boundaries, container env, JWKS mappings) and actionlint cannot see any of that. Lesson: #751
  merged green on 5 gates and still broke `main`'s worker tests.
