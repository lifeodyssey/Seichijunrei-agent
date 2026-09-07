#!/usr/bin/env ruby
# frozen_string_literal: true

# Proves the static guard actually fails when the config is weakened, so a
# future edit to .gitleaks.toml cannot silently disable secret scanning. Each
# probe also asserts the abort names that weakening's own consequence: the
# failure modes here are not interchangeable, and the message is all a future
# reader gets.

require "open3"
require "tmpdir"

ROOT = File.expand_path("../..", __dir__)
CONTRACT = File.join(ROOT, ".github/scripts/test_gitleaks_config_extends_defaults.rb")
CONFIG = File.join(ROOT, ".gitleaks.toml")

# Needles are patterns, not literals: `useDefault=true` is the same config, and
# reformatting it must not read as "mutation needle missing".
EXTEND_BLOCK = /^\[extend\]\n\s*useDefault\s*=\s*true\n/
USE_DEFAULT = /useDefault\s*=\s*true/
ALLOWLIST_PATHS = /paths\s*=\s*\[.*\]/
ALLOWLIST = "[allowlist]"
ZERO_RULES = "zero rules"

def reject_config(path, label, consequence)
  _out, err, status = Open3.capture3({ "GITLEAKS_CONFIG" => path }, RbConfig.ruby, CONTRACT)
  abort "mutation survived: #{label}" if status.success?
  abort "mutation message must name the consequence: #{label}" unless err.include?(consequence)
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
  abort "mutation needle missing: #{label}" if changed == source
  probe(changed, label, consequence)
end

_out, _err, baseline = Open3.capture3({ "GITLEAKS_CONFIG" => CONFIG }, RbConfig.ruby, CONTRACT)
abort "baseline must pass on the committed config" unless baseline.success?

probe_absent("config file deleted", "falls back to its default rules")
mutate(EXTEND_BLOCK, "", "[extend] table deleted")
mutate(USE_DEFAULT, "useDefault = false", "useDefault flipped to false")
mutate("[extend]", "[extended]", "[extend] table renamed")
mutate(USE_DEFAULT, "# useDefault = true", "useDefault commented out")
mutate(USE_DEFAULT, "useDefault = true\n  disabledRules = [\"github-pat\"]",
       "inherited rules dropped by name", "the named rules stop running")
mutate(ALLOWLIST_PATHS, "paths = ['''.*''']",
       "allowlist path widened to every file", "exempt from every rule")
# Neither key is in the committed config, so these two are inserted under the
# `[allowlist]` header rather than rewritten -- renaming the table trips
# "mutation needle missing" instead of quietly probing nothing.
mutate(ALLOWLIST, "#{ALLOWLIST}\n  regexes = ['''.*''']",
       "allowlist regex hid every secret value", "dropped before they are reported")
# Upper-cased on purpose: gitleaks matches stopwords case-insensitively
# (verified against v8.30.1 -- `GHP_` silences a `ghp_` finding), so the guard
# has to fold case too, and this probe fails if it stops doing so.
mutate(ALLOWLIST, "#{ALLOWLIST}\n  stopwords = [\"GHP_\"]",
       "allowlist stopword silenced a whole rule class", "silencing that rule class")
probe(File.read(CONFIG).sub(EXTEND_BLOCK, "") +
      "\n  useDefault = true\n", "useDefault relocated into [allowlist]")

puts "Gitleaks config mutation probes: deletion, false, rename, comment-out, relocation, disabledRules, and wildcard path/regex/stopword allowlists rejected"
