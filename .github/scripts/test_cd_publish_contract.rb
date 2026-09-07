#!/usr/bin/env ruby
# frozen_string_literal: true

# How the main-line delivery file publishes, and what stands between a publish
# and production (card C1 / #1364). This is the half of the retired
# `test_cd_worker_promotion_contract.rb`, `test_promotion_ac5_*` and
# `test_migration_promotion_contract.rb` that still has a subject:
#
#   target     a publish names the environment its own job is the gate for —
#              through `cloudflare/wrangler-action` AND through a shell, because
#              `pnpm exec wrangler deploy … --env production` in a staging stage
#              goes live with no approval and touches no action input
#   version    every publish pins the workspace Wrangler and tags the version
#              `sha-<sha>`, so `wrangler versions list` names the commit — the
#              shell route included, for the reason the target rule covers it
#   smoke      the staging gate probes the two real surfaces, and its exit code
#              is what decides the job — a discarded one promotes a broken
#              staging, which is the #1198 failure the job exists to prevent
#   migration  every environment reaches the database only through the migrator
#              Worker, and the staging-only baseline is refused BEFORE the
#              production migration rather than after it
#
# `cd.yml`'s job graph is `test_cd_shape_contract.rb`; the credentials it may
# hold are `test_cd_credential_boundary_contract.rb`.
#
# Usage: ruby .github/scripts/test_cd_publish_contract.rb [REPO_ROOT]

require "json"
require_relative "workflow_document"

ROOT = repository_root
CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
WRANGLER_ACTION = "cloudflare/wrangler-action"
DEPLOY_TAG = "--tag sha-${{ github.sha }}"
# No stage may publish where another job is the gate: a staging stage carrying
# `--env production` would go live without the production approval at all. A job
# absent from this map may not publish by any route.
DEPLOY_TARGETS = { "stage-migration" => "staging", "stage-services" => "staging",
                   "stage-edge" => "staging", "stage-web" => "staging",
                   "promote-production" => "production" }.freeze
# `--dry-run` builds a bundle; everything else publishes. The exemption is
# per COMMAND, not per line: a lookahead over the whole line let a later dry run
# excuse an earlier real publish (`… --env production && … --dry-run`), and a
# `--dry-run` written in a trailing `#` comment excused the command carrying it
# — in a block scalar YAML hands the comment through, so the contract saw a
# token the shell never would.
PUBLISH_COMMAND = /wrangler deploy\b/
DRY_RUN = /(?:\A|\s)--dry-run(?:\s|\z)/
COMMAND_SEPARATOR = /\n|&&|\|\||;/
SHELL_COMMENT = /\s#.*\z/
SMOKE_PROBE = "bash .github/scripts/staging-smoke-check.sh"
SMOKE_SURFACES = ["https://animichi-staging.zhenjiazhou0127.workers.dev",
                  "https://animichi-web-staging.zhenjiazhou0127.workers.dev"].freeze
# Ways to keep a red probe from failing the job: the first two satisfy every
# assertion about the probe's text while discarding its result; the third is
# banned repository-wide and named here so the smoke job says why.
SMOKE_ESCAPES = ["|| true", "set +e", %w[continue on error].join("-")].freeze
# C3 (#1365) retired the transitional Atlas step: production migrates the way
# staging always has. What is left to pin is that no job applies the chain
# itself — doing so is holding a database credential by definition — and that
# each job names the migrator its own environment gates.
MIGRATION_SCRIPT = "bash scripts/delivery/migrate-through-worker.sh"
MIGRATION_TARGETS = { "stage-migration" => ["staging", "vars.MIGRATOR_STAGING_URL"],
                      "promote-production" => ["production", "vars.MIGRATOR_PRODUCTION_URL"] }.freeze
BASELINE_GUARD = "release/migrations/STAGING_ONLY_BASELINE"
DIRECT_APPLY = ["atlas migrate apply", "ariga/setup-atlas"].freeze

@log = ViolationLog.new
@cd = WorkflowDocument.load(CD_FILE)

def steps_using(job, action)
  @cd.steps_of(job).select { |step| step["uses"].to_s.start_with?("#{action}@") }
end

def run_text(job)
  @cd.steps_of(job).map { |step| step["run"] }.compact.join("\n")
end

def deploy_steps
  @cd.jobs.each_key.flat_map { |job| steps_using(job, WRANGLER_ACTION).map { |step| [job, step] } }
end

def pinned_wrangler
  JSON.parse(File.read(File.join(ROOT, "package.json"))).dig("devDependencies", "wrangler")
end

def assert_deploys_pin_wrangler
  version = pinned_wrangler
  @log.unless_true(!version.nil?, "package.json: the workspace must pin a Wrangler version")
  deploy_steps.each do |job, step|
    @log.unless_true(step.dig("with", "wranglerVersion") == version,
                     "cd.yml:#{job}: publishing must use the pinned Wrangler #{version}")
  end
end

def assert_deploys_tag_the_version
  @log.unless_true(!deploy_steps.empty?, "cd.yml: no job publishes a Worker")
  deploy_steps.each do |job, step|
    command = step.dig("with", "command").to_s
    next unless command.start_with?("deploy ")

    @log.unless_true(command.include?(DEPLOY_TAG),
                     "cd.yml:#{job}: every publish must tag its version #{DEPLOY_TAG}")
  end
end

def assert_deploys_name_their_own_environment
  DEPLOY_TARGETS.each do |job, environment|
    commands = steps_using(job, WRANGLER_ACTION).map { |step| step.dig("with", "command").to_s }
    @log.unless_true(commands.all? { |command| command.include?("--env #{environment}") },
                     "cd.yml:#{job}: every publish here must target --env #{environment}")
  end
end

# Continuations are folded first, so a `--env` wrapped onto the next line is
# still read as part of the command it belongs to; then the text is cut into
# commands and each one loses its trailing shell comment.
def shell_commands(job)
  run_text(job).gsub(/\\\n\s*/, " ").split(COMMAND_SEPARATOR).map { |command| command.sub(SHELL_COMMENT, "").strip }
end

def shell_publishes(job)
  shell_commands(job).select { |command| command.match?(PUBLISH_COMMAND) && !command.match?(DRY_RUN) }
end

def assert_shell_publish_obeys(job, environment, command)
  @log.unless_true(command.include?("--env #{environment}"),
                   "cd.yml:#{job}: a shell publish here must target --env #{environment}")
  @log.unless_true(command.include?(DEPLOY_TAG),
                   "cd.yml:#{job}: a shell publish here must tag its version #{DEPLOY_TAG}")
end

# A publish through `pnpm exec wrangler deploy` satisfies every assertion above
# by never touching a wrangler-action step, so the shell gets both of the rules
# those steps are held to — the environment and the tag. Untagged, a live
# Worker cannot be traced back to a commit, and which route published it is no
# part of that.
def assert_shell_publishes_obey_the_same_rules
  @cd.jobs.each_key do |job|
    environment = DEPLOY_TARGETS[job]
    shell_publishes(job).each do |command|
      @log.unless_true(!environment.nil?, "cd.yml:#{job}: this job must not publish a Worker at all")
      assert_shell_publish_obeys(job, environment, command) unless environment.nil?
    end
  end
end

def assert_smoke_probes_the_real_surfaces
  text = run_text("smoke")
  @log.unless_true(text.include?(SMOKE_PROBE), "cd.yml:smoke: must run #{SMOKE_PROBE}")
  SMOKE_SURFACES.each { |url| @log.unless_true(text.include?(url), "cd.yml:smoke: must probe #{url}") }
end

def smoke_suppressor_keys
  suppressor = SMOKE_ESCAPES.last
  (@cd.steps_of("smoke").map { |step| step[suppressor] } << @cd.dig("jobs", "smoke", suppressor)).compact
end

def last_command(text)
  text.lines.map(&:strip).reject { |line| line.empty? || line.start_with?("#") }.last.to_s
end

# #1198 exists because a staging deploy was verified by exit code alone. A probe
# whose exit code is discarded is the same thing wearing the probe's name.
def assert_smoke_failure_is_decisive
  text = run_text("smoke")
  SMOKE_ESCAPES.each do |escape|
    @log.unless_true(!text.include?(escape), "cd.yml:smoke: `#{escape}` would let a broken staging promote")
  end
  @log.unless_true(smoke_suppressor_keys.empty?, "cd.yml:smoke: nothing here may survive a failed probe")
  last = last_command(text)
  # Both ends. Ending at the URL alone leaves the line open to a prefix that
  # discards it — `: bash …` keeps every substring this file looks for while the
  # shell's `:` builtin runs nothing at all.
  @log.unless_true(last.start_with?(SMOKE_PROBE),
                   "cd.yml:smoke: the last command must BE the probe, not merely mention it")
  @log.unless_true(last.end_with?(SMOKE_SURFACES.last),
                   "cd.yml:smoke: nothing may follow the probe, or its result is not what decides")
end

def migration_step(job, environment)
  @cd.steps_of(job).find { |step| step["run"].to_s.include?("#{MIGRATION_SCRIPT} #{environment}") }
end

def assert_every_environment_migrates_through_the_worker
  MIGRATION_TARGETS.each do |job, (environment, url)|
    step = migration_step(job, environment)
    @log.unless_true(!step.nil?, "cd.yml:#{job}: must migrate through `#{MIGRATION_SCRIPT} #{environment}`")
    @log.unless_true(step.to_h.dig("env", "MIGRATOR_URL").to_s.include?(url),
                     "cd.yml:#{job}: the migration must name the #{environment} migrator (#{url})")
  end
end

# A job that applies the chain itself is holding a database credential by
# definition — decision 6 is what the migrator Worker exists to make structural.
def assert_no_job_applies_the_chain_itself
  @cd.jobs.each_key do |job|
    text = @cd.steps_of(job).map { |step| "#{step['uses']}\n#{step['run']}" }.join("\n")
    DIRECT_APPLY.each do |marker|
      @log.unless_true(!text.include?(marker),
                       "cd.yml:#{job}: `#{marker}` reaches the database outside the migrator")
    end
  end
end

# Order, not presence: a guard placed after the migration reads identically to
# one placed before it, and refuses a cutover that has already happened.
def assert_baseline_guard_precedes_the_production_migration
  runs = @cd.steps_of("promote-production").map { |step| step["run"].to_s }
  guard = runs.index { |run| run.include?(BASELINE_GUARD) }
  migrate = runs.index { |run| run.include?("#{MIGRATION_SCRIPT} production") }
  @log.unless_true(!guard.nil? && !migrate.nil? && guard < migrate,
                   "cd.yml:promote-production: the staging-only guard must refuse before production migrates")
end

def main
  assert_deploys_pin_wrangler
  assert_deploys_tag_the_version
  assert_deploys_name_their_own_environment
  assert_shell_publishes_obey_the_same_rules
  assert_smoke_probes_the_real_surfaces
  assert_smoke_failure_is_decisive
  assert_every_environment_migrates_through_the_worker
  assert_no_job_applies_the_chain_itself
  assert_baseline_guard_precedes_the_production_migration
  @log.report("CD publish contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
