# SUT: workflow jobs retain time limits, cancellation policy, toolchains and required check contexts.
require "minitest/autorun"
require "psych"

class WorkflowExecutionTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOWS = Dir.glob(File.join(ROOT, ".github/workflows/*.yml")).sort.to_h do |path|
    [File.basename(path), Psych.safe_load(File.read(path), aliases: true)]
  end
  CANCELLATION = {
    "pr-verification.yml" => [true, "${{ github.event_name == 'pull_request' }}"],
    "cd.yml" => [nil, false],
    "agent-eval-nightly.yml" => [nil, false]
  }.freeze

  WORKFLOWS.each do |file, workflow|
    define_method("test_#{file}_does_not_suppress_failures") do
      refute_includes File.read(File.join(ROOT, ".github/workflows", file)), "continue-on-error"
    end

    define_method("test_#{file}_cancellation_matches_its_events") do
      cancel = workflow.dig("concurrency", "cancel-in-progress")
      assert_includes CANCELLATION.fetch(file), cancel, "#{file}: cancellation must not interrupt deployments"
    end

    workflow.fetch("jobs").each do |id, job|
      define_method("test_#{file}_#{id}_has_a_timeout") do
        assert job.key?("timeout-minutes"), "#{file}:#{id}: runner jobs need a time limit"
      end if job.key?("runs-on")

      steps = job.fetch("steps", [])
      used = steps.index { |step| step["run"].to_s.match?(/\buv (run|sync|python|tool)\b/) }
      define_method("test_#{file}_#{id}_installs_uv_before_using_it") do
        provided = steps.index { |step| step["uses"].to_s.start_with?("astral-sh/setup-uv@") }
        refute_nil provided, "#{file}:#{id}: no uv setup"
        assert_operator provided, :<, used
      end unless used.nil?
    end
  end

  def test_pr_verification_groups_superseded_pull_requests
    assert_kind_of String, WORKFLOWS.fetch("pr-verification.yml").dig("concurrency", "group")
  end

  def test_required_contexts_support_the_merge_queue
    workflow = WORKFLOWS.fetch("pr-verification.yml")
    names = workflow.fetch("jobs").map { |id, job| job.fetch("name", id) }
    assert_includes names, "PR Verification"
    assert_includes names, "Security"
    events = workflow["on"] || workflow[true]
    assert_includes events.fetch("merge_group").fetch("branches"), "main"
  end
end
