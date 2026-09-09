# SUT: cd.yml delivery jobs preserve locks, environment approval and dependency/pairing conditions.
require "minitest/autorun"
require "psych"

class CdDeliveryJobsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  CHAIN = %w[plan build stage promote-production].freeze
  STAGING_JOBS = %w[stage].freeze
  BUILD_GUARD = "needs.build.result == 'success'"
  PAIRS = [["contains(fromJSON(needs.plan.outputs.packages), 'migrator')",
            "needs.plan.outputs.migrations == 'true'", "a migrations/neon change"],
           ["contains(fromJSON(needs.plan.outputs.packages), 'edge-worker')",
            "needs.plan.outputs.agent == 'true'", "an apps/agent change"]].freeze

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
    @source = File.read(CD_FILE)
  end

  def test_skip_propagation
    CHAIN.drop(1).each_with_index do |job, index|
      assert(Array(@cd.dig("jobs", job, "needs")).sort == CHAIN[0..index].sort,
                       "cd.yml:#{job}: needs must list every earlier job (#{CHAIN[0..index].join(', ')})")
    end
  end

  def assert_concurrency_group(job, group)
    concurrency = @cd.dig("jobs", job, "concurrency").to_h
    assert(concurrency["group"] == group, "cd.yml:#{job}: concurrency group must be #{group}")
    assert(concurrency["cancel-in-progress"] == false,
                     "cd.yml:#{job}: a delivery job must never be cancelled mid-flight")
    assert(concurrency["queue"] == "max",
                     "cd.yml:#{job}: must queue superseded jobs instead of cancelling the pending one")
  end

  def test_delivery_concurrency
    STAGING_JOBS.each { |job| assert_concurrency_group(job, "cd-staging") }
    assert_concurrency_group("promote-production", "cd-production")
    assert(@cd["concurrency"].nil?,
                     "cd.yml: a workflow-level group would put the production gate back in front of staging")
  end

  def test_environments
    STAGING_JOBS.each do |job|
      assert(@cd.dig("jobs", job, "environment") == "staging",
                       "cd.yml:#{job}: must run in the staging environment")
    end
    assert(@cd.dig("jobs", "promote-production", "environment") == "production",
                     "cd.yml:promote-production: the approval gate is the production environment")
  end

  def test_stages_run_only_on_a_built_artifact
    (STAGING_JOBS + ["promote-production"]).each do |job|
      assert(@cd.dig("jobs", job, "if").to_s.include?(BUILD_GUARD),
                       "cd.yml:#{job}: must run only on a successful build (#{BUILD_GUARD})")
    end
  end

  def conditions_of(job)
    @cd.dig("jobs", job, "steps").to_a.map { |step| step["if"].to_s } << @cd.dig("jobs", job, "if").to_s
  end

  def paired?(condition, selector, pairing)
    !condition.include?(selector) || condition.include?(pairing)
  end

  def test_immutable_pairs
    @cd.fetch("jobs").each_key do |job|
      conditions_of(job).product(PAIRS).each do |condition, (selector, pairing, subject)|
        assert(paired?(condition, selector, pairing),
                         "cd.yml:#{job}: a step selected by #{selector} must also fire on #{subject}")
      end
    end
  end
end
