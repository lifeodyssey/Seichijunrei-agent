# SUT: package.json test scripts and pnpm-workspace.yaml.
require "minitest/autorun"
require "json"
require "psych"

class PackageTestSegmentsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  REQUIRED_SEGMENTS = {
    "workers/edge" => %w[test:node test:chat-answer-part test:bundle-smoke test:ratelimit-namespace],
    "workers/catalog" => %w[test:worker],
    "workers/users" => %w[test:worker],
    "workers/migrator" => ["vitest run"],
    "packages/contract" => ["vitest run", "vet:baseline", "test:openapi-drift"],
    "packages/agent" => ["node --test"],
    "packages/eval" => ["node --test", "test:fixture-drift"],
    "packages/test-postgres" => ["node --test"],
    "infra" => ["node --test", "test:program-load"],
    "apps/web" => ["vitest run"],
    "apps/agent" => ["uv run pytest"],
    "e2e" => ["playwright test", "E2E_SERVE_EMITTED_WORKER=1",
              "web-404.spec.ts", "web-maplibre-canary.spec.ts",
              "web-chat-anonymous.spec.ts", "web-hero-query.spec.ts",
              "web-state-ownership.spec.ts", "web-a11y-axe.spec.ts",
              "web-a11y-keyboard.spec.ts", "web-a11y-states.spec.ts",
              "web-cwv.spec.ts", "web-chat-settings-return.spec.ts"]
  }.freeze

  OUT_OF_BAND_SEGMENTS = {
    ["workers/catalog", "test:spike"] => [".github/workflows/pr-verification.yml", "Makefile"]
  }.freeze

  DELEGATED_COMMANDS = {
    ["workers/edge", "test:bundle-smoke"] => "bundle-smoke/",
    ["workers/edge", "test:ratelimit-namespace"] => "check-edge-ratelimit-namespace.sh",
    ["workers/catalog", "test:spike"] => "vitest.spike.config.ts",
    ["packages/contract", "test:openapi-drift"] => "contract-drift.sh",
    ["packages/eval", "test:fixture-drift"] => "eval-fixture-drift.sh",
    ["infra", "test:program-load"] => "infra-check.sh"
  }.freeze

  def manifest_of(directory)
    JSON.parse(File.read(File.join(ROOT, directory, "package.json")))
  end

  def scripts_of(directory)
    manifest_of(directory)["scripts"] || {}
  end

  def workspace_directories
    globs = Psych.safe_load(File.read(File.join(ROOT, "pnpm-workspace.yaml")))["packages"]
    globs.flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
         .map { |path| File.dirname(path).delete_prefix("#{ROOT}/") }
         .sort
  end

  def assert_package_segments(directory, segments)
    scripts = scripts_of(directory)
    refute_empty scripts.fetch("test", ""), "#{directory}/package.json: test script is missing"
    segments.each { |segment| assert_includes scripts["test"], segment, "#{directory}: test must run #{segment}" }
    segments.grep(/^test:/).each { |segment| assert scripts.key?(segment), "#{directory}: #{segment} is undefined" }
  end

  def test_every_declared_segment_runs
    REQUIRED_SEGMENTS.each { |directory, segments| assert_package_segments(directory, segments) }
  end

  def test_manifest_covers_every_workspace_test_lane
    lanes = workspace_directories.select { |directory| scripts_of(directory).key?("test") }
    assert_empty lanes - REQUIRED_SEGMENTS.keys, "pnpm-workspace.yaml: new test lanes need required segments"
  end

  def test_delegated_scripts_keep_their_commands
    DELEGATED_COMMANDS.each do |(directory, script), command|
      assert_includes scripts_of(directory).fetch(script, ""), command, "#{directory}: #{script} must run #{command}"
    end
  end

  def assert_out_of_band_segment(directory, segment, files)
    scripts = scripts_of(directory)
    assert scripts.key?(segment), "#{directory}: #{segment} is undefined"
    refute_includes scripts.fetch("test", ""), segment, "#{directory}: #{segment} must stay outside the pre-push lane"
    command = "pnpm --filter #{manifest_of(directory)['name']} run #{segment}"
    files.each { |file| assert_includes File.read(File.join(ROOT, file)), command, "#{file}: #{command} must run" }
  end

  def test_out_of_band_segments_keep_their_own_lane
    OUT_OF_BAND_SEGMENTS.each { |(directory, segment), files| assert_out_of_band_segment(directory, segment, files) }
  end
end
