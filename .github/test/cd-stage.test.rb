# SUT: cd.yml keeps ordered foundation, migration, service publication and smoke in each environment lock.
require "minitest/autorun"
require "psych"

class CdStageTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  def setup
    @cd = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/cd.yml")), aliases: true)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  def step(job, name)
    steps(job).find { |item| item["name"] == name }.tap { |item| refute_nil item, name }
  end

  def position(job, name)
    steps(job).index(step(job, name))
  end

  CHAIN = ["Publish the selected migrator", "Preview the selected native migration graph", "Apply database access", "Apply topology",
           "Apply the selected migration chain", "Publish the selected services", "Smoke the release"].freeze

  def test_each_environment_runs_the_complete_ordered_chain
    %w[stage promote-production].each do |job|
      positions = CHAIN.map { |name| position(job, name) }
      assert_equal positions.sort, positions
      CHAIN.each { |name| refute step(job, name).key?("if"), "#{job}: #{name} must not omit a snapshot unit" }
    end
  end

  def test_no_automatic_schema_reset_or_affected_package_filter
    refute_match(/reset-staging|needs\.plan|fromJSON/, @cd.to_s)
  end

  def test_only_read_only_observation_and_receipt_upload_follow_smoke
    %w[stage promote-production].each do |job|
      after = steps(job).drop(position(job, "Smoke the release") + 1)
      assert_equal 2, after.length
      assert_equal "Record observed deployment identities", after.first["name"]
      assert_match %r{\Aactions/upload-artifact@}, after.last["uses"]
      refute_match(/wrangler deploy|publish-services|migrate-through-worker|command.*up/, after.to_s)
    end
  end
end
