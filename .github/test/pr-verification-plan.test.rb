# SUT: pr-verification.yml plan selects dependent packages and routes workflow/action changes to real lanes.
require "minitest/autorun"
require "psych"

class PrVerificationPlanTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  FILE = File.join(ROOT, ".github/workflows/pr-verification.yml")

  def setup
    @source = File.read(FILE)
    @ci = Psych.safe_load(@source, aliases: true)
  end

  def test_routes_workflow_and_action_sources_together
    paths = @ci.dig("jobs", "plan", "steps").find { |step| step["id"] == "paths" }
    filters = Psych.safe_load(paths.dig("with", "filters"), aliases: true)
    assert_includes filters.fetch("workflows"), ".github/workflows/**"
    assert_includes filters.fetch("workflows"), ".github/actions/**"
    assert_includes filters.fetch("workflows"), ".github/scripts/**"
    assert_includes filters.fetch("workflows"), ".github/lib/**"
    assert_includes filters.fetch("workflows"), ".github/test/**"
  end

  def test_selects_dependents_but_leaves_owned_lanes_out_of_the_matrix
    %w[animichi-cloudflare-worker @animichi/agent-python animichi-e2e].each do |name|
      assert_includes @source, %Q("#{name}")
    end
    assert_includes @source, '--filter "...[$merge_base]"'
  end

  def test_workflow_and_action_changes_reach_edge_and_python_gates
    assert_includes @source, '["edge-worker"] | unique'
    assert_includes @ci.dig("jobs", "agent", "if"), "outputs.workflows == 'true'"
    assert_equal "${{ steps.paths.outputs.workflows }}", @ci.dig("jobs", "plan", "outputs", "workflows")
  end
end
