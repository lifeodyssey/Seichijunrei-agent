#!/usr/bin/env ruby
# frozen_string_literal: true

# The edge Worker is never called `root` (#1315, agent-TS-rewrite spec §五 W4-2).
#
# `root` was the gateway Worker's name before `workers/edge/` existed, and it
# outlived the directory in three shapes: CD job and cohort labels
# (`deploy-root-staging`), component tables (`edge (root)`), and runbook prose
# ("the root Worker"). The deployed script name never was `root` — it is
# `animichi` / `animichi-staging` — so nothing here touches a Worker, a route
# or a binding; the constraint on this card is labels only.
#
# A denylist of the shapes seen so far would go green on the fourth shape, so
# this is the other direction: every `\broot\b` in the scanned set must match
# one of the senses below, all of which are the ordinary English word. A
# reintroduced label matches none of them and the contract fails. That also
# makes the list the place where "is this `root` the Worker?" is answered once,
# in review, instead of per reader.
#
# Matching is per occurrence, not per line: a line with two `root`s has to
# explain both, and a sense matched anywhere on a line excuses only the
# characters it covers. The card's first review found all three false greens
# that the per-line version had.
#
# Usage: ruby .github/scripts/test_edge_naming_contract.rb [REPO_ROOT]

require_relative "workflow_document"

# The AC's paths (`rg -n '\broot\b' .github docs infra AGENTS.md`), plus the
# two file shapes under `workers/` that carry deploy-config prose — that is
# where the last three labels were found (`workers/edge/wrangler.toml`,
# `workers/catalog/wrangler.toml`). Worker *source* stays out: `root` there is
# DOM, route trees and path parsing, none of which can name a deploy unit.
SCAN_ROOTS = %w[.github docs infra AGENTS.md].freeze
SCAN_GLOBS = ["workers/*/wrangler.toml", "workers/*/AGENTS.md"].freeze
# Extensions rather than every file, and no `node_modules`: `docs/mockups/**`
# vendors minified JS whose single 200KB line carries `root` from a bundler,
# and `infra/node_modules` is @types/node prose. No label lives in either.
SCAN_EXTENSIONS = %w[.md .yml .yaml .sh .rb .toml .json .ts].freeze
# The AC's `rg` is case-sensitive, so this is too: `ROOT=$(git rev-parse ...)`
# is a shell variable for the checkout, present in a dozen scripts, and folding
# case would make the sense list carry it instead of the labels.
WORD = /\broot\b/.freeze

# The one scan boundary. `docs/archive/` is excluded by the AC's own rg glob
# and is one-way read-only under DOCS_POLICY's docs tree map: a spec is moved
# there *because* it stopped describing the repo, and rewriting its prose on
# the way in would defeat the point of keeping it.
EXCLUDED_TREE = "docs/archive/"

# Dated records, exempt because they describe the pipeline that existed when
# they were written; renaming inside them would falsify the record rather than
# fix a label. Files, not directories — a new document under `docs/iterations/`
# or `docs/specs/2026-07-06-frontend-rebuild/` is scanned like any other, so a
# label cannot arrive by being filed in the right folder.
DATED_RECORDS = {
  "docs/iterations/iter5/handoff-2026-08-02-staging-blocked.md" => "the staging blockers as the 2026-08-02 session hit them",
  "docs/iterations/iter5/status-2026-08-03-s0-audit.md" => "an S0 audit snapshot; its rows name the failing jobs of the day",
  "docs/iterations/iter6/GOAL.md" => "the iter6 board, with the container's deploy state as tracked then",
  "docs/iterations/iter6/spec-infra-governance.md" => "the 2026-08 secrets/route migration plan, per component as it was named then",
  "docs/specs/2026-07-06-frontend-rebuild/iter-0.md" => "shipped iteration sub-spec; cites `worker/`, the pre-monorepo directory",
  "docs/specs/2026-07-06-frontend-rebuild/iter-2.md" => "shipped iteration sub-spec; cites `worker/app.ts`, a pre-monorepo path",
  "docs/specs/2026-07-06-frontend-rebuild/iter-4.md" => "shipped iteration sub-spec; cites `worker/app.ts`, a pre-monorepo path",
  "docs/specs/2026-07-06-frontend-rebuild/iter-5.md" => "shipped iteration sub-spec; its backend enabler is written against the pre-rename gateway",
  "docs/specs/2026-07-29-cicd-rebuild-spec.md" => "the CI it measures is retired; superseded by 2026-09-05-cicd-redesign-spec.md",
  "docs/specs/2026-08-05-s0v2-launch-spec.md" => "dated launch spec, closed",
  "docs/specs/2026-08-06-ci-deploy-architecture.md" => "the per-component pipeline table as designed in 2026-08",
  "docs/specs/2026-08-06-users-clean-architecture-design.md" => "records where R2 presign ownership had been argued before",
  "docs/specs/2026-08-16-migration-executor-spec.md" => "names the deploy components as the executor found them",
  "docs/ops/pr-comment-debt-2026-08-06.md" => "a resolved-comment ledger; its rows quote the workflow lines of the day",
  # This file names the retired label in every paragraph that explains why it
  # exists, which no sense can express without also admitting a real label.
  ".github/scripts/test_edge_naming_contract.rb" => "this contract; it quotes the retired label to explain itself"
}.freeze

# Every non-Worker sense the scanned set uses the word in. Each names the word
# next to the noun that fixes it; nothing spans arbitrary text, so a wrapped
# neighbour cannot excuse an unrelated occurrence. Bold and code markers are
# matched where the docs use them (`**root** branch`, `root `AGENTS.md``).
ALLOWED_SENSES = [
  # The repository's top directory, and the pnpm project that owns it.
  /\brepo(sitory)?[-\s]root\b/i,
  /\broot[-\s](project|lockfile|dependenc\w+|allowlist|cleanup|checkout|layout|entry|config|directory)\b/i,
  /\broot[-\s]?(level|only)\b/i,
  /\b(monorepo|workspace|design-sync|src|package|worker|its|the new|repo)\s+root\b/i,
  /\broot\s+`?(AGENTS|CLAUDE|CONTEXT-MAP|package|todo|wrangler|DEPLOYMENT|README|CHANGELOG|lint:oxlint|\.pre-commit)/i,
  /\bRoot (guide|README|agent guidance)\b/i,
  /\broot (routes to|near \d)/i,
  # `root/package` and `root/docs` contrast the repo-root guide with the
  # package ones; `root/web` and `root/agent` were deploy units and are not here.
  /\broot\/(package|docs)\b/i,
  # `docs/specs/2026-08-08-repo-closeout-spec.md:37`, on the root package.json.
  /\broot keeps orchestration\b/i,
  /check-root-allowlist|root-allowlist|ui-skills-root/,
  # Structure: the assembly point of a program, a URL or route path, and the
  # CSS `:root` custom-property block ("重声明七个 root token").
  /composition[-\s]root/i,
  /\broot[-\s]route\b/i,
  /\broot (URL|spec)\b/i,
  /\be2e\/ root\b/,
  /\bname=root\b/,
  /:root\b/,
  /\broot\s+token/i,
  # Diagnosis, Neon branches, and the Unix superuser. `staging root` is the
  # Neon console phrase from neon-backup-rpo.md and is pinned to the bold
  # markers it is written with, so a job named `CD / staging root` is not it.
  /\broot[-\s]cause\b/i,
  /\*{0,2}root\*{0,2}\s+branch(es)?\b/i,
  /\b(staging|production) roots\b/i,
  /\*\*staging root\*\*/,
  /\b(non-root|rootless|no-root|as root|no root|root user|root-at-build)\b|\broot privileg\w*/i,
  # The rename this contract enforces, named as the old label in the two specs
  # that ordered it. Deliberately narrow: it admits the arrow and the phrase,
  # not a bare `root` in a table cell.
  /root\s*(→|->)\s*edge/i,
  /`root`\s*旧名/
].freeze

# The AC's one named exception, pinned positively: an allowlist is also
# satisfied by deleting every line it allows, so the sense that motivated it
# has to still be there.
COMPOSITION_ROOT_ANCHOR = "infra/index.ts"

@log = ViolationLog.new

def scanned_files
  globbed = SCAN_ROOTS.flat_map { |scan_root| Dir.glob("#{scan_root}/**/*", base: repository_root) + [scan_root] }
  (globbed + Dir.glob(SCAN_GLOBS, base: repository_root))
    .reject { |path| path.split("/").include?("node_modules") || path.start_with?(EXCLUDED_TREE) }
    .select { |path| SCAN_EXTENSIONS.include?(File.extname(path)) && !DATED_RECORDS.key?(path) }
    .select { |path| File.file?(File.join(repository_root, path)) }
    .uniq.sort
end

def sense_ranges(text)
  ALLOWED_SENSES.flat_map { |sense| text.to_enum(:scan, sense).map { Regexp.last_match.offset(0) } }
end

def covered?(text, offset, must_cross: nil)
  sense_ranges(text).any? do |from, to|
    from <= offset && offset < to && (must_cross.nil? || (from < must_cross && must_cross < to))
  end
end

# Prose here wraps at ~100 columns, so a sense can straddle the break ("the
# build context must stay the repo\n# root"). Reading the neighbour is only
# allowed when the matched sense itself crosses the join, which is what stops a
# neighbour's own `root` from excusing this one.
def wrapped_forward?(lines, index, offset)
  continuation = lines.fetch(index + 1, "").sub(/\A\s*(#|\/\/|-)\s*/, "")
  covered?("#{lines[index]} #{continuation}", offset, must_cross: lines[index].length)
end

def wrapped_backward?(lines, index, offset)
  return false unless index.positive?

  marker = lines[index][/\A\s*(#|\/\/|-)\s*/].to_s
  previous = lines[index - 1]
  joined = "#{previous} #{lines[index].delete_prefix(marker)}"
  covered?(joined, previous.length + 1 + offset - marker.length, must_cross: previous.length)
end

def explained?(lines, index, offset)
  covered?(lines[index], offset) || wrapped_forward?(lines, index, offset) ||
    wrapped_backward?(lines, index, offset)
end

def offsets_of_word(line)
  line.to_enum(:scan, WORD).map { Regexp.last_match.begin(0) }
end

def unexplained_lines(path)
  lines = File.readlines(File.join(repository_root, path), chomp: true)
  lines.each_index.flat_map do |index|
    offsets_of_word(lines[index])
      .reject { |offset| explained?(lines, index, offset) }
      .map { |offset| "#{path}:#{index + 1}:#{offset + 1}: #{lines[index].strip[0, 110]}" }
  end
end

def assert_every_root_is_the_english_word
  found = scanned_files.flat_map { |path| unexplained_lines(path) }
  @log.unless_true(found.empty?,
                   "`root` is the gateway Worker's retired name (#1315): the edge Worker, its CD " \
                   "cohort and its deploy jobs are `edge`. These occurrences sit in no sense " \
                   "ALLOWED_SENSES recognises — rename the label, or add the sense with its " \
                   "reason:\n#{found.join("\n")}")
end

def assert_the_composition_root_sense_survives
  anchored = File.readlines(File.join(repository_root, COMPOSITION_ROOT_ANCHOR))
                 .any? { |line| line.match?(/composition root/i) }
  @log.unless_true(anchored,
                   "#{COMPOSITION_ROOT_ANCHOR}: the composition-root comment is the sense #1315's " \
                   "acceptance criterion carves out; without it this contract passes vacuously")
end

def main
  assert_every_root_is_the_english_word
  assert_the_composition_root_sense_survives
  @log.report("edge naming contract: `root` names no Worker, cohort or deploy job")
end

main if $PROGRAM_NAME == __FILE__
