# SUT: cd.yml locks each whole environment chain and gates production independently of staging.
require "minitest/autorun"
require "psych"

class CdDeliveryJobsTest < Minitest::Test
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

  def test_exact_job_graph_propagates_selection_and_smoke_failures
    assert_equal %w[select stage promote-production], @cd.fetch("jobs").keys
    assert_equal ["select"], @cd.dig("jobs", "stage", "needs")
    assert_equal %w[select stage], @cd.dig("jobs", "promote-production", "needs")
    assert_includes @cd.dig("jobs", "stage", "if"), "needs.select.result == 'success'"
    assert_includes @cd.dig("jobs", "promote-production", "if"), "needs.stage.result == 'success'"
    assert_includes @cd.dig("jobs", "promote-production", "if"), "needs.select.result == 'success'"
  end

  def test_each_chain_holds_one_non_cancelling_environment_lock
    refute @cd.key?("concurrency")
    assert_equal({ "group" => "cd-staging", "cancel-in-progress" => false }, @cd.dig("jobs", "stage", "concurrency"))
    assert_equal({ "group" => "cd-production", "cancel-in-progress" => false }, @cd.dig("jobs", "promote-production", "concurrency"))
  end

  def test_production_approval_does_not_hold_the_staging_lock
    assert_equal "staging", @cd.dig("jobs", "stage", "environment")
    assert_equal "production", @cd.dig("jobs", "promote-production", "environment")
    refute_includes @cd.dig("jobs", "stage", "needs"), "promote-production"
    refute_includes @cd.to_s, "queue"
  end
end
