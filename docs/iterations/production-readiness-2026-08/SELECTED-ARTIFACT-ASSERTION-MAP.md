# Selected-artifact delivery assertions

Story #1564 changes the delivery contract accepted in #1563. Baseline:
`f05356aa7b5b8f4cd54f6e1432f31ed2a23734e5`. The
[earlier migration map](./WORKFLOW-ASSERTION-MAP.md) records the unchanged #1563 outcome;
its CD method names are historical after this story. This map explains every changed CD
responsibility. Tests run directly with Minitest/Psych through PR verification's explicit commands.

## Preserved and replaced contracts

All test paths below are under `.github/test/`.

| Baseline responsibility | Current test and behavior |
| --- | --- |
| `cd-artifact`: one build/upload; every consumer names the same artifact; production never rebuilds | `release-build.test.rb` checks one complete snapshot upload; `cd-artifact.test.rb` checks official ID/run/repository/digest downloads in all consumers, byte verification before installs and no rebuild. Receipt uploads are separate evidence, never substitute release payloads. |
| `cd-build`: Pulumi installed before SDK sealing; pinned Neon provider; no dynamic package add or VITE values | `release-build.test.rb` moves these checks to the actual push-only producer and native foundation sealer. Both images build once and use returned manifest digests. |
| `cd-plan`: push-only deploy; completed ancestral baseline pagination; before/zero-SHA fallback; latest-head rejection; affected-package outputs | `cd-selection.test.rb` replaces push deployment with main-only explicit artifact-ID dispatch. `release-selection.test.rb` and `release-resolver.test.rb` exercise native API provenance, original successful attempt, expiry, digest and ancestry. Pagination, event-before fallback and latest-head rejection retire deliberately: B remains selectable after C; no latest-run substitute is allowed. |
| `cd-delivery-jobs`: dependency skip propagation; build-success guard; environment locks/approval; queue-max; affected pairs | `cd-delivery-jobs.test.rb` checks `select → stage → promote-production`, successful dependencies, independent environment locks and approval. Queue-max retires; active chains finish, pending selections may be replaced. `cd-stage.test.rb`, `release-snapshot.test.rb` and `release-source-closure.test.rb` replace conditional cohort pairs with unconditional complete snapshots. |
| `cd-stage`: one staging chain; migration-selected reset before apply from controller checkout; smoke last | `cd-stage.test.rb` checks ordered foundation/migrator/schema/services/smoke in both whole-chain locks. Automatic schema reset retires; unknown/incompatible history refuses. Only read-only observed identities and immutable receipt upload may follow smoke. |
| `cd-stage-smoke`: real public URLs; decisive failure; last executable command; success-only condition | `cd-stage-smoke.test.rb` preserves the original assertions against the renamed `Smoke the release` step. `staging-smoke-check.test.sh` still exercises HTTP probe behavior. |
| `cd-plan-smoke`: API lookup of a specifically named prior smoke step | `cd-receipt.test.rb` replaces mutable prior-run name lookup with the same controller run's immutable staging receipt, checked after production approval and before credentials. `release-receipt.test.rb` and `release-receipt-cli.test.rb` reject wrong ID/digest/run/source and permit B promotion after later C staging. |
| `cd-migrations`: authenticated helper; no direct Atlas apply; production baseline guard | `cd-migrations.test.rb` preserves all three and requires real registry/ledger preflight before every actual mutation, including Pulumi and migrator publication. `release-schema-gate.test.rb` exercises fail-closed HTTP/status/response behavior. `release-migration-request.test.rb` executes the actual shell controller and proves full metadata forwarding before OIDC minting. Native migrator workerd/PostgreSQL tests own same-lock compatibility revalidation. |
| `cd-publish`: pinned Wrangler; selected version tag; sealed bundle; exact environment; shell/action parity | `cd-publish.test.rb` checks installed pinned native Wrangler and exact migrator/service entry invocations. `release-publish-services.test.rb` executes the entry against an argument-recording CLI and checks all four services, selected SHA and invalid-input refusal. `release-config.test.rb` uses Wrangler's native parser. |
| `cd-credentials`: exact Pulumi principal; nonempty bounded ESC exports; staging union; Access scope; Wrangler token; no retired/runtime/database credentials | `cd-credentials.test.rb` preserves exact issuer/token scope, environment/stack identities, staging Access ownership and prohibited keys. Neon control-plane export/reset readers retire with automatic reset. Native Wrangler consumes the exported token; `workflow-credentials.test.rb` checks every ESC export has a missing-value guard. Export lists are not claimed as provider-enforced least privilege; #1565 owns that boundary. |

## Added behavioral boundaries

`release-archive.test.rb`, `release-snapshot.test.rb` and `release-source-closure.test.rb` reject
unsafe archives, missing or modified units and omitted selected-source prerequisites.
`release-consumer-cli.test.rb` executes the sealer/archive/consumer with a real temporary A→B→C
Git history, including controller overwrite and extra-download refusal.

`release-registry.test.rb` and `release-registry-cli.test.rb` require native remote manifest/image
inspection. `release-observation.test.rb` and `release-container-observation.test.rb` validate real
platform response identities without equating script-scoped version IDs across environments.
These local fixtures do not claim that registry permissions or live deployments have been proven.

Cross-workflow tests retain invocation existence, PR-scoped check reachability, frozen installation,
credentials, runner limits and required contexts. `pr-verification-plan.test.rb` adds release
scripts/libraries/tests to affected routing. Pure modules live in `.github/lib/release/`; actual
workflow entry points remain in `.github/scripts/release/`. No dependency parser or custom runner
is introduced. Exact `.gitignore` ownership joins `test/repo-config/` in the existing pre-push router;
sibling paths remain unowned and are rejected by its behavioral test.

## Evidence limits

Passing local contracts and mutation tests does not activate delivery. #1575 must first install
read-only preflight on both environments; same-lock revalidation now has native workerd and
disposable PostgreSQL tests, with live activation still pending. The exact builder OIDC/ESC identity,
registry access, runtime secrets, baseline cutover and production hostname must be ready. Real
cross-run artifact download, concurrent environment execution, approval and promotion evidence
remain required by the issue and [ADR 0007](../../adr/0007-selected-release-artifacts.md).
