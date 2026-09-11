---
paths:
  - ".github/workflows/**"
  - ".github/actions/**"
  - ".github/test/**"
  - ".github/lib/**"
  - ".github/scripts/**"
  - "test/repo-config/**"
---
# GitHub Actions authoring rules

The entry workflows are `pr-verification.yml` (`pull_request` + `merge_group`),
`release-build.yml` (push to `main`), `cd.yml` (artifact-ID dispatch from `main`) and
`agent-eval-nightly.yml` (cron). Share genuinely identical step sequences
with native composites backed by official actions. `.github/actions/setup-workspace/action.yml`
owns Node/pnpm/cache/frozen install for six PR jobs; checkout and lane-specific tools stay in callers.
The plan reads manifests without installing or caching. Route action changes alongside workflow changes.
Use GitHub's `$/` self-repository reference for committed local actions, resolved from the workflow
revision rather than mutable checkout state.

- **Use a reusable workflow for a coherent shared job graph**, with evidence for unchanged required
  contexts, outputs, event routing and permissions. Do not wrap every official action or add flags
  that make one composite run unrelated lanes. Deployment extraction also needs caller/callee OIDC
  claims and concurrency proof; this setup extraction changes neither CD identities nor locks.
- **`pr-verification.yml` is lanes behind two required contexts.** `plan` selects the affected
  workspace packages with pnpm's dependent-closure filter. `affected` runs their package scripts;
  dedicated jobs own contracts, docs, Python, browser, schema and commits. `security` and `aggregate`
  run `always()` and fail on failed or cancelled dependencies. Add new required lanes to their `needs`.
- **`release-build.yml` builds once; `cd.yml` selects an immutable artifact ID.** Each snapshot
  includes all deploy units. Trusted main controller code validates provenance, complete source
  closure, remote image manifests and the migration ledger before mutations. One `stage` job holds
  the staging lock through foundation, migration, services, web, smoke and receipt. Production has
  its own approval and lock and promotes the same verified digest. Pending selections may be
  superseded; pushes never deploy automatically. No local or tag-triggered deploy path.
- **Build and deploy jobs use uncached native setup steps.** Their environment credentials follow
  artifact/config verification. The PR-only cached composite and its exact approved actionlint
  diagnostic exception must not expand to CD or the builder. New builder OIDC identities require
  exact platform allowlists before activation.
- **Tests follow the actual SUT and responsibility.** Workflow/action tests live in `.github/test/`;
  repository configuration tests live in `test/repo-config/`. Name each `*.test.rb` for its SUT and
  state that SUT in the opening sentence. Use Minitest/Psych directly, keep files ≤200 lines and
  assertions ≤10 lines, and avoid a custom assertion framework or generic workflow interpreter.
- **A check no job invokes is a check nothing runs.** `workflow-invocations.test.rb` requires a real
  interpreter invocation for every new Ruby test and every repository `*.test.sh`, verifies invoked
  paths exist, and rejects orphaned `.github/scripts` files. Pure release libraries live in
  `.github/lib/release/`; native entries import them and direct native tests exercise their behavior.
  Route scripts, libraries and tests alongside workflow changes. Add/remove checks and invocations together.
- **Pin third-party actions to full commit SHAs**, with version comments; pin Docker actions by
  digest. Full-strength zizmor owns action-pinning and permission audits. Its test retains the
  pedantic persona, scanner version and annotation settings. Local action manifests must exist.
- **No failure suppression.** `workflow-execution.test.rb` rejects `continue-on-error` in workflows.
  Every runner job has a timeout. PR supersession cancels old PR runs; deployment queues do not.
- **Least privilege and environment-bound identity.** The workflow default is `contents: read`,
  widened per job. Jobs asking Pulumi Cloud for tokens declare an `environment`. No workflow or
  action reads a GitHub secret, including `secrets: inherit`; values come from Pulumi ESC under the
  job's OIDC identity. Guard every exported name because the ESC action only warns on missing values.
- **Validate actual consumers.** Run actionlint on workflows and zizmor with pedantic persona and
  strict collection on workflows/composite metadata. Run the native Ruby tests using the explicit
  commands in the `contracts` job and `pnpm run test:worker`; the edge suite also reads deployment
  workflow behavior. Actionlint validates workflow syntax; it does not lint composite metadata as a
  standalone workflow. A real PR run verifies the required contexts after composition changes.
