# SUT: repository lint-scope configuration; tests preserve the reviewed tool input and install policy.
require "minitest/autorun"
require "json"
require "psych"

class LintScopeTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  PYPROJECT = "apps/agent/pyproject.toml"
  RUFF_SCOPE_TABLES = %w[tool.ruff tool.ruff.lint].freeze
  RUFF_SCOPE_KEYS = %w[exclude extend-exclude extend].freeze
  RUFF_REVIEWED_EXCLUSIONS = { "tool.ruff.extend-exclude" => ["vulture_whitelist.py"] }.freeze
  RUFF_SIBLING_CONFIGS = %w[.ruff.toml ruff.toml].freeze
  RUFF_CONFIG_GLOBS = (RUFF_SIBLING_CONFIGS + ["pyproject.toml"]).map { |name| "apps/agent/**/#{name}" }.freeze
  OXLINT_CONFIG = ".oxlintrc.json"
  OXLINT_REVIEWED_IGNORES = {
    "." => [],
    "apps/web" => ["node_modules/**", ".output/**", ".nitro/**", ".tanstack/**", "coverage/**",
                   "dist/**", "vitest*.config.ts", "vite.config.ts", "**/routeTree.gen.ts"],
    "packages/agent" => ["coverage/**"],
    "e2e" => ["node_modules/**", "test-results/**", "playwright-report/**", ".auth/**",
              "generated/**", "agent-discovered/**", "visual/report/**", "visual/canonical/**"],
    "workers/catalog" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                          "vitest.config.ts", "vitest.spike.config.ts"],
    "workers/migrator" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                           "vitest.config.ts"],
    "workers/users" => ["node_modules/**", ".wrangler/**", "dist/**", "coverage/**",
                        "vitest.config.ts"]
  }.freeze

  def lines_of(path)
    File.readlines(File.join(ROOT, path))
  end

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

  def whole_value(lines, index)
    value = lines[index].split("=", 2).last.to_s
    while value.count("[") > value.count("]") && index < lines.length - 1
      index += 1
      value += lines[index]
    end
    value
  end

  def toml_strings(value)
    value.scan(/"([^"]*)"|'([^']*)'/).map { |double, single| double || single }
  end

  def render_exclusions(entries)
    return "none" if entries.empty?

    entries.map { |name, value| "#{name} = [#{value.join(', ')}]" }.join(", ")
  end

  def test_ruff_excludes_only_what_was_reviewed
    declared = declared_ruff_exclusions
    assert(declared == RUFF_REVIEWED_EXCLUSIONS,
                     "#{PYPROJECT}: ruff's file-set keys must be exactly " \
                     "#{render_exclusions(RUFF_REVIEWED_EXCLUSIONS)} (got #{render_exclusions(declared)}); " \
                     "anything else drops files from the only ruff run CI has while the command string " \
                     "test/repo-config/makefile.test.rb pins stays intact, so the set shrinks with every gate green")
  end

  def declares_ruff_settings?(path)
    lines_of(path).any? { |line| line =~ /\A\[tool\.ruff(\.[\w.-]+)?\]\s*\z/ }
  end

  def discovered_ruff_configs
    Dir.glob(RUFF_CONFIG_GLOBS, base: ROOT)
       .reject { |path| path.split("/").include?("node_modules") }
       .select { |path| !path.end_with?("pyproject.toml") || declares_ruff_settings?(path) }
       .sort
  end

  def test_ruff_reads_only_the_reviewed_config
    found = discovered_ruff_configs
    assert(found == [PYPROJECT],
                     "the only ruff configuration under apps/agent must be #{PYPROJECT} (found " \
                     "#{found.join(', ')}); ruff takes the closest config per file and merges nothing, so a " \
                     "sibling .ruff.toml or a nested [tool.ruff] replaces the reviewed one whole — measured, " \
                     "an apps/agent/.ruff.toml took `ruff check .` from 592 files to 196, gate still green")
  end

  def declared_oxlint_ignores
    paths = Dir.glob("**/#{OXLINT_CONFIG}", base: ROOT)
               .reject { |path| path.split("/").include?("node_modules") }
    paths.each_with_object({}) do |path, ignores|
      parsed = JSON.parse(File.read(File.join(ROOT, path)))
      ignores[File.dirname(path)] = Array(parsed["ignorePatterns"])
    end
  end

  def test_every_oxlint_config_is_reviewed
    found = declared_oxlint_ignores.keys.sort
    assert(found == OXLINT_REVIEWED_IGNORES.keys.sort,
                     "the reviewed oxlint configs are #{OXLINT_REVIEWED_IGNORES.keys.sort.join(', ')} " \
                     "(found #{found.join(', ')}); an unreviewed #{OXLINT_CONFIG} can ignore its own package's " \
                     "source, and a deleted one takes its package out of the type-aware lane entirely")
  end

  def render_patterns(patterns)
    patterns.empty? ? "none" : patterns.join(", ")
  end

  def test_oxlint_ignores_only_what_was_reviewed
    declared_oxlint_ignores.each do |directory, patterns|
      reviewed = OXLINT_REVIEWED_IGNORES[directory]
      assert(patterns == reviewed,
                       "#{File.join(directory, OXLINT_CONFIG)}: ignorePatterns must be exactly " \
                       "#{render_patterns(reviewed)} (got #{render_patterns(patterns)}); a pattern added here " \
                       "deletes files from `oxlint --type-aware --deny-warnings` without touching the command")
    end
  end
end
