#!/usr/bin/env ruby
# frozen_string_literal: true

# The shape of the main-line delivery file (card C1 / #1364). It replaces the
# seven retired `test_cd_*` / `test_promotion_*` / `test_secret_provisioning_*`
# scripts with the handful of properties that still have teeth once the router,
# the per-unit artifacts and the promotion shell script are gone:
#
#   build        one build job, one artifact, and `promote-production` deploys
#                that artifact without rebuilding anything
#   propagation  every stage lists every earlier stage in `needs`, so a failure
#                two hops back cannot evaporate into a `skipped` result
#   guards       `plan` starts its range at the last tree CD published, falls
#                back off a zero `before` and refuses a head that origin/main
#                has already moved past
#   concurrency  the staging lane and the production lane are separate job-level
#                groups that queue instead of cancelling
#   trigger      a push to main is the only way in — no tag, no dispatch
#   pairing      a unit whose inputs live outside its own pnpm project also
#                fires on the path that carries them
#   reset        the staging schema reset runs exactly where a schema change is
#                what selected the job around it, before the chain it baselines
#                for, off the copy of the script that push actually has
#   artifact     nothing environment-specific is resolved at build time
#
# How it publishes — deploy targets, version pinning, the smoke gate, the
# production migration step — is `test_cd_publish_contract.rb`; the credentials
# it may hold are `test_cd_credential_boundary_contract.rb`. The repository-wide meta-invariants
# (timeouts, permissions, action pinning) are `test_workflow_invariants.rb`; the
# CI file's shape is `test_ci_workflow_contract.rb`.
#
# Usage: ruby .github/scripts/test_cd_shape_contract.rb [REPO_ROOT]

require_relative "workflow_document"

ROOT = repository_root
CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
# The delivery order. Each job must name every job before it in `needs`.
CHAIN = %w[plan build stage-foundation stage-migration stage-services stage-edge
           stage-web smoke promote-production].freeze
STAGING_JOBS = %w[stage-foundation stage-migration stage-services stage-edge stage-web smoke].freeze
ARTIFACT = "release-${{ github.sha }}"
UPLOAD = "actions/upload-artifact"
DOWNLOAD = "actions/download-artifact"
# Anything that would make production publish bytes staging never ran. Patterns,
# not substrings: `pnpm` accepts both `--filter web build` and `--filter web run
# build`, and the substring form let the second spelling walk straight through
# this guard (found by this card's own M4 mutation while rebasing onto B2-B5).
REBUILD_MARKERS = [
  /pnpm --filter web (?:run )?build/,
  /--dry-run/,
  %r{docker/build-push-action},
  /containers push/,
  Regexp.new(Regexp.escape(UPLOAD))
].freeze
ZERO_SHA = "0000000000000000000000000000000000000000"
HEAD_GUARD = "git ls-remote origin refs/heads/main"
# `github.event.before` is the previous *push*, not the previous *deployment*: a
# failed run's cohort falls outside the next push's range and the head guard
# below forbids re-running it, so the diff is stranded (#1506). The range starts
# at the head of the last successful CD run instead, and only when this push's
# history still descends from it — a widened range over a rewritten history
# describes nothing, and mere reachability would not catch that.
LAST_SUCCESS_QUERY = %r{actions/workflows/cd\.yml/runs\?[^"']*\bstatus=success\b}
LAST_SUCCESS_SHA = "head_sha"
ANCESTOR_CHECK = "git merge-base --is-ancestor"
# Without it a stage runs on a push whose `build` was skipped — no artifact.
BUILD_GUARD = "needs.build.result == 'success'"
# Two units take their inputs from outside their own pnpm project: the edge
# Worker carries the agent container image, and the migrator image bakes
# `migrations/neon`. Selecting one half without the other publishes a unit
# against inputs that were never rebuilt — the retired router called these
# `IMMUTABLE_PAIRS = ({"agent","edge"}, {"migrator","db"})`.
PAIRS = [["contains(fromJSON(needs.plan.outputs.packages), 'migrator')",
          "needs.plan.outputs.migrations == 'true'", "a migrations/neon change"],
         ["contains(fromJSON(needs.plan.outputs.packages), 'edge-worker')",
          "needs.plan.outputs.agent == 'true'", "an apps/agent change"]].freeze
# The one step that destroys staging data. #1216 fixed it firing on a push that
# carried no schema change; #1469 fixed the mirror defect — the step's own `if:`
# said `migrations`, but the job around it said `infra`, so the intersection was
# "both" and a migrations-only push applied the chain without it. One rule
# covers both readings: the reset's job and the reset's step must each be
# selected by the same migrations output.
RESET_STEP = "Reset the staging schema baseline"
MIGRATIONS_SELECTOR = "needs.plan.outputs.migrations == 'true'"
# The chain apply the reset has to precede, and the copy of the script it has to
# run. `release/foundation/` is written by one build step gated on
# `infra == 'true'`, so on a migrations-only push the sealed copy is not in the
# artifact at all and only the checkout has one.
MIGRATE_STAGING = "migrate-through-worker.sh staging"
RESET_SCRIPT = "infra/database-access/reset-staging-baseline.sh"

@log = ViolationLog.new
@cd = WorkflowDocument.load(CD_FILE)
@source = File.read(CD_FILE)

def steps_using(job, action)
  @cd.steps_of(job).select { |step| step["uses"].to_s.start_with?("#{action}@") }
end

def all_steps
  @cd.jobs.each_key.flat_map { |job| @cd.steps_of(job) }
end

def assert_one_build_one_artifact
  uploads = @cd.jobs.each_key.select { |job| steps_using(job, UPLOAD).any? }
  @log.unless_true(uploads == ["build"],
                   "cd.yml: exactly one job may upload the release artifact (got #{uploads.join(', ')})")
  names = all_steps.map { |step| step.dig("with", "name") }.compact
  @log.unless_true(names.uniq == [ARTIFACT],
                   "cd.yml: build and every consumer must name the one artifact #{ARTIFACT}")
end

def assert_every_stage_downloads_the_artifact
  (STAGING_JOBS - ["smoke"] + ["promote-production"]).each do |job|
    downloads = steps_using(job, DOWNLOAD)
    @log.unless_true(downloads.any?, "cd.yml:#{job}: must deploy the built artifact, not a fresh checkout")
    @log.unless_true(downloads.all? { |step| step.dig("with", "name") == ARTIFACT },
                     "cd.yml:#{job}: must name #{ARTIFACT}, not take whichever artifact the run holds")
  end
end

# A tag or a manual dispatch would be a second deployment path, the one thing
# the whole design forbids (spec §二).
def assert_push_to_main_is_the_only_trigger
  triggers = @cd.triggers
  @log.unless_true(triggers.keys == ["push"],
                   "cd.yml: `push` must be the only trigger (got #{triggers.keys.join(', ')})")
  @log.unless_true(triggers.dig("push", "branches") == ["main"], "cd.yml: only main deploys")
  @log.unless_true(triggers.dig("push", "tags").nil?, "cd.yml: a tag trigger is a second deployment path")
end

def step_index(job, marker)
  @cd.steps_of(job).index { |step| "#{step['name']}#{step['uses']}#{step['run']}".include?(marker) }
end

# `pulumi package add` generates the SDK the sealed program imports, so the CLI
# has to be installed before the seal step, not merely present in the job.
def assert_build_installs_pulumi_before_sealing
  cli = step_index("build", "pulumi/actions")
  seal = step_index("build", "pulumi package add")
  @log.unless_true(!cli.nil? && !seal.nil? && cli < seal,
                   "cd.yml:build: the pinned Pulumi CLI must be installed before the SDK is generated")
end

def rebuild_markers_in(job)
  text = @cd.steps_of(job).map { |step| "#{step['uses']}\n#{step['run']}" }.join("\n")
  REBUILD_MARKERS.select { |marker| text.match?(marker) }.map(&:source)
end

def assert_production_never_rebuilds
  found = rebuild_markers_in("promote-production")
  @log.unless_true(found.empty?,
                   "cd.yml:promote-production: must promote the artifact, not rebuild (#{found.join(', ')})")
end

def assert_skip_propagation
  CHAIN.each_with_index do |job, index|
    next if index.zero?

    @log.unless_true(Array(@cd.dig("jobs", job, "needs")).sort == CHAIN[0...index].sort,
                     "cd.yml:#{job}: needs must list every earlier job (#{CHAIN[0...index].join(', ')})")
  end
end

def plan_script
  @cd.steps_of("plan").map { |step| step["run"] }.compact.join("\n")
end

def assert_plan_guards
  @log.unless_true(plan_script.match?(LAST_SUCCESS_QUERY) && plan_script.include?(LAST_SUCCESS_SHA),
                   "cd.yml:plan: must take its range base from the head of the last successful CD " \
                   "run on main, not from the previous push")
  @log.unless_true(plan_script.include?(ANCESTOR_CHECK),
                   "cd.yml:plan: must fall back when the last successful sha is not an ancestor of this head")
  @log.unless_true(plan_script.include?("$EVENT_BEFORE"),
                   "cd.yml:plan: must fall back to `github.event.before` when the API names no usable run")
  @log.unless_true(@cd.dig("jobs", "plan", "permissions").to_h["actions"] == "read",
                   "cd.yml:plan: reading the Actions API needs `actions: read` on the job")
  @log.unless_true(plan_script.include?(ZERO_SHA),
                   "cd.yml:plan: must fall back off a zero `before` instead of failing the push")
  @log.unless_true(plan_script.include?(HEAD_GUARD),
                   "cd.yml:plan: must refuse a head origin/main has already moved past")
  %w[packages deploy].each do |output|
    @log.unless_true(@cd.dig("jobs", "plan", "outputs").to_h.key?(output),
                     "cd.yml:plan: must publish the `#{output}` output")
  end
end

def assert_concurrency_group(job, group)
  concurrency = @cd.dig("jobs", job, "concurrency").to_h
  @log.unless_true(concurrency["group"] == group, "cd.yml:#{job}: concurrency group must be #{group}")
  @log.unless_true(concurrency["cancel-in-progress"] == false,
                   "cd.yml:#{job}: a delivery job must never be cancelled mid-flight")
  @log.unless_true(concurrency["queue"] == "max",
                   "cd.yml:#{job}: must queue superseded jobs instead of cancelling the pending one")
end

def assert_delivery_concurrency
  STAGING_JOBS.each { |job| assert_concurrency_group(job, "cd-staging") }
  assert_concurrency_group("promote-production", "cd-production")
  @log.unless_true(@cd["concurrency"].nil?,
                   "cd.yml: a workflow-level group would put the production gate back in front of staging")
end

def assert_environments
  STAGING_JOBS.each do |job|
    @log.unless_true(@cd.dig("jobs", job, "environment") == "staging",
                     "cd.yml:#{job}: must run in the staging environment")
  end
  @log.unless_true(@cd.dig("jobs", "promote-production", "environment") == "production",
                   "cd.yml:promote-production: the approval gate is the production environment")
end

def assert_stages_run_only_on_a_built_artifact
  (STAGING_JOBS + ["promote-production"]).each do |job|
    @log.unless_true(@cd.dig("jobs", job, "if").to_s.include?(BUILD_GUARD),
                     "cd.yml:#{job}: must run only on a successful build (#{BUILD_GUARD})")
  end
end

def conditions_of(job)
  @cd.steps_of(job).map { |step| step["if"].to_s } << @cd.dig("jobs", job, "if").to_s
end

def paired?(condition, selector, pairing)
  !condition.include?(selector) || condition.include?(pairing)
end

# A condition selected by one half of a pair must accept the other half too.
def assert_immutable_pairs
  @cd.jobs.each_key do |job|
    conditions_of(job).product(PAIRS).each do |condition, (selector, pairing, subject)|
      @log.unless_true(paired?(condition, selector, pairing),
                       "cd.yml:#{job}: a step selected by #{selector} must also fire on #{subject}")
    end
  end
end

# One artifact serves both environments, so nothing environment-varying may be
# resolved at build time — the web app reads its public values from the
# committed `RUNTIME_CONFIG` var at request time instead (spec §七 #18).
def assert_no_build_time_environment_values
  @log.unless_true(!@source.include?("VITE_"),
                   "cd.yml: a VITE_* value would make the artifact environment-specific")
end

def jobs_running(step_name)
  @cd.jobs.each_key.select { |job| @cd.steps_of(job).any? { |step| step["name"] == step_name } }
end

def assert_reset_and_its_job_share_one_selector(job)
  step = @cd.steps_of(job).find { |candidate| candidate["name"] == RESET_STEP }
  @log.unless_true(@cd.dig("jobs", job, "if").to_s.include?(MIGRATIONS_SELECTOR),
                   "cd.yml:#{job}: the schema reset must live in a job a schema change selects " \
                   "(#{MIGRATIONS_SELECTOR})")
  @log.unless_true(step["if"].to_s.include?(MIGRATIONS_SELECTOR),
                   "cd.yml:#{job}: the schema reset must not fire on a push carrying no schema change")
end

def assert_reset_precedes_the_chain_apply(job)
  apply = step_index(job, MIGRATE_STAGING)
  @log.unless_true(!apply.nil? && apply > step_index(job, RESET_STEP),
                   "cd.yml:#{job}: the schema reset must run before `#{MIGRATE_STAGING}` in the " \
                   "same job — after it, the reset drops the schema the migrator just applied")
end

def assert_reset_runs_the_checkout_copy(job)
  run = @cd.steps_of(job)[step_index(job, RESET_STEP)]["run"].to_s
  @log.unless_true(run.include?(RESET_SCRIPT) && !run.include?("release/"),
                   "cd.yml:#{job}: the schema reset must run `#{RESET_SCRIPT}` from the checkout — " \
                   "the sealed `release/foundation/` copy is built only on an `infra` push, so on a " \
                   "migrations-only one that path does not exist")
end

def assert_the_schema_reset_pairs_with_a_migration
  jobs = jobs_running(RESET_STEP)
  @log.unless_true(!jobs.empty?, "cd.yml: no job runs the #{RESET_STEP.inspect} step any more")
  jobs.each do |job|
    assert_reset_and_its_job_share_one_selector(job)
    assert_reset_precedes_the_chain_apply(job)
    assert_reset_runs_the_checkout_copy(job)
  end
end

ASSERTIONS = %i[
  assert_push_to_main_is_the_only_trigger assert_one_build_one_artifact
  assert_every_stage_downloads_the_artifact assert_production_never_rebuilds
  assert_build_installs_pulumi_before_sealing assert_skip_propagation
  assert_stages_run_only_on_a_built_artifact assert_plan_guards assert_immutable_pairs
  assert_delivery_concurrency assert_environments assert_no_build_time_environment_values
  assert_the_schema_reset_pairs_with_a_migration
].freeze

def main
  ASSERTIONS.each { |assertion| send(assertion) }
  @log.report("CD shape contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
