#!/usr/bin/env ruby
# frozen_string_literal: true

# The meta-invariants every workflow in this repository has to satisfy, which
# is what the retired `assert-workflow-invariants*`, `check-actions-pinned*`
# and `actionlint-queue-contract` scripts enforced (spec §4.2, card B1 #1359):
#
#   timeout      every job that declares `runs-on` declares `timeout-minutes`
#   permissions  the default permission set is exactly `contents: read`;
#                anything wider lives at job level
#   concurrency  pull-request workflows cancel superseded PR runs; push
#                workflows never cancel unconditionally (that kills a deploy)
#   queue        the workflow producing the required contexts listens on
#                `merge_group`, or the merge queue waits forever
#   pinning      every third-party `uses:` names a 40-hex commit and every
#                `docker://` image a sha256 digest
#   existence    every `./`-prefixed `uses:` names a composite that is actually
#                in the tree — the one class of reference pinning exempts
#   suppression  no `continue-on-error`
#
# The CI file's own shape is `test_ci_workflow_contract.rb`, not this file.
#
# Usage: ruby .github/scripts/test_workflow_invariants.rb [REPO_ROOT]

require_relative "workflow_document"

ROOT = repository_root
WORKFLOW_DIR = File.join(ROOT, ".github", "workflows")
REQUIRED_CONTEXTS = ["PR Verification", "Security"].freeze
CONTEXT_OWNER = "pr-verification.yml"
PR_CANCEL_EXPRESSION = "${{ github.event_name == 'pull_request' }}"
PINNED_USES = %r{\A(?:\./|[\w.-]+/[\w.-]+(?:/[\w./-]+)?@[0-9a-f]{40}\z|docker://[^@\s]+@sha256:[0-9a-f]{64}\z)}
USES_ENTRY = /^\s*-?\s*uses:\s*(\S+)/
# A `./`-prefixed `uses:` has no SHA to name, so `PINNED_USES` waves it through
# — and then nothing in the repository notices that the directory it points at
# is gone. Deleting a composite out from under a live caller is caught by
# whichever contract owns that caller; *adding* a reference to an
# already-retired one is caught by nothing at all, and fails only at CI runtime
# on a missing `action.yml`. C1 (#1364) retired four composites at once, which
# is what made that a standing assertion rather than a `git ls-files` in a
# spec's acceptance criteria.
LOCAL_ACTION = %r{\A\./(.+)\z}
ACTION_MANIFESTS = %w[action.yml action.yaml].freeze

@log = ViolationLog.new

def assert_timeouts(file, workflow)
  workflow.jobs.each do |id, job|
    next unless job.is_a?(Hash) && job.key?("runs-on")

    @log.unless_true(job.key?("timeout-minutes"), "#{file}:#{id}: missing timeout-minutes")
  end
end

def assert_default_permissions(file, workflow)
  @log.unless_true(workflow["permissions"] == { "contents" => "read" },
                   "#{file}: default permissions must be exactly `contents: read`")
end

# A literal `true` cancels every run of every event, which would kill a deploy
# mid-flight; the pull-request form is the only expression this repo uses.
def assert_concurrency(file, workflow)
  cancel = workflow.dig("concurrency", "cancel-in-progress")
  return assert_push_never_cancels(file, cancel) unless workflow.triggers.key?("pull_request")

  @log.unless_true(workflow.dig("concurrency", "group").is_a?(String), "#{file}: concurrency needs a group")
  @log.unless_true([true, PR_CANCEL_EXPRESSION].include?(cancel),
                   "#{file}: concurrency must cancel superseded pull-request runs (got #{cancel.inspect})")
end

def assert_push_never_cancels(file, cancel)
  @log.unless_true(cancel != true, "#{file}: a push workflow must not cancel in progress")
end

def assert_required_contexts(workflow)
  names = workflow.jobs.map { |id, job| job.is_a?(Hash) && job["name"] || id }
  REQUIRED_CONTEXTS.each do |context|
    @log.unless_true(names.include?(context), "#{CONTEXT_OWNER}: no job produces the required context #{context}")
  end
  merge_group = workflow.triggers["merge_group"]
  @log.unless_true(merge_group.is_a?(Hash) && Array(merge_group["branches"]).include?("main"),
                   "#{CONTEXT_OWNER}: required-context producer must listen on merge_group for main")
end

def assert_no_suppression(file, text)
  @log.unless_true(!text.include?("continue-on-error"), "#{file}: continue-on-error is not allowed")
end

def indent_of(line)
  line[/\A */].length
end

# `uses:` is read outside `run:` block scalars so a workflow snippet quoted
# inside a script is not mistaken for a real action reference.
def uses_references(text)
  block_indent = nil
  text.lines.map do |line|
    block_indent = nil if block_indent && line.strip != "" && indent_of(line) <= block_indent
    block_indent = indent_of(line) if block_indent.nil? && line.match?(/^\s*-?\s*run:\s*[|>]/)
    block_indent ? nil : line[USES_ENTRY, 1]
  end.compact
end

def assert_pinned(file, text)
  uses_references(text).each do |reference|
    @log.unless_true(reference.match?(PINNED_USES),
                     "#{file}: `uses: #{reference}` is not pinned to a commit SHA")
  end
end

def names_a_composite_in_the_tree?(reference)
  directory = File.join(ROOT, reference[LOCAL_ACTION, 1])
  ACTION_MANIFESTS.any? { |manifest| File.file?(File.join(directory, manifest)) }
end

def assert_local_actions_exist(file, text)
  uses_references(text).grep(LOCAL_ACTION).each do |reference|
    @log.unless_true(names_a_composite_in_the_tree?(reference),
                     "#{file}: `uses: #{reference}` names a composite this repository does not have")
  end
end

def pinnable_files
  (Dir.glob(File.join(WORKFLOW_DIR, "*.yml")) +
    Dir.glob(File.join(ROOT, ".github", "actions", "**", "*.yml"))).sort
end

def check_workflow(path)
  file = File.basename(path)
  workflow = WorkflowDocument.load(path)
  assert_timeouts(file, workflow)
  assert_default_permissions(file, workflow)
  assert_concurrency(file, workflow)
  assert_no_suppression(file, File.read(path))
  assert_required_contexts(workflow) if file == CONTEXT_OWNER
end

def main
  Dir.glob(File.join(WORKFLOW_DIR, "*.yml")).sort.each { |path| check_workflow(path) }
  pinnable_files.each do |path|
    file = path.delete_prefix("#{ROOT}/")
    text = File.read(path)
    assert_pinned(file, text)
    assert_local_actions_exist(file, text)
  end
  @log.report("workflow invariants: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
