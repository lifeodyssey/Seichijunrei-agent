# SUT: pr-verification.yml e2e job selects browser sources and runs the browser package gates.
require "minitest/autorun"
require "psych"

class PrVerificationBrowserTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  BROWSER_FILTERS = %w[web e2e deps].freeze
  BROWSER_SCRIPTS = %w[lint typecheck test].freeze
  RETIRED_BROWSER_COMPOSITE = "cross-stack-e2e"

  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def browser_step_source
    @ci.dig("jobs", "e2e", "steps").to_a.map { |step| "#{step['uses']}#{step['run']}" }.join("\n")
  end

  def test_browser_lane_is_selected_by_the_plan
    condition = @ci.dig("jobs", "e2e", "if").to_s
    BROWSER_FILTERS.each do |filter|
      assert(condition.include?("needs.plan.outputs.#{filter} == 'true'"),
                       "pr-verification.yml:e2e: must run when the `#{filter}` filter matched")
    end
  end

  def test_browser_lane_runs_the_package
    source = browser_step_source
    assert(source.include?('pnpm --filter animichi-e2e run "$script"'),
                     "pr-verification.yml:e2e: must run the browser package's own scripts")
    scripts = source[/^\s*for script in ([^;]+); do/, 1].to_s.split
    assert(scripts == BROWSER_SCRIPTS,
                     "pr-verification.yml:e2e: must run exactly #{BROWSER_SCRIPTS.join(', ')} " \
                     "(got #{scripts.join(', ')})")
    assert(!source.include?(RETIRED_BROWSER_COMPOSITE),
                     "pr-verification.yml:e2e: the retired #{RETIRED_BROWSER_COMPOSITE} composite is back")
  end

  def test_native_runtime_changes_select_the_browser_lane
    paths = @ci.dig("jobs", "plan", "steps").find { |step| step["id"] == "paths" }
    filters = Psych.safe_load(paths.dig("with", "filters"), aliases: true)
    %w[workers/edge/** packages/agent/** packages/pi-session-neon/** packages/test-postgres/** migrations/neon/**].each do |path|
      assert_includes filters.fetch("e2e"), path
    end
  end

  def test_native_browser_database_is_prepared_before_the_package_gate
    source = browser_step_source
    assert_includes source, "ariga/setup-atlas"
    assert_includes source, "docker build -f apps/agent/docker/test-postgres/Dockerfile"
    assert_operator source.index("ariga/setup-atlas"), :<, source.index('pnpm --filter animichi-e2e')
    assert_operator source.index("docker build"), :<, source.index('pnpm --filter animichi-e2e')
  end
end
