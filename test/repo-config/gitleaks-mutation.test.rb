# SUT: .gitleaks.toml and its default-rule inheritance.
require "minitest/autorun"
require "open3"
require "tmpdir"

class GitleaksMutationTest < Minitest::Test
  ROOT = File.expand_path("../..", __dir__)
  CONTRACT = File.join(ROOT, "test/repo-config/gitleaks.test.rb")
  CONFIG = File.join(ROOT, ".gitleaks.toml")

  EXTEND_BLOCK = /^\[extend\]\n\s*useDefault\s*=\s*true\n/
  USE_DEFAULT = /useDefault\s*=\s*true/
  ALLOWLIST_PATHS = /paths\s*=\s*\[.*\]/
  ALLOWLIST = "[allowlist]"
  ZERO_RULES = "zero rules"

  def reject_config(path, label, consequence)
    out, err, status = Open3.capture3({ "GITLEAKS_CONFIG" => path }, RbConfig.ruby, CONTRACT)
    refute status.success?, "mutation survived: #{label}"
    assert_includes out + err, consequence, "mutation must name its consequence: #{label}"
  end

  def probe(source, label, consequence = ZERO_RULES)
    Dir.mktmpdir("gitleaks-config-mutation-") do |dir|
      copy = File.join(dir, ".gitleaks.toml")
      File.write(copy, source)
      reject_config(copy, label, consequence)
    end
  end

  def probe_absent(label, consequence)
    Dir.mktmpdir("gitleaks-config-mutation-") do |dir|
      reject_config(File.join(dir, ".gitleaks.toml"), label, consequence)
    end
  end

  def mutate(needle, replacement, label, consequence = ZERO_RULES)
    source = File.read(CONFIG)
    changed = source.sub(needle, replacement)
    refute_equal source, changed, "mutation needle missing: #{label}"
    probe(changed, label, consequence)
  end

  def test_accepts_the_committed_configuration
    out, err, status = Open3.capture3({ "GITLEAKS_CONFIG" => CONFIG }, RbConfig.ruby, CONTRACT)
    assert status.success?, out + err
  end

  def test_rejects_default_rules_relocated_into_the_allowlist
    source = File.read(CONFIG)
    changed = source.sub(EXTEND_BLOCK, "") + "\n  useDefault = true\n"
    refute_equal source, changed, "relocation mutation must change the config"
    probe(changed, "useDefault relocated into [allowlist]")
  end

  def test_rejects_deleted_configuration
    probe_absent("config file deleted", "falls back to its default rules")
  end

  def test_rejects_deleted_extend_table
    mutate(EXTEND_BLOCK, "", "[extend] table deleted")
  end

  def test_rejects_disabled_default_rules
    mutate(USE_DEFAULT, "useDefault = false", "useDefault flipped to false")
  end

  def test_rejects_renamed_extend_table
    mutate("[extend]", "[extended]", "[extend] table renamed")
  end

  def test_rejects_commented_default_rules
    mutate(USE_DEFAULT, "# useDefault = true", "useDefault commented out")
  end

  def test_rejects_disabled_inherited_rules
    mutate(USE_DEFAULT, "useDefault = true\n  disabledRules = [\"github-pat\"]",
           "inherited rules dropped by name", "the named rules stop running")
  end

  def test_rejects_allowlist_for_every_path
    mutate(ALLOWLIST_PATHS, "paths = ['''.*''']",
           "allowlist path widened to every file", "exempt from every rule")
  end

  def test_rejects_allowlist_for_every_value
    mutate(ALLOWLIST, "#{ALLOWLIST}\n  regexes = ['''.*''']",
           "allowlist regex hid every secret value", "dropped before they are reported")
  end

  def test_rejects_stopwords_that_silence_a_rule_class
    mutate(ALLOWLIST, "#{ALLOWLIST}\n  stopwords = [\"GHP_\"]",
           "allowlist stopword silenced a whole rule class", "silencing that rule class")
  end
end
