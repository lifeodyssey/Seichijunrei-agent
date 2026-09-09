#!/usr/bin/env ruby
# frozen_string_literal: true

# The shape of the main-line delivery file (card C1 / #1364). It replaces the
# seven retired `test_cd_*` / `test_promotion_*` / `test_secret_provisioning_*`
# scripts with the handful of properties that still have teeth once the router,
# the per-unit artifacts and the promotion shell script are gone:
#
#   build        one build job, one artifact, and `promote-production` deploys
#                that artifact without rebuilding anything
#   propagation  every job lists every earlier job in `needs`, so a failure two
#                hops back cannot evaporate into a `skipped` result
#   guards       `plan` ranges from the last tree CD put on staging, falls back
#                off a zero `before`, refuses a head origin/main has moved past
#   concurrency  the staging lane and the production lane are separate job-level
#                groups that queue instead of cancelling
#   trigger      a push to main is the only way in — no tag, no dispatch
#   pairing      a unit whose inputs live outside its own pnpm project also
#                fires on the path that carries them
#   artifact     nothing environment-specific is resolved at build time
#
# What the one staging job must contain and in what order — that it alone holds
# `cd-staging`, that every unit publishes from a step of it, and where the schema
# reset sits — is `test_cd_staging_chain_contract.rb`, which #1468 split out when
# those properties stopped being about the job graph. How this file publishes —
# deploy targets, version pinning, the smoke gate, the production migration step
# — is `test_cd_publish_contract.rb`; the credentials it may hold are
# `test_cd_credential_boundary_contract.rb`. The repository-wide meta-invariants
# (timeouts, permissions, action pinning) are `test_workflow_invariants.rb`; the
# CI file's shape is `test_ci_workflow_contract.rb`.
#
# Usage: ruby .github/scripts/test_cd_shape_contract.rb [REPO_ROOT]

require_relative "workflow_document"

ROOT = repository_root
CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
# The delivery order. Each job must name every job before it in `needs`.
CHAIN = %w[plan build stage promote-production].freeze
# One job, holding `cd-staging` from the foundation apply through the smoke
# probe. That it is one, and what it must contain, is
# `test_cd_staging_chain_contract.rb`; here it is simply the staging half of the
# graph, and the rules below are the ones the split into stages never owned.
STAGING_JOBS = %w[stage].freeze
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
# `github.event.before` is the previous *push*, not the previous *deployment*, so
# a failed run's cohort is stranded (#1506). The base is the newest head CD put on
# staging — found by a paged scan, and accepted only if this history descends from
# it, `cat-file` alone being satisfied by a force-pushed tip off `main` (#1507).
DEPLOYED_QUERY = %r{actions/workflows/cd\.yml/runs\?[^"']*\bstatus=completed\b}
PAGED_QUERY = /\bpage=\$\{?page\}?/
PAGE_LOOP = /for page in ([\d ]+); do/
ACCEPTED_BASES = ['head_descends_from "$run_head"', 'head_descends_from "$base"'].freeze
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
  (STAGING_JOBS + ["promote-production"]).each do |job|
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

# `pulumi install` reproduces the committed SDK pins, so the CLI
# has to be installed before the seal step, not merely present in the job.
def assert_build_installs_pulumi_before_sealing
  cli = step_index("build", "pulumi/actions")
  seal = step_index("build", "pulumi install")
  @log.unless_true(!cli.nil? && !seal.nil? && cli < seal,
                   "cd.yml:build: the pinned Pulumi CLI must be installed before the SDK is generated")
end

def assert_neon_sdk_uses_committed_provider_versions
  project = YAML.safe_load(File.read(File.join(ROOT, "infra/database-access/Pulumi.yaml")))
  expected = { "source" => "terraform-provider", "version" => "1.4.0",
               "parameters" => ["kislerdm/neon", "0.17.0"] }
  @log.unless_true(project.dig("packages", "neon") == expected,
                   "Pulumi.yaml: pin both the Terraform bridge and the Neon provider versions")
  build = @cd.steps_of("build").map { |step| step["run"] }.compact.join("\n")
  @log.unless_true(!build.include?("pulumi package add"),
                   "cd.yml:build: install committed provider pins instead of resolving them again")
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
  @log.unless_true(plan_script.match?(DEPLOYED_QUERY) && plan_script.include?("head_sha"),
                   "cd.yml:plan: must base its range on a completed run's head, not on the previous push")
  @log.unless_true(plan_script.match?(PAGED_QUERY) && plan_script[PAGE_LOOP, 1].to_s.split.size > 1,
                   "cd.yml:plan: must scan more than one page, under a literal cap — one page may hold no green smoke")
  @log.unless_true(plan_script.include?(ANCESTOR_CHECK) && ACCEPTED_BASES.all? { |call| plan_script.include?(call) },
                   "cd.yml:plan: both candidate bases must be ones this head descends from, not merely resolvable ones")
  @log.unless_true(plan_script.include?("$EVENT_BEFORE"),
                   "cd.yml:plan: must fall back to `github.event.before` when no candidate run qualifies")
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

ASSERTIONS = %i[
  assert_push_to_main_is_the_only_trigger assert_one_build_one_artifact
  assert_every_stage_downloads_the_artifact assert_production_never_rebuilds
  assert_build_installs_pulumi_before_sealing assert_skip_propagation
  assert_neon_sdk_uses_committed_provider_versions
  assert_stages_run_only_on_a_built_artifact assert_plan_guards assert_immutable_pairs
  assert_delivery_concurrency assert_environments assert_no_build_time_environment_values
].freeze

def main
  ASSERTIONS.each { |assertion| send(assertion) }
  @log.report("CD shape contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
