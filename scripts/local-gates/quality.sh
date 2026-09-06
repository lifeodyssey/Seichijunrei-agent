#!/usr/bin/env bash
# Deterministic Quality gate (#1003, AC5), fail-fast, in CI's order.
#
# #1359 removed the whole CI-shape half of this file: the pnpm-affected
# rewrite of pr-verification.yml deleted the routers, the aggregators and the
# seventeen `test_*` scripts that pinned their shape, so the lines that ran
# them are gone with them. What is left is the delivery contracts that `cd.yml`
# still depends on (C1 retires them with it), the repository-wide workflow
# contract, the package lane-segment manifest, the gitleaks config contract
# (#1438), and the shell hygiene checks.
# The three documentation checks moved into this directory with the same
# change and are the `docs` job's content in CI.
set -euo pipefail

GS=".github/scripts"
run() {
  printf 'quality: %s\n' "$*"
  "$@"
}

# CI runs `ruby -c` once per file; a single invocation with several paths would
# only ever syntax-check the first one, silently skipping every later file —
# loop one path per `ruby -c`, fail-fast.
for ruby_file in \
  "$GS/workflow_document.rb" \
  "$GS/test_workflow_invariants.rb" \
  "$GS/test_ci_workflow_contract.rb" \
  "$GS/test_agent_lane_contract.rb" \
  "$GS/test_package_test_segments.rb" \
  "$GS/test_gitleaks_config_extends_defaults.rb" \
  "$GS/test_gitleaks_config_extends_defaults_mutation.rb" \
  "$GS/test_rollback_edge_pair_mutation.rb" \
  "$GS/test_retired_retention_absence.rb" \
  "$GS/test_promotion_ac5_contract.rb" \
  "$GS/test_promotion_ac5_mutation.rb" \
  "$GS/test_database_credential_boundary.rb" \
  "$GS/test_migration_promotion_contract.rb" \
  "$GS/test_cd_workflow_contract.rb" \
  "$GS/test_cd_skip_propagation_contract.rb" \
  "$GS/test_cd_worker_promotion_contract.rb" \
  "$GS/test_cd_infrastructure_safety_contract.rb" \
  "$GS/test_cd_esc_token_source_contract.rb" \
  "$GS/test_cd_affected_routing_contract.rb" \
  "$GS/test_secret_provisioning_contract.rb" \
  "$GS/test_secret_provisioning_mutation.rb" \
  "$GS/test_production_safety_contract.rb"; do
  run ruby -c "$ruby_file"
done
run ruby "$GS/test_workflow_invariants.rb"
run ruby "$GS/test_ci_workflow_contract.rb"
run ruby "$GS/test_agent_lane_contract.rb"
run ruby "$GS/test_package_test_segments.rb"
run python3 "$GS/test_component_manifest.py"
run python3 "$GS/test_change_plan.py"
run python3 "$GS/test_cd_cohort_plan.py"
run bash "$GS/test_resolve_cd_base.sh"
run python3 "$GS/test_verify_release_artifact.py"
run bash "$GS/test_promote_release_unit.sh"
run python3 "$GS/test_edge_runtime_secrets.py"
run node "$GS/release-web-runtime-config.test.mjs"
run node "$GS/release-web-runtime-config.mutation.test.mjs"
run ruby "$GS/test_secret_provisioning_contract.rb"
run ruby "$GS/test_secret_provisioning_mutation.rb"
run ruby "$GS/test_cd_workflow_contract.rb"
run ruby "$GS/test_cd_skip_propagation_contract.rb"
run ruby "$GS/test_production_safety_contract.rb"
run python3 "$GS/test_validate_rollback_release.py"
run ruby "$GS/test_rollback_edge_pair_mutation.rb"
run ruby "$GS/test_retired_retention_absence.rb"
run ruby "$GS/test_database_credential_boundary.rb"
run ruby "$GS/test_migration_promotion_contract.rb"
run ruby "$GS/test_promotion_ac5_contract.rb"
run ruby "$GS/test_promotion_ac5_mutation.rb"
run bash scripts/local-gates/check-agents-refs.test.sh
run bash scripts/local-gates/check-agents-refs.sh
run bash scripts/local-gates/check-docs-paths.test.sh
# check-docs-paths.sh corrupts macOS bash 3.2's heap under the harness's
# GATE_* environment (nested while-read + process substitution; see the
# check's own header). The check needs none of those vars — run it scrubbed.
run env -u GATE_TEST_LOG -u GATE_OUTDIR bash scripts/local-gates/check-docs-paths.sh
run bash scripts/local-gates/check-root-allowlist.test.sh
run bash scripts/local-gates/check-root-allowlist.sh
run bash "$GS/check-e2e-promotion.test.sh"
run bash "$GS/check-e2e-promotion.sh"
run bash "$GS/check-web-runtime-config-payloads.test.sh"
run bash "$GS/check-web-runtime-config-payloads.sh"
# The script itself needs the artifact API; its layout contract is pure and
# runs here with a `gh` stub.
run bash "$GS/download-release-cohort.test.sh"
run bash "$GS/staging-smoke-check.test.sh"
run ruby "$GS/test_cd_worker_promotion_contract.rb"
run ruby "$GS/test_cd_infrastructure_safety_contract.rb"
run ruby "$GS/test_cd_esc_token_source_contract.rb"
run ruby "$GS/test_cd_affected_routing_contract.rb"
run bash scripts/local-gates/commit-message.test.sh
run bash scripts/local-gates/shebang-exec-bit.test.sh
run bash scripts/local-gates/shebang-exec-bit.sh
run ruby "$GS/test_gitleaks_config_extends_defaults.rb"
run ruby "$GS/test_gitleaks_config_extends_defaults_mutation.rb"
run shellcheck "$GS/sync-edge-runtime-secrets.sh" "$GS/promote-release-unit.sh"
run shellcheck "$GS/staging-smoke-check.sh" "$GS/staging-smoke-check.test.sh"
run shellcheck "infra/database-access/reset-staging-baseline.sh"
run shellcheck "$GS/download-release-cohort.sh" "$GS/download-release-cohort.test.sh"
run bash scripts/semgrep-raw-sql-test.sh
run "${ACTIONLINT_BIN:-actionlint}"

printf 'quality: all checks passed\n'
