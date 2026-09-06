#!/usr/bin/env ruby
# frozen_string_literal: true

# The lane-segment manifest (card B1 / #1359, from the B0 review hand-off).
#
# After #1358 a package's `test` script IS its CI lane: the affected matrix and
# the pre-push hook both run `pnpm --filter <package> run test` and nothing
# else. That makes the chain inside `test` load-bearing and, until this file,
# unguarded — deleting `&& pnpm run test:ratelimit-namespace` from the edge
# package left every gate green while a real check had stopped running.
#
# The manifest below is the declaration of which segments each package's `test`
# must chain. Two directions are checked, because either alone is a fail-open:
# a listed segment must appear in the `test` script AND be a script the package
# actually defines, and a workspace package that defines `test` without being
# listed here is a violation too (a new lane cannot enter unnoticed).
#
# Usage: ruby .github/scripts/test_package_test_segments.rb [REPO_ROOT]

require "json"
require "yaml"

ROOT = ARGV.fetch(0, `git rev-parse --show-toplevel`.strip)

# package directory => the segments its `test` script must chain, in the sense
# of "this substring appears in the script". A segment named `test:*` must also
# be a defined script of the same package.
REQUIRED_SEGMENTS = {
  "workers/edge" => %w[test:node test:chat-answer-part test:bundle-smoke test:ratelimit-namespace],
  "workers/catalog" => %w[test:worker test:spike],
  "workers/users" => %w[test:worker],
  "workers/migrator" => ["vitest run"],
  "packages/contract" => ["vitest run", "vet:baseline", "test:openapi-drift"],
  "packages/eval" => ["node --test", "test:fixture-drift"],
  "packages/test-postgres" => ["node --test"],
  "infra" => ["node --test", "test:program-load"],
  "apps/web" => ["vitest run"],
  "apps/agent" => ["uv run pytest"],
  # The browser lane's spec set (card B4 / #1362): what the retired
  # `cross-stack-e2e` composite ran, which is the union of its own list and
  # `pr-verification-gate.sh`'s plus `web-chat-settings-return` (owner, on the
  # B4 report: the spec text's "nine" predates that spec, and running nine
  # would be a coverage regression). `test` names them one by one because it
  # serves the emitted Worker itself and the rest of `e2e/` runs against an app
  # someone else started, so a dropped name here is a spec that stops running
  # with every gate still green. E2E_SERVE_EMITTED_WORKER is pinned for the
  # same reason and is the sharper edge of it: without the flag the config
  # starts no server at all and all ten specs fail on a refused connection.
  "e2e" => ["playwright test", "E2E_SERVE_EMITTED_WORKER=1",
            "web-404.spec.ts", "web-maplibre-canary.spec.ts",
            "web-chat-anonymous.spec.ts", "web-hero-query.spec.ts",
            "web-state-ownership.spec.ts", "web-a11y-axe.spec.ts",
            "web-a11y-keyboard.spec.ts", "web-a11y-states.spec.ts",
            "web-cwv.spec.ts", "web-chat-settings-return.spec.ts"]
}.freeze

# A segment that delegates to a repository gate script: the script name alone
# would still be satisfied by `"test:program-load": "true"`, so the command the
# segment must run is pinned as well. These were pinned by the pre-push
# command log until #1358 moved them behind the package scripts.
DELEGATED_COMMANDS = {
  ["workers/edge", "test:bundle-smoke"] => "bundle-smoke/",
  ["workers/edge", "test:ratelimit-namespace"] => "check-edge-ratelimit-namespace.sh",
  ["packages/contract", "test:openapi-drift"] => "contract-drift.sh",
  ["packages/eval", "test:fixture-drift"] => "eval-fixture-drift.sh",
  ["infra", "test:program-load"] => "infra-check.sh"
}.freeze

@violations = []

def manifest_of(directory)
  JSON.parse(File.read(File.join(ROOT, directory, "package.json")))
end

def scripts_of(directory)
  manifest_of(directory)["scripts"] || {}
end

# Every directory pnpm-workspace.yaml resolves to a package, so a package added
# to the workspace cannot escape the manifest below.
def workspace_directories
  globs = YAML.safe_load(File.read(File.join(ROOT, "pnpm-workspace.yaml")))["packages"]
  globs.flat_map { |glob| Dir.glob(File.join(ROOT, glob, "package.json")) }
       .map { |path| File.dirname(path).delete_prefix("#{ROOT}/") }
       .sort
end

def assert_segment_present(directory, script, segment)
  return if script.include?(segment)

  @violations << "#{directory}: `test` no longer runs #{segment}"
end

def assert_segment_defined(directory, scripts, segment)
  return unless segment.start_with?("test:")
  return if scripts.key?(segment)

  @violations << "#{directory}: `test` names #{segment}, which the package does not define"
end

def assert_package(directory, segments)
  scripts = scripts_of(directory)
  script = scripts["test"].to_s
  return @violations << "#{directory}: no `test` script" if script.empty?

  segments.each do |segment|
    assert_segment_present(directory, script, segment)
    assert_segment_defined(directory, scripts, segment)
  end
end

def assert_manifest_is_complete
  listed = REQUIRED_SEGMENTS.keys
  workspace_directories.each do |directory|
    next if listed.include?(directory) || !scripts_of(directory).key?("test")

    @violations << "#{directory}: defines `test` but declares no required segments here"
  end
end

def assert_delegated_command(directory, script, command)
  return if scripts_of(directory).fetch(script, "").include?(command)

  @violations << "#{directory}: `#{script}` no longer runs #{command}"
end

def main
  REQUIRED_SEGMENTS.each { |directory, segments| assert_package(directory, segments) }
  DELEGATED_COMMANDS.each { |(directory, script), command| assert_delegated_command(directory, script, command) }
  assert_manifest_is_complete
  return puts "package test segments: all lanes intact" if @violations.empty?

  puts @violations
  exit 1
end

main if $PROGRAM_NAME == __FILE__
