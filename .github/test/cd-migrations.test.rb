# SUT: cd.yml migrations use the authenticated migrator and reject staging-only baselines in production.
require "minitest/autorun"
require "psych"

class CdMigrationsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  MIGRATION_SCRIPT = "bash scripts/delivery/migrate-through-worker.sh"
  MIGRATION_TARGETS = { "stage" => ["staging", "vars.MIGRATOR_STAGING_URL"],
                        "promote-production" => ["production", "vars.MIGRATOR_PRODUCTION_URL"] }.freeze
  BASELINE_GUARD_SCRIPT = "infra/database-access/production-baseline-guard.sh"
  BASELINE_GUARD_MARKER = "release/migrations/STAGING_ONLY_BASELINE"
  BASELINE_GUARD_RUN = /\A\s*bash\s+#{Regexp.escape(BASELINE_GUARD_SCRIPT)}\s+#{Regexp.escape(BASELINE_GUARD_MARKER)}\b/
  DIRECT_APPLY = ["atlas migrate apply", "ariga/setup-atlas"].freeze

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
  end

  def migration_step(job, environment)
    @cd.dig("jobs", job, "steps").to_a.find { |step| step["run"].to_s.include?("#{MIGRATION_SCRIPT} #{environment}") }
  end

  def test_every_environment_migrates_through_the_worker
    MIGRATION_TARGETS.each do |job, (environment, url)|
      step = migration_step(job, environment)
      assert(!step.nil?, "cd.yml:#{job}: must migrate through `#{MIGRATION_SCRIPT} #{environment}`")
      assert(step.to_h.dig("env", "MIGRATOR_URL").to_s.include?(url),
                       "cd.yml:#{job}: the migration must name the #{environment} migrator (#{url})")
    end
  end

  def test_no_job_applies_the_chain_itself
    @cd.fetch("jobs").each_key do |job|
      text = @cd.dig("jobs", job, "steps").to_a.map { |step| "#{step['uses']}\n#{step['run']}" }.join("\n")
      DIRECT_APPLY.each do |marker|
        assert(!text.include?(marker),
                         "cd.yml:#{job}: `#{marker}` reaches the database outside the migrator")
      end
    end
  end

  def test_baseline_guard_precedes_the_production_migration
    assert(File.exist?(File.join(ROOT, BASELINE_GUARD_SCRIPT)),
                     "cd.yml:promote-production: #{BASELINE_GUARD_SCRIPT} does not exist")
    runs = @cd.dig("jobs", "promote-production", "steps").to_a.map { |step| step["run"].to_s }
    guard = runs.index { |run| run.match?(BASELINE_GUARD_RUN) }
    migrate = runs.index { |run| run.include?("#{MIGRATION_SCRIPT} production") }
    assert(!guard.nil?,
                     "cd.yml:promote-production: no step runs " \
                     "`bash #{BASELINE_GUARD_SCRIPT} #{BASELINE_GUARD_MARKER}`")
    assert(!guard.nil? && !migrate.nil? && guard < migrate,
                     "cd.yml:promote-production: the staging-only guard must refuse before production migrates")
  end
end
