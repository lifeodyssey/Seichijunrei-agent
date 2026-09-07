#!/usr/bin/env bash
# Deterministic Quality gate (#1003, AC5), fail-fast, in CI's order.
#
# #1359 removed the whole CI-shape half of this file: the pnpm-affected rewrite
# of pr-verification.yml deleted the routers, the aggregators and the seventeen
# `test_*` scripts that pinned their shape. #1364 removed the delivery half for
# the same reason — the router, the per-unit artifacts, the promotion shell
# script and the rollback workflow are gone, and the seven contracts that pinned
# them are replaced by three contracts owning one question each. What is left is
# the repository-wide workflow invariants, the CI file's own shape and the four
# lane contracts beside it (agent, browser, schema, package segments), the three
# CD contracts, the gitleaks config contract (#1438), the three documentation
# checks, and shell hygiene.
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
  "$GS/test_lint_scope_contract.rb" \
  "$GS/test_browser_lane_contract.rb" \
  "$GS/test_schema_lane_contract.rb" \
  "$GS/test_cd_shape_contract.rb" \
  "$GS/test_cd_publish_contract.rb" \
  "$GS/test_cd_credential_boundary_contract.rb" \
  "$GS/test_package_test_segments.rb" \
  "$GS/test_gitleaks_config_extends_defaults.rb" \
  "$GS/test_gitleaks_config_extends_defaults_mutation.rb"; do
  run ruby -c "$ruby_file"
done
run ruby "$GS/test_workflow_invariants.rb"
run ruby "$GS/test_ci_workflow_contract.rb"
run ruby "$GS/test_agent_lane_contract.rb"
run ruby "$GS/test_lint_scope_contract.rb"
run ruby "$GS/test_browser_lane_contract.rb"
run ruby "$GS/test_schema_lane_contract.rb"
run ruby "$GS/test_cd_shape_contract.rb"
run ruby "$GS/test_cd_publish_contract.rb"
run ruby "$GS/test_cd_credential_boundary_contract.rb"
run ruby "$GS/test_package_test_segments.rb"
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
run bash "$GS/staging-smoke-check.test.sh"
run bash "$GS/bundle-release-worker.test.sh"
run bash scripts/delivery/migrate-through-worker.test.sh
run bash scripts/local-gates/commit-message.test.sh
run bash scripts/local-gates/shebang-exec-bit.test.sh
run bash scripts/local-gates/shebang-exec-bit.sh
run ruby "$GS/test_gitleaks_config_extends_defaults.rb"
run ruby "$GS/test_gitleaks_config_extends_defaults_mutation.rb"
run shellcheck "$GS/bundle-release-worker.sh" "$GS/bundle-release-worker.test.sh"
run shellcheck "scripts/delivery/migrate-through-worker.sh" "scripts/delivery/migrate-through-worker.test.sh"
run shellcheck "$GS/staging-smoke-check.sh" "$GS/staging-smoke-check.test.sh"
run shellcheck "infra/database-access/reset-staging-baseline.sh"
run bash scripts/semgrep-raw-sql-test.sh
run "${ACTIONLINT_BIN:-actionlint}"

printf 'quality: all checks passed\n'
