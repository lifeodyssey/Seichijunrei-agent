# SUT: workflow jobs install the workspace before using it and create every pnpm store they cache.
require "minitest/autorun"
require "psych"

class WorkflowWorkspaceTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SETUP = "$/.github/actions/setup-workspace"
  WORKSPACE_SCRIPTS = %w[
    .github/scripts/bundle-release-worker.sh .github/scripts/bundle-release-worker.test.sh
    scripts/local-gates/oxlint-changed.sh scripts/local-gates/pre-push-affected.sh
  ].freeze

  def test_indirect_workspace_consumers_exist
    WORKSPACE_SCRIPTS.each { |path| assert File.file?(File.join(ROOT, path)), "missing workspace consumer: #{path}" }
  end

  def needs_workspace?(step)
    run = step["run"].to_s
    run.match?(/\bpnpm (?!ls\b|install\b)\S/) || WORKSPACE_SCRIPTS.any? { |path| run.include?(path) }
  end

  Dir.glob(File.join(ROOT, ".github/workflows/*.yml")).sort.each do |path|
    Psych.safe_load(File.read(path), aliases: true).fetch("jobs").each do |id, job|
      steps = job.fetch("steps", [])
      define_method("test_#{File.basename(path)}_#{id}_installs_before_the_first_workspace_use") do
        used = steps.index { |step| needs_workspace?(step) }
        installed = steps.index { |step| step["uses"] == SETUP || step["run"].to_s.match?(/pnpm install --frozen-lockfile --ignore-scripts/) }
        assert used.nil? || (!installed.nil? && installed < used), "#{id}: workspace use precedes the frozen install"
      end

      define_method("test_#{File.basename(path)}_#{id}_creates_the_store_it_caches") do
        cached = steps.any? { |step| step["uses"].to_s.start_with?("actions/setup-node@") && step.dig("with", "cache") == "pnpm" }
        installs = steps.any? { |step| step["uses"] == SETUP || step["run"].to_s.include?("pnpm install") }
        assert !cached || installs, "#{id}: caching an absent pnpm store fails the setup-node save phase"
      end
    end
  end
end
