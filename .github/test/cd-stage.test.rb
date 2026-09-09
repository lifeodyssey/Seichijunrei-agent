# SUT: cd.yml stage owns the full staging mutation chain and schema reset before smoke.
require "minitest/autorun"
require "psych"

class CdStageTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  STAGING_JOB = "stage"
  STAGING_GROUP = "cd-staging"
  STAGING_UNITS = ["Apply the staging topology stack", "Deploy the migrator Worker",
                   "Deploy the catalog Worker", "Deploy the users Worker",
                   "Deploy the edge Worker", "Deploy the web Worker"].freeze
  RESET_STEP = "Reset the staging schema baseline"
  MIGRATIONS_SELECTOR = "needs.plan.outputs.migrations == 'true'"
  MIGRATE_STAGING = "migrate-through-worker.sh staging"
  RESET_SCRIPT = "infra/database-access/reset-staging-baseline.sh"
  SMOKE_STEP = "staging smoke"

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
  end

  def step_index(job, marker)
    @cd.dig("jobs", job, "steps").to_a.index { |step| "#{step['name']}#{step['uses']}#{step['run']}".include?(marker) }
  end

  def test_the_staging_chain_is_one_job
    holders = @cd.fetch("jobs").each_key.select { |job| @cd.dig("jobs", job, "concurrency", "group") == STAGING_GROUP }
    assert(holders == [STAGING_JOB],
                     "cd.yml: one job must hold `#{STAGING_GROUP}` from the foundation apply through " \
                     "the smoke probe (held by #{holders.empty? ? 'nothing' : holders.join(', ')})")
    missing = STAGING_UNITS - @cd.dig("jobs", STAGING_JOB, "steps").to_a.map { |step| step["name"] }
    assert(missing.empty?,
                     "cd.yml:#{STAGING_JOB}: every staging unit must publish from a step of this job, " \
                     "not a job of its own (missing #{missing.join(', ')})")
  end

  def assert_reset_and_its_job_share_one_selector(job)
    step = @cd.dig("jobs", job, "steps").to_a.find { |candidate| candidate["name"] == RESET_STEP }
    assert(@cd.dig("jobs", job, "if").to_s.include?(MIGRATIONS_SELECTOR),
                     "cd.yml:#{job}: the schema reset must live in a job a schema change selects " \
                     "(#{MIGRATIONS_SELECTOR})")
    assert(step["if"].to_s.include?(MIGRATIONS_SELECTOR),
                     "cd.yml:#{job}: the schema reset must not fire on a push carrying no schema change")
  end

  def assert_reset_precedes_the_chain_apply(job)
    apply = step_index(job, MIGRATE_STAGING)
    assert(!apply.nil? && apply > step_index(job, RESET_STEP),
                     "cd.yml:#{job}: the schema reset must run before `#{MIGRATE_STAGING}` in the " \
                     "same job — after it, the reset drops the schema the migrator just applied")
  end

  def assert_reset_runs_the_checkout_copy(job)
    run = @cd.dig("jobs", job, "steps").to_a[step_index(job, RESET_STEP)]["run"].to_s
    assert(run.include?(RESET_SCRIPT) && !run.include?("release/"),
                     "cd.yml:#{job}: the schema reset must run `#{RESET_SCRIPT}` from the checkout — " \
                     "the sealed `release/foundation/` copy is built only on an `infra` push, so on a " \
                     "migrations-only one that path does not exist")
  end

  def jobs_running(step_name)
    @cd.fetch("jobs").each_key.select { |job| @cd.dig("jobs", job, "steps").to_a.any? { |step| step["name"] == step_name } }
  end

  def test_the_schema_reset_pairs_with_a_migration
    jobs = jobs_running(RESET_STEP)
    assert(!jobs.empty?, "cd.yml: no job runs the #{RESET_STEP.inspect} step any more")
    jobs.each do |job|
      assert_reset_and_its_job_share_one_selector(job)
      assert_reset_precedes_the_chain_apply(job)
      assert_reset_runs_the_checkout_copy(job)
    end
  end

  def test_nothing_publishes_after_the_probe
    steps = @cd.dig("jobs", STAGING_JOB, "steps").to_a
    assert(steps.last.to_h["name"] == SMOKE_STEP,
                     "cd.yml:#{STAGING_JOB}: `#{SMOKE_STEP}` must be the last step — anything after it " \
                     "reaches staging without being probed")
  end
end
