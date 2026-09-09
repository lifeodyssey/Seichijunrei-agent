# SUT: PR verification runs every repository check; workflows resolve their local scripts and actions.
require "minitest/autorun"
require "psych"

class WorkflowInvocationsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  WORKFLOWS = Dir.glob(File.join(ROOT, ".github/workflows/*.yml")).sort
  PR_WORKFLOW = File.join(ROOT, ".github/workflows/pr-verification.yml")
  CHECKS = Dir.glob(File.join(ROOT, "{.github/test,test/repo-config}/*.test.rb")) +
           Dir.glob(File.join(ROOT, "{scripts,.github/scripts}/**/*.test.sh"))

  def workflow_steps(paths = WORKFLOWS)
    paths.flat_map do |path|
      Psych.safe_load(File.read(path), aliases: true).fetch("jobs").values.flat_map { |job| job.fetch("steps", []) }
    end.flat_map { |step| [step, *local_action_steps(step)] }
  end

  def local_action_steps(step, ancestors = [])
    ref = step["uses"].to_s
    return [] unless ref.start_with?("./", "$/")
    raise "recursive local action: #{ref}" if ancestors.include?(ref)
    manifest = %w[action.yml action.yaml].map { |name| File.join(ROOT, ref.delete_prefix("$/"), name) }.find { |path| File.file?(path) }
    steps = Psych.safe_load(File.read(manifest), aliases: true).dig("runs", "steps").to_a
    steps.flat_map { |child| [child, *local_action_steps(child, ancestors + [ref])] }
  end

  def invoked_scripts(paths = WORKFLOWS)
    workflow_steps(paths).flat_map { |step| step["run"].to_s.lines }.map(&:strip)
                  .grep(/\A(?:bash|ruby|node|sh|python3?)\s+\S+/).map { |line| line.split[1] }
                  .select { |path| path.start_with?(".github/", "scripts/", "test/") }
  end

  def test_every_committed_check_runs_in_pr_verification
    relative = CHECKS.map { |path| path.delete_prefix("#{ROOT}/") }
    assert_empty relative - invoked_scripts([PR_WORKFLOW]), "committed checks PR verification does not invoke"
  end

  def test_every_invoked_script_exists
    missing = invoked_scripts.reject { |path| File.file?(File.join(ROOT, path)) }
    assert_empty missing, "invoked scripts do not exist"
  end

  def test_every_delivery_script_is_reachable
    scripts = Dir.glob(File.join(ROOT, ".github/scripts/**/*")).select { |path| File.file?(path) }
    relative = scripts.map { |path| path.delete_prefix("#{ROOT}/") }
    assert_empty relative - invoked_scripts, "orphaned .github/scripts files"
  end

  def test_every_local_action_exists
    actions = Dir.glob(File.join(ROOT, ".github/actions/**/action.{yml,yaml}"))
    nested = actions.flat_map { |path| Psych.safe_load(File.read(path), aliases: true).dig("runs", "steps").to_a }
    references = (workflow_steps + nested).map { |step| step["uses"].to_s }.grep(/\A[.$]\//)
    missing = references.reject { |ref| %w[action.yml action.yaml].any? { |name| File.file?(File.join(ROOT, ref.delete_prefix("$/"), name)) } }
    assert_empty missing, "local action references have no manifest"
  end
end
