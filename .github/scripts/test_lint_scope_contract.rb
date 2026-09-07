#!/usr/bin/env ruby
# frozen_string_literal: true

# The resolved lint file set (#1437), for both linters.
#
# `test_agent_lane_contract.rb` pins the *command* `make lint` runs, so
# narrowing its path list goes red. It cannot see the set that command
# resolves, and card B2's review seat proved the gap twice: adding `conftest.py`
# and `tests/` to `[tool.ruff] extend-exclude` took the run from 592 files to
# 585 with the guard green, and writing an `apps/agent/.ruff.toml` took it to
# 196. This file closes the mechanisms rather than counting files, so it does
# not rot as source is added. Third instance of the shape in one week, after
# gitleaks running with zero rules (#1434) and the agent lane silently dropping
# three files (#1360): a gate present, green, and covering less than it says.
#
# Usage: ruby .github/scripts/test_lint_scope_contract.rb [REPO_ROOT]

require "json"

require_relative "workflow_document"

# Ruff can drop files out from under an intact command two ways, both measured
# on ruff 0.16.1 against the 592-file baseline: the keys inside the reviewed
# config, and a second config file that replaces it whole.
#
# Keys — `conftest.py` in `[tool.ruff] extend-exclude` gives 586; `extend =`
# pulls another file's exclusions in (195); `[tool.ruff.lint] exclude` hides a
# real F401 in conftest.py while the count stays 592, because `--show-files`
# reports the pre-linter set. Hence both tables, all three keys.
# `[tool.ruff.lint] extend-exclude` needs no assertion: it is not a ruff field
# and ruff exits non-zero on it, which is louder than this file could be.
PYPROJECT = "apps/agent/pyproject.toml"
RUFF_SCOPE_TABLES = %w[tool.ruff tool.ruff.lint].freeze
RUFF_SCOPE_KEYS = %w[exclude extend-exclude extend].freeze
# The one reviewed exclusion, with its content: vulture's whitelist is a
# bare-name DSL artifact rather than importable Python (pyproject.toml:87-89).
# Appending to this list is the cheapest way to shrink the set, so the entries
# are pinned too — as content, so reformatting the array cannot false-alarm.
RUFF_REVIEWED_EXCLUSIONS = { "tool.ruff.extend-exclude" => ["vulture_whitelist.py"] }.freeze

# Files — ruff takes the *closest* config per file and merges nothing, so a
# second one replaces rather than extends. `.ruff.toml` beats `ruff.toml` beats
# `pyproject.toml` per directory, a nested config owns its subtree, and a
# `pyproject.toml` counts only with a `[tool.ruff]` table. Measured: an
# `apps/agent/.ruff.toml` or `ruff.toml` gives 196, a nested one under
# `src/animichi/tests/` gives 266, and none is gitignored. The CLI needs no
# assertion of its own: `--config`/`--isolated` cannot reach the recipe line
# `test_agent_lane_contract.rb` pins with a trailing newline, and ruff 0.16.1
# has no RUFF_CONFIG variable (absent from `ruff check --help`; exporting it
# still gives 592).
RUFF_SIBLING_CONFIGS = %w[.ruff.toml ruff.toml].freeze
RUFF_CONFIG_GLOBS = (RUFF_SIBLING_CONFIGS + ["pyproject.toml"]).map { |name| "apps/agent/**/#{name}" }.freeze

# oxlint's equivalent is `ignorePatterns` in each package's `.oxlintrc.json`,
# and that is its whole exclusion mechanism here: no `.oxlintignore` exists and
# no `lint:oxlint` script passes an ignore flag (package.json:8 of apps/web,
# workers/catalog, workers/users, workers/migrator, e2e). Unlike ruff's it
# cannot be banned — the lists already drop hand-written source such as
# `vite.config.ts` — so the reviewed content is what is pinned, in both
# directions: an unlisted config is the same fail-open, a package arriving with
# its own source pre-ignored.
#
# Six configs is the whole of that mechanism, not the whole oxlint surface.
# `packages/eval`, `packages/test-postgres` and `workers/edge` lint with no
# `.oxlintrc.json`, and the root `lint:oxlint` filters (package.json:9) omit
# `packages/contract` and `workers/edge` entirely. Both are #1452, not this
# card, and neither is reachable through `ignorePatterns`.
OXLINT_CONFIG = ".oxlintrc.json"
OXLINT_REVIEWED_IGNORES = {
  # The shared base ignores nothing; every package extends it, so a pattern
  # added here would leave the linted set of all six at once.
  "." => [],
  "apps/web" => ["node_modules/**", ".output/**", ".nitro/**", ".tanstack/**", "coverage/**",
                 "dist/**", "vitest*.config.ts", "vite.config.ts", "**/routeTree.gen.ts"],
  "e2e" => ["node_modules/**", "test-results/**", "playwright-report/**", ".auth/**",
            "generated/**", "agent-discovered/**", "visual/report/**", "visual/canonical/**"],
  "workers/catalog" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                        "vitest.config.ts", "vitest.spike.config.ts"],
  "workers/migrator" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                         "vitest.config.ts"],
  "workers/users" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                      "vitest.config.ts"]
}.freeze

@log = ViolationLog.new

def lines_of(path)
  File.readlines(File.join(repository_root, path))
end

# Ruby's stdlib has no TOML parser, and this needs only three keys of two named
# tables, so it reads them line by line: a `#` line is invisible, so a
# commented-out key cannot trip the guard, and a key counts only under the
# `[table]` header in force, so a key elsewhere cannot satisfy it.
def declared_ruff_exclusions
  lines = lines_of(PYPROJECT)
  table = nil
  lines.each_with_index.each_with_object({}) do |(line, index), keys|
    next if line.lstrip.start_with?("#")
    table = Regexp.last_match(1) if line =~ /\A\[([^\[\]]+)\]\s*\z/
    next unless RUFF_SCOPE_TABLES.include?(table) && line =~ /\A([\w-]+)\s*=/
    name = Regexp.last_match(1)
    keys["#{table}.#{name}"] = toml_strings(whole_value(lines, index)) if RUFF_SCOPE_KEYS.include?(name)
  end
end

# A TOML value may run past its own line; take lines until the brackets the key
# opened close again, or a reformatted array reads as the single token `[`.
def whole_value(lines, index)
  value = lines[index].split("=", 2).last.to_s
  while value.count("[") > value.count("]") && index < lines.length - 1
    index += 1
    value += lines[index]
  end
  value
end

# Content, not source text: `['x']`, `["x"]` and `["x"]` spread over four lines
# are one exclusion and must compare equal; an added entry is a different one.
def toml_strings(value)
  value.scan(/"([^"]*)"|'([^']*)'/).map { |double, single| double || single }
end

def render_exclusions(entries)
  return "none" if entries.empty?

  entries.map { |name, value| "#{name} = [#{value.join(', ')}]" }.join(", ")
end

def assert_ruff_excludes_only_what_was_reviewed
  declared = declared_ruff_exclusions
  @log.unless_true(declared == RUFF_REVIEWED_EXCLUSIONS,
                   "#{PYPROJECT}: ruff's file-set keys must be exactly " \
                   "#{render_exclusions(RUFF_REVIEWED_EXCLUSIONS)} (got #{render_exclusions(declared)}); " \
                   "anything else drops files from the only ruff run CI has while the command string " \
                   "`test_agent_lane_contract.rb` pins stays intact, so the set shrinks with every gate green")
end

# ruff skips a pyproject.toml with no `[tool.ruff]` section when it looks for
# the closest config, so only those count as one here.
def declares_ruff_settings?(path)
  lines_of(path).any? { |line| line =~ /\A\[tool\.ruff(\.[\w.-]+)?\]\s*\z/ }
end

def discovered_ruff_configs
  Dir.glob(RUFF_CONFIG_GLOBS, base: repository_root)
     .reject { |path| path.split("/").include?("node_modules") }
     .select { |path| !path.end_with?("pyproject.toml") || declares_ruff_settings?(path) }
     .sort
end

def assert_ruff_reads_only_the_reviewed_config
  found = discovered_ruff_configs
  @log.unless_true(found == [PYPROJECT],
                   "the only ruff configuration under apps/agent must be #{PYPROJECT} (found " \
                   "#{found.join(', ')}); ruff takes the closest config per file and merges nothing, so a " \
                   "sibling .ruff.toml or a nested [tool.ruff] replaces the reviewed one whole — measured, " \
                   "an apps/agent/.ruff.toml took `ruff check .` from 592 files to 196, gate still green")
end

def declared_oxlint_ignores
  paths = Dir.glob("**/#{OXLINT_CONFIG}", base: repository_root)
             .reject { |path| path.split("/").include?("node_modules") }
  paths.each_with_object({}) do |path, ignores|
    parsed = JSON.parse(File.read(File.join(repository_root, path)))
    ignores[File.dirname(path)] = Array(parsed["ignorePatterns"])
  end
end

def assert_every_oxlint_config_is_reviewed
  found = declared_oxlint_ignores.keys.sort
  @log.unless_true(found == OXLINT_REVIEWED_IGNORES.keys.sort,
                   "the reviewed oxlint configs are #{OXLINT_REVIEWED_IGNORES.keys.sort.join(', ')} " \
                   "(found #{found.join(', ')}); an unreviewed #{OXLINT_CONFIG} can ignore its own package's " \
                   "source, and a deleted one takes its package out of the type-aware lane entirely")
end

def render_patterns(patterns)
  patterns.empty? ? "none" : patterns.join(", ")
end

def assert_oxlint_ignores_only_what_was_reviewed
  declared_oxlint_ignores.each do |directory, patterns|
    reviewed = OXLINT_REVIEWED_IGNORES[directory]
    next if reviewed.nil?

    @log.unless_true(patterns == reviewed,
                     "#{File.join(directory, OXLINT_CONFIG)}: ignorePatterns must be exactly " \
                     "#{render_patterns(reviewed)} (got #{render_patterns(patterns)}); a pattern added here " \
                     "deletes files from `oxlint --type-aware --deny-warnings` without touching the command")
  end
end

def main
  assert_ruff_excludes_only_what_was_reviewed
  assert_ruff_reads_only_the_reviewed_config
  assert_every_oxlint_config_is_reviewed
  assert_oxlint_ignores_only_what_was_reviewed
  @log.report("lint scope contract: ruff and oxlint resolve their reviewed file sets")
end

main if $PROGRAM_NAME == __FILE__
