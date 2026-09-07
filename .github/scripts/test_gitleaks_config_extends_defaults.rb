#!/usr/bin/env ruby
# frozen_string_literal: true

# A gitleaks config file REPLACES the built-in rule set unless it extends it.
# `.gitleaks.toml` sits at the repo root, so every consumer auto-discovers it:
# the digest-pinned scanner in .github/actions/secret-scan (job `security-diff`)
# and the gitleaks pre-commit hook. Drop `[extend] useDefault = true` and both
# keep exiting 0 on real secrets — a silent, total loss of secret scanning that
# no other check would notice. Narrower edits buy the same silence while
# `useDefault = true` still reads fine, so each is rejected too: `[extend]
# disabledRules` drops named rules back out of the inherited set, and the
# `[allowlist]` keys suppress findings by file path (`paths`), by secret value
# (`regexes`) and by substring of the secret (`stopwords`). The `contracts` job
# has no gitleaks binary, so this guard is static: it reads the config's TOML
# tables directly.
# https://github.com/gitleaks/gitleaks/blob/v8.24.3/README.md#configuration

ROOT = File.expand_path("../..", __dir__)
CONFIG = ENV.fetch("GITLEAKS_CONFIG", File.join(ROOT, ".gitleaks.toml"))
CONSEQUENCE = 'gitleaks runs with zero rules and reports "no leaks found" for every secret'
# Absence is the one weakening that keeps the rules: with no config at all
# gitleaks loads its own default set, so what is lost is this file's allowlist.
ABSENT = "gitleaks falls back to its default rules and loses the atlas.sum allowlist this file exists for"
DISABLED = 'the named rules stop running and gitleaks reports "no leaks found" for the secrets they catch'
EXEMPTED = 'every matching file is exempt from every rule and gitleaks reports "no leaks found" for its secrets'
HIDDEN = 'the matching secrets are dropped before they are reported, whatever rule found them'
SILENCED = 'every secret containing it is dropped, silencing that rule class at any entropy'

# Probe strings, not files this check opens. An allowlist path entry earns its
# place by naming one file; a pattern that also matches these — `.*`, `.+`,
# `^`, an empty pattern, a bare `/` — mutes the tree instead of a checksum file.
SCANNED = [".", ".env", "workers/edge/src/entry.ts"].freeze

# The QWERTY rows plus the digits: 36 synthetic characters, deterministic and
# self-evidently not a credential. It deliberately avoids an a-to-z run, which
# the default rule set ships as a global stopword and which would therefore
# silence these probes before any rule saw them.
PROBE_BODY = "QWERTYUIOPASDFGHJKLZXCVBNM0123456789"

# Secret values that must stay reportable, one per default rule shape:
# github-pat `ghp_[0-9a-zA-Z]{36}`, aws-access-token `AKIA[A-Z0-9]{16}` and
# gitlab-pat `glpat-[\w-]{20}`. Assembled at runtime so no scannable literal is
# committed — a permanent canary would be a finding in every future scan.
REPORTABLE = [
  "ghp_#{PROBE_BODY}",
  "AKIA#{PROBE_BODY[0, 16]}",
  "glpat-#{PROBE_BODY[0, 20]}"
].freeze

# TOML string literals. The triple-quoted forms come first so their bodies are
# not read as a pair of empty single- or double-quoted strings.
LITERAL = /'''(.*?)'''|"""(.*?)"""|'([^']*)'|"((?:[^"\\]|\\.)*)"/m

def reject(condition, message)
  abort "gitleaks config contract: #{message}" if condition
end

# Group the config's lines under their TOML table header. Matching on the table
# a key belongs to — rather than on the file text — is what stops a commented-out
# or misplaced `useDefault = true` elsewhere in the file from satisfying the check.
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

# The global `[allowlist]`, the `[[allowlists]]` array form and any rule-scoped
# `[rules.allowlist]` suppress findings alike, so all three are read.
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

reject(!File.file?(CONFIG), "#{CONFIG} is missing — #{ABSENT}")

config = tables(CONFIG)
reject(!config.key?("extend"), "no [extend] table in #{File.basename(CONFIG)} — #{CONSEQUENCE}")

assignment = config.fetch("extend").find { |line| line.match?(/\AuseDefault\s*=/) }
reject(assignment.nil?, "[extend] never sets useDefault — #{CONSEQUENCE}")
reject(!assignment.match?(/\AuseDefault\s*=\s*true\s*(#.*)?\z/),
       "[extend] must set useDefault = true, found `#{assignment}` — #{CONSEQUENCE}")

disabled = config.fetch("extend").find { |line| line.match?(/\AdisabledRules\s*=/) }
reject(disabled, "[extend] drops inherited rules with `#{disabled}` — #{DISABLED}")

exempted = allowlist_values(config, "paths").find { |pattern| exempts_scanned_paths?(pattern) }
reject(exempted, "allowlist path #{exempted.inspect} matches paths that must stay scanned — #{EXEMPTED}")

hidden = allowlist_values(config, "regexes").find { |pattern| hides_reported_secret?(pattern) }
reject(hidden, "allowlist regex #{hidden.inspect} matches a secret that must stay reported — #{HIDDEN}")

silenced = allowlist_values(config, "stopwords").find { |word| silences_reported_secret?(word) }
reject(silenced, "allowlist stopword #{silenced.inspect} occurs in a secret that must stay reported — #{SILENCED}")

puts "Gitleaks config contract: default rules stay loaded, none is disabled by name, and no allowlist entry mutes a path, a value or a rule class"
