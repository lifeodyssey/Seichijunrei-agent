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
#   smoke      the staging gate probes the two real surfaces, its exit code is
#              what decides the job and it keeps the default success condition —
#              a discarded result or an `always()` each promote a staging nothing
#              probed, the #1198 failure the gate exists to prevent. That nothing
#              runs AFTER it is step order, and belongs to
#              `test_cd_staging_chain_contract.rb` with the rest of that
#   record     the smoke step's `name`, inside the staging job's `name`, is CD's
#              staging-deployment record: `plan` reads both back off the API to
#              find the last head that reached staging, so the two spellings and
#              the lookup are pinned to one another (#1468 made it two hops)
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
DEPLOY_TARGETS = { "stage" => "staging", "promote-production" => "production" }.freeze
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
# A step with no `if:` runs only when every step before it in the job succeeded,
# and that default is most of what makes the probe a gate. `if: ${{ always() }}`
# leaves every assertion in this file holding — the run text is untouched, the
# step is still last, its own exit code still decides — while letting a run
# whose edge publish FAILED reach the probe, pass it against the version still
# deployed, and record this head as one that reached staging. So the absence is
# asserted, together with the two spellings that mean the same thing.
DEFAULT_SUCCESS = ["${{ success() }}", "success()"].freeze
# `plan` decides its range base by asking the API which run last concluded the
# smoke probe `success` (#1506). Since the staging chain became one job (#1468)
# that is a two-hop lookup — the job's display name, then the step's — and each
# hop is a string on one side of an API call, exactly the coupling nothing
# type-checks: rename either, or misspell the jq selector, and the lookup
# returns empty, the base falls silently back to `github.event.before`, and the
# stranded-cohort bug is back with every contract green. All three spellings
# are pinned here, together, because any one alone is worthless — and the plan
# step's own comment names both, so the selector has to be read out of the
# commands rather than the step text.
STAGING_JOB = "stage"
STAGE_JOB_NAME = "CD / staging"
SMOKE_STEP = "staging smoke"
SMOKE_LOOKUP = %(select(.name == "#{STAGE_JOB_NAME}") | .steps[]? | select(.name == "#{SMOKE_STEP}"))
# C3 (#1365) retired the transitional Atlas step: production migrates the way
# staging always has. What is left to pin is that no job applies the chain
# itself — doing so is holding a database credential by definition — and that
# each job names the migrator its own environment gates.
MIGRATION_SCRIPT = "bash scripts/delivery/migrate-through-worker.sh"
MIGRATION_TARGETS = { "stage" => ["staging", "vars.MIGRATOR_STAGING_URL"],
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

# The probe is one step of the staging job now, so every rule below is read off
# that step alone: the job around it publishes, and a `|| true` in a publish
# step is a different question from one in the gate.
def smoke_step
  @cd.steps_of(STAGING_JOB).find { |step| step["name"] == SMOKE_STEP }.to_h
end

def assert_smoke_probes_the_real_surfaces
  text = smoke_step["run"].to_s
  @log.unless_true(text.include?(SMOKE_PROBE), "cd.yml:#{SMOKE_STEP}: must run #{SMOKE_PROBE}")
  SMOKE_SURFACES.each do |url|
    @log.unless_true(text.include?(url), "cd.yml:#{SMOKE_STEP}: must probe #{url}")
  end
end

def smoke_suppressor_keys
  suppressor = SMOKE_ESCAPES.last
  [smoke_step[suppressor], @cd.dig("jobs", STAGING_JOB, suppressor)].compact
end

def last_command(text)
  text.lines.map(&:strip).reject { |line| line.empty? || line.start_with?("#") }.last.to_s
end

# #1198 exists because a staging deploy was verified by exit code alone. A probe
# whose exit code is discarded is the same thing wearing the probe's name.
def assert_smoke_failure_is_decisive
  text = smoke_step["run"].to_s
  SMOKE_ESCAPES.each do |escape|
    @log.unless_true(!text.include?(escape),
                     "cd.yml:#{SMOKE_STEP}: `#{escape}` would let a broken staging promote")
  end
  @log.unless_true(smoke_suppressor_keys.empty?,
                   "cd.yml:#{SMOKE_STEP}: nothing here may survive a failed probe")
  last = last_command(text)
  # Both ends. Ending at the URL alone leaves the line open to a prefix that
  # discards it — `: bash …` keeps every substring this file looks for while the
  # shell's `:` builtin runs nothing at all.
  @log.unless_true(last.start_with?(SMOKE_PROBE),
                   "cd.yml:#{SMOKE_STEP}: the last command must BE the probe, not merely mention it")
  @log.unless_true(last.end_with?(SMOKE_SURFACES.last),
                   "cd.yml:#{SMOKE_STEP}: nothing may follow the probe in it, or its result is not " \
                   "what decides")
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

# Comment lines out: in a block scalar YAML hands `#` through, and the same
# blind spot let a `--dry-run` in a comment excuse a real publish above.
def commands_of(job)
  run_text(job).lines.grep_v(/\A\s*#/).join
end

def assert_plan_reads_the_smoke_step_by_name
  @log.unless_true(@cd.dig("jobs", STAGING_JOB, "name") == STAGE_JOB_NAME,
                   "cd.yml:#{STAGING_JOB}: `name` must stay `#{STAGE_JOB_NAME}` — `plan` reads it " \
                   "back off the API, and a rename empties that lookup instead of failing it")
  @log.unless_true(!smoke_step.empty?,
                   "cd.yml:#{STAGING_JOB}: the probe's step must stay named `#{SMOKE_STEP}` — that " \
                   "name is the second hop of `plan`'s lookup, not decoration")
  @log.unless_true(commands_of("plan").include?(SMOKE_LOOKUP),
                   "cd.yml:plan: must select the probe with `#{SMOKE_LOOKUP}` — a comment naming the " \
                   "job and the step is not the lookup, and a misspelt selector returns empty rather " \
                   "than red")
end

def assert_the_probe_keeps_the_default_success_condition
  condition = smoke_step["if"]
  @log.unless_true(condition.nil? || DEFAULT_SUCCESS.include?(condition.to_s.strip),
                   "cd.yml:#{SMOKE_STEP}: must keep the default success condition — `#{condition}` " \
                   "lets a run whose publish failed probe the version already deployed and record " \
                   "this head as live on staging")
end

def main
  assert_deploys_pin_wrangler
  assert_deploys_tag_the_version
  assert_deploys_name_their_own_environment
  assert_shell_publishes_obey_the_same_rules
  assert_smoke_probes_the_real_surfaces
  assert_smoke_failure_is_decisive
  assert_the_probe_keeps_the_default_success_condition
  assert_plan_reads_the_smoke_step_by_name
  assert_every_environment_migrates_through_the_worker
  assert_no_job_applies_the_chain_itself
  assert_baseline_guard_precedes_the_production_migration
  @log.report("CD publish contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
