# SUT: .gitleaks.toml and its default-rule inheritance.
require "minitest/autorun"

class GitleaksConfigTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONFIG = ENV.fetch("GITLEAKS_CONFIG", File.join(ROOT, ".gitleaks.toml"))
  CONSEQUENCE = 'gitleaks runs with zero rules and reports "no leaks found" for every secret'
  ABSENT = "gitleaks falls back to its default rules and loses the atlas.sum allowlist this file exists for"
  DISABLED = 'the named rules stop running and gitleaks reports "no leaks found" for the secrets they catch'
  EXEMPTED = 'every matching file is exempt from every rule and gitleaks reports "no leaks found" for its secrets'
  HIDDEN = 'the matching secrets are dropped before they are reported, whatever rule found them'
  SILENCED = 'every secret containing it is dropped, silencing that rule class at any entropy'

  SCANNED = [".", ".env", "workers/edge/src/entry.ts"].freeze

  PROBE_BODY = "QWERTYUIOPASDFGHJKLZXCVBNM0123456789"

  REPORTABLE = [
    "ghp_#{PROBE_BODY}",
    "AKIA#{PROBE_BODY[0, 16]}",
    "glpat-#{PROBE_BODY[0, 20]}"
  ].freeze

  LITERAL = /'''(.*?)'''|"""(.*?)"""|'([^']*)'|"((?:[^"\\]|\\.)*)"/m

  def tables(path)
    current = nil
    File.readlines(path, chomp: true).each_with_object({}) do |raw, grouped|
      line = raw.strip
      next if line.empty? || line.start_with?("#")

      header = line[/\A\[\[?\s*([^\[\]]+?)\s*\]\]?\z/, 1]
      current = header || current
      grouped[current] ||= []
      grouped[current] << line unless header
    end
  end

  def allowlist_lines(config)
    config.select { |table, _| table.to_s.split(".").last.to_s.start_with?("allowlist") }
          .values.flatten
  end

  def allowlist_values(config, key)
    keyed = /^#{Regexp.escape(key)}\s*=\s*\[(.*?)\]/m
    arrays = allowlist_lines(config).join("\n").scan(keyed).flatten
    arrays.flat_map { |array| array.scan(LITERAL).flat_map(&:compact) }
  end

  def exempts_scanned_paths?(pattern)
    regexp = Regexp.new(pattern)
    SCANNED.any? { |path| regexp.match?(path) }
  end

  def hides_reported_secret?(pattern)
    regexp = Regexp.new(pattern)
    REPORTABLE.any? { |secret| regexp.match?(secret) }
  end

  def silences_reported_secret?(stopword)
    REPORTABLE.any? { |secret| secret.downcase.include?(stopword.downcase) }
  end

  def setup
    assert File.file?(CONFIG), "#{CONFIG} is missing — #{ABSENT}"
    @config = tables(CONFIG)
  end

  def test_default_rules_remain_enabled
    assert @config.key?("extend"), "#{CONFIG}: no [extend] table — #{CONSEQUENCE}"
    assignment = @config.fetch("extend").find { |line| line.match?(/\AuseDefault\s*=/) }
    refute_nil assignment, "#{CONFIG}: [extend] never sets useDefault — #{CONSEQUENCE}"
    assert_match(/\AuseDefault\s*=\s*true\s*(#.*)?\z/, assignment,
                 "#{CONFIG}: [extend] must set useDefault = true — #{CONSEQUENCE}")
  end

  def test_no_inherited_rule_is_disabled
    disabled = @config.fetch("extend", []).find { |line| line.match?(/\AdisabledRules\s*=/) }
    assert_nil disabled, "#{CONFIG}: [extend] drops inherited rules — #{DISABLED}"
  end

  def test_allowlist_does_not_exempt_scanned_paths
    exempted = allowlist_values(@config, "paths").find { |pattern| exempts_scanned_paths?(pattern) }
    assert_nil exempted, "#{CONFIG}: allowlist path #{exempted.inspect} — #{EXEMPTED}"
  end

  def test_allowlist_does_not_hide_reported_values
    hidden = allowlist_values(@config, "regexes").find { |pattern| hides_reported_secret?(pattern) }
    assert_nil hidden, "#{CONFIG}: allowlist regex #{hidden.inspect} — #{HIDDEN}"
  end

  def test_allowlist_does_not_silence_rule_classes
    silenced = allowlist_values(@config, "stopwords").find { |word| silences_reported_secret?(word) }
    assert_nil silenced, "#{CONFIG}: allowlist stopword #{silenced.inspect} — #{SILENCED}"
  end
end
