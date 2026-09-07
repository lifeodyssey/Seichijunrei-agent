#!/usr/bin/env ruby
# frozen_string_literal: true

# The Python lane of the pull-request pipeline (card B2 / #1360).
#
#   selection   `apps/agent` and `packages/contract` select the job, and a root
#               dependency change does too
#   gate        it runs `make check` and names no tool of its own, under an
#               `env -u` that strips every variable the database-arm selector
#               reads — the offline Docker arm is the only reachable one
#   coverage    two Codecov uploads, one per arm, each pointing at the report
#               `make check` actually writes
#   scope       `make lint` still lints the whole package, because the job's
#               path-less `ruff check` was retired into it
#
# The job delegates to the Makefile, so the Makefile is where the lane's real
# behaviour lives and this file reads it too. Everything else about the CI
# file's shape (the affected matrix, the aggregates, the image tag) is
# `test_ci_workflow_contract.rb`; the repository-wide meta-invariants are
# `test_workflow_invariants.rb`.
#
# Usage: ruby .github/scripts/test_agent_lane_contract.rb [REPO_ROOT]

require_relative "workflow_document"

CI_FILE = File.join(repository_root, ".github", "workflows", "pr-verification.yml")

# `apps/agent` selects the lane for the obvious reason and `packages/contract`
# because the agent's own suite is written against the contract (#1323), so a
# contract-only PR that breaks the agent must go red.
AGENT_JOB = "agent"
AGENT_FILTER_PATHS = ["apps/agent/**", "packages/contract/**"].freeze
AGENT_TRIGGERS = ["needs.plan.outputs.agent == 'true'", "needs.plan.outputs.deps == 'true'"].freeze
# `make check` is the whole gate, and it is what pre-push runs. A tool named
# directly in the workflow would be CI's own copy of that list, free to drift
# from the Makefile the way the pre-B2 steps had (a `ruff check` without a
# path, a mypy without the eval package).
AGENT_GATE = "make check"
AGENT_INLINED_TOOLS = %w[pytest ruff mypy vulture].freeze
# One Codecov upload per arm, because codecov.yml carries the two flags forward
# separately; a single upload would let one arm's lines vanish from the union.
AGENT_COVERAGE_FLAGS = %w[unit integration].freeze
CODECOV_ACTION = "codecov/codecov-action"

# What the gate delegates to: which arms `make check` runs, which report each
# writes, and which floor each carries.
MAKEFILE = File.join(repository_root, "Makefile")
AGENT_GATE_TARGETS = %w[lint typecheck test test-integration].freeze
INTEGRATION_REPORT = "coverage-integration.xml"
# The 87% floor is the unit arm's (apps/agent/pyproject.toml addopts). The
# integration arm alone covers far less, so it overrides the floor to 0 — put
# the floor back and `make check` fails 150 seconds in for no real reason.
INTEGRATION_FLOOR = "--cov-fail-under=0"
# The retired job ran `ruff check` path-less from apps/agent, i.e. 592 files.
# `src/animichi/ scripts/` is 589 — it drops conftest.py, pyproject.toml and
# tests/fixtures/, which nothing else in CI lints (pre-commit sees staged files
# only). The whole command, so `ruff check ./src` cannot satisfy it.
LINT_COMMAND = "cd apps/agent && uv run ruff check ."
AGENT_COVERAGE_REPORTS = ["apps/agent/coverage.xml", "apps/agent/#{INTEGRATION_REPORT}"].freeze

# The env an offline run must not see. `select_database_arm` is the selector,
# and its own literals are read here rather than copied: a seventh selector
# variable turns this red instead of quietly letting CI reach a live database.
DB_SELECTOR = File.join(repository_root, "apps/agent/src/animichi/tests/db_config.py")
SELECTOR_VARIABLES = File.read(DB_SELECTOR).scan(/_value\(environment, "([A-Z_]+)"\)/).flatten.uniq.freeze

@log = ViolationLog.new
@ci = WorkflowDocument.load(CI_FILE)

# `filters:` is a block scalar the action parses as YAML, so this reads it the
# same way rather than pattern-matching the text.
def paths_filters
  raw = @ci.steps_of("plan").map { |step| step.dig("with", "filters") }.compact.join("\n")
  YAML.safe_load(raw) || {}
end

def assert_lane_is_selected_by_its_sources
  selected = Array(paths_filters[AGENT_JOB]).sort
  @log.unless_true(selected == AGENT_FILTER_PATHS.sort,
                   "pr-verification.yml: the agent filter must be #{AGENT_FILTER_PATHS.join(', ')} " \
                   "(got #{selected.join(', ')})")
  AGENT_TRIGGERS.each do |clause|
    @log.unless_true(@ci.dig("jobs", AGENT_JOB, "if").to_s.include?(clause),
                     "pr-verification.yml:agent: must run when #{clause}")
  end
end

def agent_runs
  @ci.steps_of(AGENT_JOB).map { |step| step["run"] }.compact
end

def assert_lane_runs_the_makefile_gate
  @log.unless_true(agent_runs.any? { |run| run.include?(AGENT_GATE) },
                   "pr-verification.yml:agent: the Python lane must run `#{AGENT_GATE}`")
  AGENT_INLINED_TOOLS.each do |tool|
    @log.unless_true(agent_runs.none? { |run| run.include?(tool) },
                     "pr-verification.yml:agent: `#{tool}` is inlined here; `#{AGENT_GATE}` owns that list")
  end
end

# The comment on that step calls it load-bearing, which is not a check. An
# exported TEST_DB or TEST_DATABASE_URL would otherwise route the integration
# arm at a live database from inside CI.
def assert_gate_pins_the_offline_arm
  stripped = agent_runs.join("\n").scan(/ -u ([A-Z_]+)/).flatten
  @log.unless_true(!SELECTOR_VARIABLES.empty?,
                   "db_config.py: no `_value(environment, \"…\")` reads found; the guard cannot be checked")
  SELECTOR_VARIABLES.each do |name|
    @log.unless_true(stripped.include?(name),
                     "pr-verification.yml:agent: the gate must run under `env -u #{name}` (select_database_arm reads it)")
  end
end

def codecov_steps
  @ci.steps_of(AGENT_JOB).select { |step| step["uses"].to_s.include?(CODECOV_ACTION) }
end

def assert_lane_publishes_both_arms
  flags = codecov_steps.map { |step| step.dig("with", "flags") }
  files = codecov_steps.map { |step| step.dig("with", "files") }
  @log.unless_true(flags.sort == AGENT_COVERAGE_FLAGS.sort,
                   "pr-verification.yml:agent: coverage must be published under exactly " \
                   "#{AGENT_COVERAGE_FLAGS.join(', ')} (got #{flags.join(', ')})")
  @log.unless_true(files.sort == AGENT_COVERAGE_REPORTS.sort,
                   "pr-verification.yml:agent: each arm must upload the report `#{AGENT_GATE}` writes " \
                   "(#{AGENT_COVERAGE_REPORTS.join(', ')}; got #{files.join(', ')})")
end

def makefile
  @makefile ||= File.read(MAKEFILE)
end

def integration_recipe
  makefile[/^test-integration:\n\t(.+)$/, 1].to_s
end

def lint_recipe
  makefile[/^lint:\n((?:\t.*\n)+)/, 1].to_s
end

def assert_the_gate_lints_the_whole_package
  @log.unless_true(lint_recipe.include?("#{LINT_COMMAND}\n"),
                   "Makefile: `lint` must run `#{LINT_COMMAND}`; a narrower path drops conftest.py, " \
                   "pyproject.toml and tests/fixtures/ from the only ruff run CI has")
end

def assert_the_delegated_gate_keeps_its_arms
  @log.unless_true(makefile.include?("check: #{AGENT_GATE_TARGETS.join(' ')}"),
                   "Makefile: `check` must chain #{AGENT_GATE_TARGETS.join(', ')} — the agent job runs nothing else")
  @log.unless_true(integration_recipe.include?("--cov-report=xml:#{INTEGRATION_REPORT}"),
                   "Makefile: the integration arm must write #{INTEGRATION_REPORT}, which the `integration` flag uploads")
  @log.unless_true(integration_recipe.include?(INTEGRATION_FLOOR),
                   "Makefile: the integration arm must carry #{INTEGRATION_FLOOR}; the 87% floor is the unit arm's")
end

def main
  assert_lane_is_selected_by_its_sources
  assert_lane_runs_the_makefile_gate
  assert_gate_pins_the_offline_arm
  assert_lane_publishes_both_arms
  assert_the_delegated_gate_keeps_its_arms
  assert_the_gate_lints_the_whole_package
  @log.report("agent lane contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
