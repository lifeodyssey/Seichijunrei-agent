# Workflow assertion migration

This is the historical #1563 migration map. Subsequent CD behavior and renamed tests are mapped in
[Selected-artifact delivery assertions](./SELECTED-ARTIFACT-ASSERTION-MAP.md).

Story #1563. Baseline: `8e8a6577ac98879f7a50dabb19e5cd176fb98fba`.

The old paths below are retired historical identifiers, not runnable guidance. Each row accounts
for every assertion site listed in that baseline method. Minitest now owns assertions and failure
reporting; Psych returns the parsed workflow directly. The 160 non-gitleaks assertion sites
are accounted for below, including package-segment checks that used a separate violation array.

The shared setup action owns only pinned Node/pnpm setup, store cache and frozen installation.
Six PR callers reuse it through the official `$/` self-repository syntax. Checkout and lane tools stay in their jobs; the plan does not install.
CD retains its existing job graph, artifact selection, environment identities and deployment locks.

Two duplicate checks move to full-strength zizmor: action pinning and default permissions.
The old blanket ban on local composites is replaced by action routing, manifest existence and
explicit caller/action tests. No other behavior is intentionally retired.

## Existing assertions

Test targets use `.github/test/` unless prefixed with `test/repo-config/`. Old files use
`.github/scripts/`. Line numbers always refer to the baseline, not the migrated files.

| Old file:lines / assertion method | Current test or official audit |
| --- | --- |
| `test_agent_lane_contract.rb:82,86 / assert_lane_is_selected_by_its_sources` | `pr-verification-agent.test.rb / test_lane_is_selected_by_its_sources` |
| `test_agent_lane_contract.rb:96,99 / assert_lane_runs_the_makefile_gate` | `pr-verification-agent.test.rb / test_lane_runs_the_makefile_gate` |
| `test_agent_lane_contract.rb:109,112 / assert_gate_pins_the_offline_arm` | `pr-verification-agent.test.rb / test_gate_pins_the_offline_arm` |
| `test_agent_lane_contract.rb:124,127 / assert_lane_publishes_both_arms` | `pr-verification-agent.test.rb / test_lane_publishes_both_arms` |
| `test_agent_lane_contract.rb:145 / assert_the_gate_lints_the_whole_package` | `test/repo-config/makefile.test.rb / test_the_gate_lints_the_whole_package` |
| `test_agent_lane_contract.rb:151,153,155 / assert_the_delegated_gate_keeps_its_arms` | `test/repo-config/makefile.test.rb / test_the_delegated_gate_keeps_its_arms` |
| `test_browser_lane_contract.rb:81 / assert_browser_lane_is_selected_by_the_plan` | `pr-verification-browser.test.rb / test_browser_lane_is_selected_by_the_plan` |
| `test_browser_lane_contract.rb:88,90,93 / assert_browser_lane_runs_the_package` | `pr-verification-browser.test.rb / test_browser_lane_runs_the_package` |
| `test_browser_lane_contract.rb:99,101,103 / assert_the_suite_presents_the_staging_access_token` | `test/repo-config/playwright.test.rb / test_the_suite_presents_the_staging_access_token` |
| `test_browser_lane_contract.rb:111,114,117 / assert_the_token_is_scoped_to_a_staging_target` | `test/repo-config/playwright.test.rb / assert_the_token_is_scoped_to_a_staging_target` |
| `test_browser_lane_contract.rb:123,128 / assert_the_token_cannot_leave_the_target_origin` | `test/repo-config/playwright.test.rb / assert_the_token_cannot_leave_the_target_origin` |
| `test_cd_credential_boundary_contract.rb:134,136 / assert_pulumi_login_is_the_only_token_type_this_org_can_mint` | `cd-credentials.test.rb / test_pulumi_login_is_the_only_token_type_this_org_can_mint` |
| `test_cd_credential_boundary_contract.rb:160,165 / assert_esc_exports_only_what_its_stage_publishes_with` | `cd-credentials.test.rb / test_esc_exports_only_what_its_stage_publishes_with; test_neon_credentials_have_a_control_plane_reader` |
| `test_cd_credential_boundary_contract.rb:178 / assert_the_staging_job_opens_the_union_its_units_spend` | `cd-credentials.test.rb / test_the_staging_job_opens_the_union_its_units_spend` |
| `test_cd_credential_boundary_contract.rb:205,208 / assert_each_credential_stays_inside_its_unit` | `cd-credentials.test.rb / test_each_credential_stays_inside_its_unit` |
| `test_cd_credential_boundary_contract.rb:229 / assert_the_access_token_stays_inside_the_staging_job` | `cd-credentials.test.rb / test_the_access_token_stays_inside_the_staging_job` |
| `test_cd_credential_boundary_contract.rb:239,241 / assert_wrangler_publishes_on_the_opened_token` | `cd-credentials.test.rb / test_wrangler_publishes_on_the_opened_token` |
| `test_cd_credential_boundary_contract.rb:248 / assert_retired_credentials_stay_retired` | `cd-credentials.test.rb / test_retired_credentials_stay_retired` |
| `test_cd_credential_boundary_contract.rb:252,253,256 / assert_no_runtime_secret_upload` | `cd-credentials.test.rb / test_no_runtime_secret_upload` |
| `test_cd_credential_boundary_contract.rb:261 / assert_ci_holds_no_database_credential` | `cd-credentials.test.rb / test_ci_holds_no_database_credential` |
| `test_cd_publish_contract.rb:124,126 / assert_deploys_pin_wrangler` | `cd-publish.test.rb / test_deploys_pin_wrangler` |
| `test_cd_publish_contract.rb:132,137 / assert_deploys_tag_the_version` | `cd-publish.test.rb / test_deploys_tag_the_version` |
| `test_cd_publish_contract.rb:152 / assert_deploys_publish_the_sealed_bundle` | `cd-publish.test.rb / test_deploys_publish_the_sealed_bundle` |
| `test_cd_publish_contract.rb:160 / assert_deploys_name_their_own_environment` | `cd-publish.test.rb / test_deploys_name_their_own_environment` |
| `test_cd_publish_contract.rb:177,179 / assert_shell_publish_obeys` | `cd-publish.test.rb / assert_shell_publish_obeys` |
| `test_cd_publish_contract.rb:192 / assert_shell_publishes_obey_the_same_rules` | `cd-publish.test.rb / test_shell_publishes_obey_the_same_rules` |
| `test_cd_publish_contract.rb:207,209 / assert_smoke_probes_the_real_surfaces` | `cd-stage-smoke.test.rb / test_smoke_probes_the_real_surfaces` |
| `test_cd_publish_contract.rb:227,230,236,238 / assert_smoke_failure_is_decisive` | `cd-stage-smoke.test.rb / test_smoke_failure_is_decisive; test_probe_is_the_last_executable_command` |
| `test_cd_publish_contract.rb:250,251 / assert_every_environment_migrates_through_the_worker` | `cd-migrations.test.rb / test_every_environment_migrates_through_the_worker` |
| `test_cd_publish_contract.rb:262 / assert_no_job_applies_the_chain_itself` | `cd-migrations.test.rb / test_no_job_applies_the_chain_itself` |
| `test_cd_publish_contract.rb:273,278,281 / assert_baseline_guard_precedes_the_production_migration` | `cd-migrations.test.rb / test_baseline_guard_precedes_the_production_migration` |
| `test_cd_publish_contract.rb:292,295,298 / assert_plan_reads_the_smoke_step_by_name` | `cd-plan-smoke.test.rb / test_plan_reads_the_smoke_step_by_name` |
| `test_cd_publish_contract.rb:306 / assert_the_probe_keeps_the_default_success_condition` | `cd-stage-smoke.test.rb / test_the_probe_keeps_the_default_success_condition` |
| `test_cd_shape_contract.rb:96,99 / assert_one_build_one_artifact` | `cd-artifact.test.rb / test_one_build_one_artifact` |
| `test_cd_shape_contract.rb:106,107 / assert_every_stage_downloads_the_artifact` | `cd-artifact.test.rb / test_every_stage_downloads_the_artifact` |
| `test_cd_shape_contract.rb:116,118,119 / assert_push_to_main_is_the_only_trigger` | `cd-plan.test.rb / test_push_to_main_is_the_only_trigger` |
| `test_cd_shape_contract.rb:131 / assert_build_installs_pulumi_before_sealing` | `cd-build.test.rb / test_build_installs_pulumi_before_sealing` |
| `test_cd_shape_contract.rb:142 / assert_production_never_rebuilds` | `cd-artifact.test.rb / test_production_never_rebuilds` |
| `test_cd_shape_contract.rb:150 / assert_skip_propagation` | `cd-delivery-jobs.test.rb / test_skip_propagation` |
| `test_cd_shape_contract.rb:160,162,164,166,168,170,172,175 / assert_plan_guards` | `cd-plan.test.rb / test_plan_selects_completed_ancestral_runs; test_plan_has_safe_fallbacks_and_rejects_superseded_heads; test_plan_exposes_the_selected_packages_and_deploy_units` |
| `test_cd_shape_contract.rb:182,183,185 / assert_concurrency_group` | `cd-delivery-jobs.test.rb / assert_concurrency_group` |
| `test_cd_shape_contract.rb:192 / assert_delivery_concurrency` | `cd-delivery-jobs.test.rb / test_delivery_concurrency` |
| `test_cd_shape_contract.rb:198,201 / assert_environments` | `cd-delivery-jobs.test.rb / test_environments` |
| `test_cd_shape_contract.rb:207 / assert_stages_run_only_on_a_built_artifact` | `cd-delivery-jobs.test.rb / test_stages_run_only_on_a_built_artifact` |
| `test_cd_shape_contract.rb:224 / assert_immutable_pairs` | `cd-delivery-jobs.test.rb / test_immutable_pairs` |
| `test_cd_shape_contract.rb:234 / assert_no_build_time_environment_values` | `cd-build.test.rb / test_no_build_time_environment_values` |
| `test_cd_staging_chain_contract.rb:74,78 / assert_the_staging_chain_is_one_job` | `cd-stage.test.rb / test_the_staging_chain_is_one_job` |
| `test_cd_staging_chain_contract.rb:85,88 / assert_reset_and_its_job_share_one_selector` | `cd-stage.test.rb / assert_reset_and_its_job_share_one_selector` |
| `test_cd_staging_chain_contract.rb:94 / assert_reset_precedes_the_chain_apply` | `cd-stage.test.rb / assert_reset_precedes_the_chain_apply` |
| `test_cd_staging_chain_contract.rb:101 / assert_reset_runs_the_checkout_copy` | `cd-stage.test.rb / assert_reset_runs_the_checkout_copy` |
| `test_cd_staging_chain_contract.rb:113 / assert_the_schema_reset_pairs_with_a_migration` | `cd-stage.test.rb / test_the_schema_reset_pairs_with_a_migration` |
| `test_cd_staging_chain_contract.rb:125 / assert_nothing_publishes_after_the_probe` | `cd-stage.test.rb / test_nothing_publishes_after_the_probe` |
| `test_ci_workflow_contract.rb:114,117 / assert_plan_subtracts_owned_projects` | `pr-verification-plan.test.rb / test_selects_dependents_but_leaves_owned_lanes_out_of_the_matrix` |
| `test_ci_workflow_contract.rb:122,124 / assert_matrix_guard` | `pr-verification-affected.test.rb / test_matrix_guard` |
| `test_ci_workflow_contract.rb:140,142 / assert_matrix_runs_package_scripts` | `pr-verification-affected.test.rb / test_matrix_runs_package_scripts` |
| `test_ci_workflow_contract.rb:153 / assert_matrix_provisions_toolchains` | `pr-verification-affected.test.rb / test_matrix_provisions_toolchains` |
| `test_ci_workflow_contract.rb:174,177 / assert_image_builds_resolve_one_tag` | `pr-verification-affected.test.rb / test_image_builds_resolve_one_tag` |
| `test_ci_workflow_contract.rb:184,186,188 / assert_workflow_changes_reach_their_tests` | `pr-verification-plan.test.rb / test_routes_workflow_and_action_sources_together / test_workflow_and_action_changes_reach_edge_and_python_gates` |
| `test_ci_workflow_contract.rb:202 / assert_no_job_hides_steps_in_a_composite` | `pr-verification-plan.test.rb / test_routes_workflow_and_action_sources_together` |
| `test_ci_workflow_contract.rb:231,233 / assert_every_committed_check_runs` | `workflow-invocations.test.rb / test_every_committed_check_runs_in_pr_verification / test_every_invoked_script_exists` |
| `test_ci_workflow_contract.rb:238,240,242 / assert_aggregate` | `pr-verification-gates.test.rb / assert_aggregate` |
| `test_ci_workflow_contract.rb:260,263 / assert_commitlint_lints_the_squash_subject` | `pr-verification-gates.test.rb / test_commitlint_lints_the_squash_subject` |
| `test_ci_workflow_contract.rb:269 / assert_commitlint_lints_the_branch_commits` | `pr-verification-gates.test.rb / test_commitlint_lints_the_branch_commits` |
| `test_ci_workflow_contract.rb:279,283 / assert_commits_gate_replaces_codeql` | `pr-verification-gates.test.rb / test_commits_gate_replaces_codeql` |
| `test_ci_workflow_contract.rb:316,320 / assert_zizmor_runs_at_full_strength` | `pr-verification-zizmor.test.rb / test_zizmor_runs_at_full_strength` |
| `test_lint_scope_contract.rb:132 / assert_ruff_excludes_only_what_was_reviewed` | `test/repo-config/lint-scope.test.rb / test_ruff_excludes_only_what_was_reviewed` |
| `test_lint_scope_contract.rb:154 / assert_ruff_reads_only_the_reviewed_config` | `test/repo-config/lint-scope.test.rb / test_ruff_reads_only_the_reviewed_config` |
| `test_lint_scope_contract.rb:172 / assert_every_oxlint_config_is_reviewed` | `test/repo-config/lint-scope.test.rb / test_every_oxlint_config_is_reviewed` |
| `test_lint_scope_contract.rb:187 / assert_oxlint_ignores_only_what_was_reviewed` | `test/repo-config/lint-scope.test.rb / test_oxlint_ignores_only_what_was_reviewed` |
| `test_package_test_segments.rb:107 / assert_segment_present` | `test/repo-config/package-test-segments.test.rb / assert_package_segments` |
| `test_package_test_segments.rb:114 / assert_segment_defined` | `test/repo-config/package-test-segments.test.rb / assert_package_segments` |
| `test_package_test_segments.rb:120 / assert_package` | `test/repo-config/package-test-segments.test.rb / assert_package_segments` |
| `test_package_test_segments.rb:133 / assert_manifest_is_complete` | `test/repo-config/package-test-segments.test.rb / test_manifest_covers_every_workspace_test_lane` |
| `test_package_test_segments.rb:139,142 / assert_segment_stays_out_of_test` | `test/repo-config/package-test-segments.test.rb / assert_out_of_band_segment` |
| `test_package_test_segments.rb:149 / assert_segment_runs_in` | `test/repo-config/package-test-segments.test.rb / assert_out_of_band_segment` |
| `test_package_test_segments.rb:160 / assert_delegated_command` | `test/repo-config/package-test-segments.test.rb / test_delegated_scripts_keep_their_commands` |
| `test_schema_lane_contract.rb:54 / assert_schema_job_is_paths_filtered` | `pr-verification-schema.test.rb / test_schema_job_is_paths_filtered` |
| `test_schema_lane_contract.rb:71,74 / assert_schema_segments_are_separate_ordered_steps` | `pr-verification-schema.test.rb / test_schema_segments_are_separate_ordered_steps` |
| `test_schema_lane_contract.rb:81,83 / assert_schema_job_pins_atlas` | `pr-verification-schema.test.rb / test_schema_job_pins_atlas` |
| `test_schema_lane_contract.rb:94 / assert_no_job_applies_a_migration` | `pr-verification-schema.test.rb / test_no_job_applies_a_migration` |
| `test_workflow_invariants.rb:106 / assert_timeouts` | `workflow-execution.test.rb / generated *_has_a_timeout` |
| `test_workflow_invariants.rb:111 / assert_default_permissions` | `zizmor 1.30.0 / excessive-permissions / pedantic persona` |
| `test_workflow_invariants.rb:121,122 / assert_concurrency` | `workflow-execution.test.rb / generated *_cancellation_matches_its_events / *_groups_superseded_pull_requests` |
| `test_workflow_invariants.rb:127 / assert_push_never_cancels` | `workflow-execution.test.rb / generated *_cancellation_matches_its_events` |
| `test_workflow_invariants.rb:133,136 / assert_required_contexts` | `workflow-execution.test.rb / test_required_contexts_support_the_merge_queue` |
| `test_workflow_invariants.rb:141 / assert_no_suppression` | `workflow-execution.test.rb / generated *_does_not_suppress_failures` |
| `test_workflow_invariants.rb:157 / assert_opened_values_are_guarded` | `workflow-credentials.test.rb / generated *_guards_every_export_before_spending_it` |
| `test_workflow_invariants.rb:173 / assert_provided_before_use` | `workflow-execution.test.rb / generated *_installs_uv_before_using_it` |
| `test_workflow_invariants.rb:195 / assert_identity_jobs_name_an_environment` | `workflow-credentials.test.rb / generated *_binds_its_oidc_identity_to_an_environment` |
| `test_workflow_invariants.rb:203 / assert_no_github_secret` | `workflow-credentials.test.rb / generated *_does_not_read_github_secrets` |
| `test_workflow_invariants.rb:225 / assert_pinned` | `zizmor 1.30.0 / unpinned-uses / pedantic persona` |
| `test_workflow_invariants.rb:237 / assert_local_actions_exist` | `workflow-invocations.test.rb / test_every_local_action_exists` |
| `test_workflow_invariants.rb:264 / assert_every_script_is_reachable` | `workflow-invocations.test.rb / test_every_delivery_script_is_reachable` |
| `test_workspace_install_contract.rb:109 / assert_install_precedes_the_first_use` | `workflow-workspace.test.rb / generated *_installs_before_the_first_workspace_use` |
| `test_workspace_install_contract.rb:118 / assert_named_scripts_are_committed` | `workflow-workspace.test.rb / test_indirect_workspace_consumers_exist` |
| `test_workspace_install_contract.rb:136 / assert_the_cached_store_is_one_this_job_creates` | `workflow-workspace.test.rb / generated *_creates_the_store_it_caches` |

## Gitleaks behavior and mutation coverage

The original `reject` helper becomes ordinary Minitest assertions; its custom abort/reporting
mechanism is removed. Table parsing and synthetic, non-secret probe values retain their behavior.

| Retired source behavior | Current test in `test/repo-config/` |
| --- | --- |
| configuration exists | `gitleaks.test.rb / setup` |
| extend table, assignment exists, true assignment | `gitleaks.test.rb / test_default_rules_remain_enabled` |
| no disabledRules | `gitleaks.test.rb / test_no_inherited_rule_is_disabled` |
| path allowlist cannot mute scanned files | `gitleaks.test.rb / test_allowlist_does_not_exempt_scanned_paths` |
| value allowlist cannot mute reportable secrets | `gitleaks.test.rb / test_allowlist_does_not_hide_reported_values` |
| stopwords cannot silence rule classes (case insensitive) | `gitleaks.test.rb / test_allowlist_does_not_silence_rule_classes` |
| valid committed configuration | `gitleaks-mutation.test.rb / test_accepts_the_committed_configuration` |
| configuration deletion | `gitleaks-mutation.test.rb / test_rejects_deleted_configuration` |
| extend deletion | `gitleaks-mutation.test.rb / test_rejects_deleted_extend_table` |
| false default inheritance | `gitleaks-mutation.test.rb / test_rejects_disabled_default_rules` |
| extend rename | `gitleaks-mutation.test.rb / test_rejects_renamed_extend_table` |
| commented inheritance | `gitleaks-mutation.test.rb / test_rejects_commented_default_rules` |
| disabled inherited rule | `gitleaks-mutation.test.rb / test_rejects_disabled_inherited_rules` |
| wildcard path | `gitleaks-mutation.test.rb / test_rejects_allowlist_for_every_path` |
| wildcard value | `gitleaks-mutation.test.rb / test_rejects_allowlist_for_every_value` |
| uppercase stopword | `gitleaks-mutation.test.rb / test_rejects_stopwords_that_silence_a_rule_class` |
| useDefault relocated into allowlist | `gitleaks-mutation.test.rb / test_rejects_default_rules_relocated_into_the_allowlist` |
| mutation must change its input | `gitleaks-mutation.test.rb / mutate; relocation test` |
| mutation fails and names its own consequence | `gitleaks-mutation.test.rb / reject_config` |

## New composition checks

Main integration at `0b8dc6b76d10d3be1b04ce5c3301e5a272ae60bb` adds two SDK assertions:
`test_cd_shape_contract.rb:139,142 / assert_neon_sdk_uses_committed_provider_versions` now maps to
`cd-build.test.rb / test_neon_sdk_uses_committed_provider_versions` and
`test_build_does_not_resolve_provider_versions_again`. The Pulumi installation-order assertion
also retains main's `pulumi install` command marker.

- `setup-workspace-action.test.rb`: official action order, `.nvmrc`, pnpm cache/lock and frozen
  installation with an explicit Bash shell.
- `pr-verification-workspace.test.rb`: six compatible callers check out before using the action
  once; the plan stays free of unnecessary install/cache.
- `pr-verification-plan.test.rb`: both workflow and action changes select edge and Python gates.
- `workflow-invocations.test.rb`: native Ruby calls cover every new test, missing script paths
  fail, delivery scripts remain reachable and local action manifests exist.
- `pr-verification-zizmor.test.rb`: pedantic persona, pinned scanner version, annotations enabled
  and SARIF disabled stay explicit. The official scanner owns pinning/permission audits.

## Review and execution evidence

Review evidence is recorded on the story PR. Local mutations cover frozen install, action routing,
missing or uninvoked checks, the production baseline guard and actual unpinned-action scanning.
A real PR run must verify `PR Verification`, `Security`, affected outputs and merge-group routing.
Local checks do not claim that remote acceptance criterion is already complete.
