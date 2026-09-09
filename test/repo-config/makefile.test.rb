# SUT: Makefile; tests check the Python gate delegates to every arm and writes its promised reports.
require "minitest/autorun"

class MakefileTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  MAKEFILE = File.join(ROOT, "Makefile")
  AGENT_GATE_TARGETS = %w[lint typecheck test test-integration].freeze
  INTEGRATION_REPORT = "coverage-integration.xml"
  INTEGRATION_FLOOR = "--cov-fail-under=0"
  LINT_COMMAND = "cd apps/agent && uv run ruff check ."

  def makefile
    @makefile ||= File.read(MAKEFILE)
  end

  def integration_recipe
    makefile[/^test-integration:\n\t(.+)$/, 1].to_s
  end

  def lint_recipe
    makefile[/^lint:\n((?:\t.*\n)+)/, 1].to_s
  end

  def test_the_gate_lints_the_whole_package
    assert(lint_recipe.include?("#{LINT_COMMAND}\n"),
                     "Makefile: `lint` must run `#{LINT_COMMAND}`; a narrower path drops conftest.py, " \
                     "pyproject.toml and tests/fixtures/ from the only ruff run CI has")
  end

  def test_the_delegated_gate_keeps_its_arms
    assert(makefile.include?("check: #{AGENT_GATE_TARGETS.join(' ')}"),
                     "Makefile: `check` must chain #{AGENT_GATE_TARGETS.join(', ')} — the agent job runs nothing else")
    assert(integration_recipe.include?("--cov-report=xml:#{INTEGRATION_REPORT}"),
                     "Makefile: the integration arm must write #{INTEGRATION_REPORT}, which the `integration` flag uploads")
    assert(integration_recipe.include?(INTEGRATION_FLOOR),
                     "Makefile: the integration arm must carry #{INTEGRATION_FLOOR}; the 87% floor is the unit arm's")
  end
end
