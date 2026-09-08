#!/usr/bin/env ruby
# frozen_string_literal: true

# One rule, over every job of every workflow: a step that needs the installed
# pnpm workspace has to be preceded, in that same job, by the step that
# installs it.
#
# The rule used to live in `test_workflow_invariants.rb` as the pnpm half of
# its `TOOLCHAINS` list, and it keyed on a literal `pnpm` in the step's own
# text. That reads a job's dependency on the workspace off its spelling, and a
# step can depend on `node_modules` without spelling it: the `contracts` job of
# `pr-verification.yml` reaches Wrangler only through
# `bash .github/scripts/bundle-release-worker.test.sh`, so deleting its install
# step left every contract green while the job would have failed at runtime
# (#1489, found by the #1367 delta review). The pnpm half moved here rather
# than being duplicated — two files failing on one mutation is noise, and the
# question both were asking is this file's name.
#
# What counts as needing the workspace:
#
#   a pnpm use   any `pnpm <something>` other than `pnpm ls` (which reads the
#                workspace manifests and needs no install) and `pnpm install`
#                itself
#   a script in  WORKSPACE_SCRIPTS below — a committed script whose own run
#                reaches `node_modules` without naming pnpm in the step
#
# What provides it is the frozen workspace-wide install. `pnpm install --dir
# <sealed tree>` provisions someone else's tree and is neither a use nor a
# provider.
#
# And the converse, which is the same premise read backwards: `actions/setup-node`
# with `cache: pnpm` restores and then *saves* the pnpm store, and its save phase
# fails the job outright when the store path does not exist. Only an install
# creates it, so declaring the cache in a job that never installs turns a cache
# miss into a red job — which is exactly how `cd.yml`'s `plan` blocked every
# staging deploy (#1506, run 34186376453, both attempts).
#
# The repository-wide meta-invariants (timeouts, permissions, pinning, ESC) are
# `test_workflow_invariants.rb`; the CI file's own shape is
# `test_ci_workflow_contract.rb`.
#
# Usage: ruby .github/scripts/test_workspace_install_contract.rb [REPO_ROOT]

require_relative "workflow_document"

ROOT = repository_root
WORKFLOW_DIR = File.join(ROOT, ".github", "workflows")
PNPM_USE = /\bpnpm (?!ls\b|install\b)\S/
SETUP_NODE = "actions/setup-node"
PNPM_CACHE = "pnpm"
INSTALL = /pnpm install --frozen-lockfile --ignore-scripts/
INSTALL_NAME = "pnpm install --frozen-lockfile --ignore-scripts"
# Decided by reading every `*.sh` under `scripts/` and `.github/scripts/` and
# asking what each one actually runs. These four resolve something out of
# `node_modules`; a step invoking one needs the install even though it spells
# no `pnpm` of its own:
#
#   bundle-release-worker.sh        `pnpm exec wrangler deploy --dry-run`
#   bundle-release-worker.test.sh   its last case drops the stub and runs the
#                                   shipped bundler against the real
#                                   repository, because a stub and Wrangler
#                                   resolve `--outdir` differently
#   oxlint-changed.sh               `pnpm --filter <name> run lint:oxlint`
#   pre-push-affected.sh            `pnpm -r --filter <closure> run <script>`
#
# The list is the reading, not today's wiring: `cd.yml` invokes the bundler
# and `pr-verification.yml` the suite, while the two gate scripts are called
# from the git hooks — and the point of a rule like this one is to be already
# in place the day a job calls one of them (#1371's lesson about a hand-kept
# list that mirrors the wiring instead of the tree).
#
# Everything else under those directories stubs the binaries it drives
# (`pre-push-affected.test.sh` stubs `pnpm`, the delivery ones stub `curl`,
# the gate ones stub `atlas`/`docker`/`pulumi` via `stub-env.sh`), names pnpm
# only inside a message it prints (`contract-drift.sh`), or touches nothing.
# The `.github/scripts/test_*.rb` contracts read the tree in pure Ruby and
# shell out to nothing but `git rev-parse`.
WORKSPACE_SCRIPTS = [
  ".github/scripts/bundle-release-worker.sh",
  ".github/scripts/bundle-release-worker.test.sh",
  "scripts/local-gates/oxlint-changed.sh",
  "scripts/local-gates/pre-push-affected.sh"
].freeze

@log = ViolationLog.new

def step_text(step)
  step.is_a?(Hash) ? "#{step['uses']}#{step['run']}" : ""
end

# What to call the offending step in the message: its `name` if it has one,
# else the first line of the `run` it would have executed.
def step_label(step)
  return step["name"] if step.is_a?(Hash) && step["name"]

  step_text(step).lines.first.to_s.strip
end

def needs_the_workspace?(step)
  text = step_text(step)
  text.match?(PNPM_USE) || WORKSPACE_SCRIPTS.any? { |path| text.include?(path) }
end

def assert_install_precedes_the_first_use(file, id, steps)
  used = steps.index { |step| needs_the_workspace?(step) }
  return if used.nil?

  installed = steps.index { |step| step_text(step).match?(INSTALL) }
  @log.unless_true(!installed.nil? && installed < used,
                   "#{file}:#{id}: `#{step_label(steps[used])}` needs the installed workspace, " \
                   "and no `#{INSTALL_NAME}` step runs before it")
end

# The list above is hand-decided, so a rename or a deletion has to surface here
# rather than silently emptying the rule of everything but its pnpm half.
def assert_named_scripts_are_committed
  WORKSPACE_SCRIPTS.each do |path|
    @log.unless_true(File.file?(File.join(ROOT, path)),
                     "#{path} names a script this repository does not have — " \
                     "WORKSPACE_SCRIPTS lists the ones that reach node_modules")
  end
end

def caches_the_pnpm_store?(step)
  return false unless step.is_a?(Hash)
  return false unless step["uses"].to_s.start_with?("#{SETUP_NODE}@")

  step.dig("with", "cache").to_s == PNPM_CACHE
end

def assert_the_cached_store_is_one_this_job_creates(file, id, steps)
  cached = steps.index { |step| caches_the_pnpm_store?(step) }
  return if cached.nil?

  installs = steps.any? { |step| step_text(step).match?(/pnpm install/) }
  @log.unless_true(installs,
                   "#{file}:#{id}: `#{SETUP_NODE}` asks to cache the pnpm store, but no step in " \
                   "this job installs — the store path never exists and the save phase fails the job")
end

def check_workflow(path)
  file = File.basename(path)
  WorkflowDocument.load(path).jobs.each do |id, job|
    next unless job.is_a?(Hash)

    assert_install_precedes_the_first_use(file, id, Array(job["steps"]))
    assert_the_cached_store_is_one_this_job_creates(file, id, Array(job["steps"]))
  end
end

def main
  assert_named_scripts_are_committed
  Dir.glob(File.join(WORKFLOW_DIR, "*.yml")).sort.each { |path| check_workflow(path) }
  @log.report("workspace install contract: every workspace-using step has an install before it, " \
              "and every cached pnpm store is one its own job installs")
end

main if $PROGRAM_NAME == __FILE__
