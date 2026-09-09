# SUT: pr-verification.yml agent job routes Python changes and publishes both coverage arms.
require "minitest/autorun"
require "psych"

class PrVerificationAgentTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  AGENT_JOB = "agent"
  AGENT_FILTER_PATHS = ["apps/agent/**", "packages/contract/**"].freeze
  AGENT_TRIGGERS = ["needs.plan.outputs.agent == 'true'", "needs.plan.outputs.deps == 'true'"].freeze
  AGENT_GATE = "make check"
  AGENT_INLINED_TOOLS = %w[pytest ruff mypy vulture].freeze
  AGENT_COVERAGE_FLAGS = %w[unit integration].freeze
  CODECOV_ACTION = "codecov/codecov-action"
  AGENT_COVERAGE_REPORTS = %w[apps/agent/coverage.xml apps/agent/coverage-integration.xml].freeze
  DB_SELECTOR = File.join(ROOT, "apps/agent/src/animichi/tests/db_config.py")
  SELECTOR_VARIABLES = File.read(DB_SELECTOR).scan(/_value\(environment, "([A-Z_]+)"\)/).flatten.uniq.freeze

  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def paths_filters
    raw = @ci.dig("jobs", "plan", "steps").to_a.map { |step| step.dig("with", "filters") }.compact.join("\n")
    Psych.safe_load(raw) || {}
  end

  def test_lane_is_selected_by_its_sources
    selected = Array(paths_filters[AGENT_JOB]).sort
    assert(selected == AGENT_FILTER_PATHS.sort,
                     "pr-verification.yml: the agent filter must be #{AGENT_FILTER_PATHS.join(', ')} " \
                     "(got #{selected.join(', ')})")
    AGENT_TRIGGERS.each do |clause|
      assert(@ci.dig("jobs", AGENT_JOB, "if").to_s.include?(clause),
                       "pr-verification.yml:agent: must run when #{clause}")
    end
  end

  def agent_runs
    @ci.dig("jobs", AGENT_JOB, "steps").to_a.map { |step| step["run"] }.compact
  end

  def test_lane_runs_the_makefile_gate
    assert(agent_runs.any? { |run| run.include?(AGENT_GATE) },
                     "pr-verification.yml:agent: the Python lane must run `#{AGENT_GATE}`")
    AGENT_INLINED_TOOLS.each do |tool|
      assert(agent_runs.none? { |run| run.include?(tool) },
                       "pr-verification.yml:agent: `#{tool}` is inlined here; `#{AGENT_GATE}` owns that list")
    end
  end

  def test_gate_pins_the_offline_arm
    stripped = agent_runs.join("\n").scan(/ -u ([A-Z_]+)/).flatten
    assert(!SELECTOR_VARIABLES.empty?,
                     "db_config.py: no `_value(environment, \"…\")` reads found; the guard cannot be checked")
    SELECTOR_VARIABLES.each do |name|
      assert(stripped.include?(name),
                       "pr-verification.yml:agent: the gate must run under `env -u #{name}` (select_database_arm reads it)")
    end
  end

  def codecov_steps
    @ci.dig("jobs", AGENT_JOB, "steps").to_a.select { |step| step["uses"].to_s.include?(CODECOV_ACTION) }
  end

  def test_lane_publishes_both_arms
    flags = codecov_steps.map { |step| step.dig("with", "flags") }
    files = codecov_steps.map { |step| step.dig("with", "files") }
    assert(flags.sort == AGENT_COVERAGE_FLAGS.sort,
                     "pr-verification.yml:agent: coverage must be published under exactly " \
                     "#{AGENT_COVERAGE_FLAGS.join(', ')} (got #{flags.join(', ')})")
    assert(files.sort == AGENT_COVERAGE_REPORTS.sort,
                     "pr-verification.yml:agent: each arm must upload the report `#{AGENT_GATE}` writes " \
                     "(#{AGENT_COVERAGE_REPORTS.join(', ')}; got #{files.join(', ')})")
  end
end
