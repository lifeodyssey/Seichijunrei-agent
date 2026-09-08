#!/usr/bin/env ruby
# frozen_string_literal: true

# What the one staging job has to contain, and in what order (#1468). This is
# the half of `test_cd_shape_contract.rb` that stopped being about the job graph
# the day the graph lost its staging half: five stage jobs plus a smoke job
# became five units and a probe INSIDE one job, so the properties that used to
# read as "which job needs which" now read as "which step, in which order,
# inside `stage`":
#
#   lane   exactly one job takes the `cd-staging` concurrency group, and every
#          deploy unit publishes from a step of that job. A job-level group is
#          held only while its own job runs, so a stage promoted back out into a
#          job of its own hands the group back mid-chain and lets another run's
#          foundation put an older tree under a newer one
#   reset  the staging schema reset runs exactly where a schema change is what
#          selected it, before the chain it baselines for, off the copy of the
#          script that push actually has
#   probe  the smoke probe is the LAST step, so nothing reaches staging after
#          the thing that checks staging. While smoke was a job of its own,
#          `needs` said this; inside one job it is step order and nothing else
#
# `cd.yml`'s job graph — one build, one artifact, the `needs` chains, the
# concurrency groups, the pairing rules, the trigger — is still
# `test_cd_shape_contract.rb`. How it publishes is `test_cd_publish_contract.rb`;
# the credentials it may hold are `test_cd_credential_boundary_contract.rb`.
#
# Usage: ruby .github/scripts/test_cd_staging_chain_contract.rb [REPO_ROOT]

require_relative "workflow_document"

CD_FILE = File.join(repository_root, ".github", "workflows", "cd.yml")
STAGING_JOB = "stage"
STAGING_GROUP = "cd-staging"
# The five units the one staging job runs, in order, each named by the step that
# publishes it. A unit promoted back out into a job of its own takes its step
# with it, and this list is what notices.
STAGING_UNITS = ["Apply the staging topology stack", "Deploy the migrator Worker",
                 "Deploy the catalog Worker", "Deploy the users Worker",
                 "Deploy the edge Worker", "Deploy the web Worker"].freeze
# The one step that destroys staging data. #1216 fixed it firing on a push that
# carried no schema change; #1469 fixed the mirror defect — the step's own `if:`
# said `migrations`, but the job around it said `infra`, so the intersection was
# "both" and a migrations-only push applied the chain without it. One rule
# covers both readings, and it survives the collapse into one job: the reset's
# step and the job around it must each be selected by the same migrations
# output. The step's `if:` is the whole selector now, and the job's `if` is the
# union of its units — drop the migrations disjunct from that union and a
# migrations-only push never reaches the reset at all, which is the same defect
# #1469 closed, reached from the other side.
RESET_STEP = "Reset the staging schema baseline"
MIGRATIONS_SELECTOR = "needs.plan.outputs.migrations == 'true'"
# The chain apply the reset has to precede, and the copy of the script it has to
# run. `release/foundation/` is written by one build step gated on
# `infra == 'true'`, so on a migrations-only push the sealed copy is not in the
# artifact at all and only the checkout has one.
MIGRATE_STAGING = "migrate-through-worker.sh staging"
RESET_SCRIPT = "infra/database-access/reset-staging-baseline.sh"
# The probe that closes the chain. Its name is pinned to `plan`'s API lookup by
# `test_cd_publish_contract.rb`; what is pinned here is only its position.
SMOKE_STEP = "staging smoke"

@log = ViolationLog.new
@cd = WorkflowDocument.load(CD_FILE)

def step_index(job, marker)
  @cd.steps_of(job).index { |step| "#{step['name']}#{step['uses']}#{step['run']}".include?(marker) }
end

# Two halves, because either alone is satisfiable by the split: nothing else may
# take the group, and every unit must be a step of the one job that does.
def assert_the_staging_chain_is_one_job
  holders = @cd.jobs.each_key.select { |job| @cd.dig("jobs", job, "concurrency", "group") == STAGING_GROUP }
  @log.unless_true(holders == [STAGING_JOB],
                   "cd.yml: one job must hold `#{STAGING_GROUP}` from the foundation apply through " \
                   "the smoke probe (held by #{holders.empty? ? 'nothing' : holders.join(', ')})")
  missing = STAGING_UNITS - @cd.steps_of(STAGING_JOB).map { |step| step["name"] }
  @log.unless_true(missing.empty?,
                   "cd.yml:#{STAGING_JOB}: every staging unit must publish from a step of this job, " \
                   "not a job of its own (missing #{missing.join(', ')})")
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

def jobs_running(step_name)
  @cd.jobs.each_key.select { |job| @cd.steps_of(job).any? { |step| step["name"] == step_name } }
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

# A publish step written below the probe goes out onto a surface nothing then
# probes, and every assertion about the probe's own text still holds.
def assert_nothing_publishes_after_the_probe
  steps = @cd.steps_of(STAGING_JOB)
  @log.unless_true(steps.last.to_h["name"] == SMOKE_STEP,
                   "cd.yml:#{STAGING_JOB}: `#{SMOKE_STEP}` must be the last step — anything after it " \
                   "reaches staging without being probed")
end

def main
  assert_the_staging_chain_is_one_job
  assert_nothing_publishes_after_the_probe
  assert_the_schema_reset_pairs_with_a_migration
  @log.report("CD staging chain: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
