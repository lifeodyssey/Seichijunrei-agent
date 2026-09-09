# SUT: setup-workspace/action.yml installs the checked-out workspace with the official Node/pnpm actions.
require "minitest/autorun"
require "psych"

class SetupWorkspaceActionTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  ACTION = File.join(ROOT, ".github/actions/setup-workspace/action.yml")

  def setup
    @action = Psych.safe_load(File.read(ACTION), aliases: true)
    @steps = @action.fetch("runs").fetch("steps")
  end

  def test_installs_the_frozen_workspace_after_the_official_toolchain
    assert_equal "composite", @action.dig("runs", "using")
    assert_match %r{\Apnpm/action-setup@}, @steps.fetch(0).fetch("uses")
    assert_match %r{\Aactions/setup-node@}, @steps.fetch(1).fetch("uses")
    assert_equal "pnpm install --frozen-lockfile --ignore-scripts", @steps.fetch(2).fetch("run")
    assert_equal "bash", @steps.fetch(2).fetch("shell")
  end

  def test_uses_the_repository_node_version_and_lockfile_cache
    settings = @steps.fetch(1).fetch("with")
    assert_equal ".nvmrc", settings.fetch("node-version-file")
    assert File.file?(File.join(ROOT, settings.fetch("node-version-file")))
    assert_equal "pnpm", settings.fetch("cache")
    assert_equal "pnpm-lock.yaml", settings.fetch("cache-dependency-path")
  end
end
