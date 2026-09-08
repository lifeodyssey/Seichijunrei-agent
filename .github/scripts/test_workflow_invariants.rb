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
#   identity     every job that asks Pulumi Cloud for a token declares an
#                `environment:` — without one the OIDC subject is
#                `ref:refs/heads/<branch>`, a shape the issuer policy does not
#                list, and the exchange fails at deploy time rather than here
#   credentials  nothing reads a GitHub secret, by any route: the `secrets`
#                context and `secrets: inherit` alike. Every credential CI needs
#                comes from Pulumi ESC, opened with the job's own OIDC identity
#                (#1367). The GitHub secret stores are emptied at the end of
#                that card, after which a `secrets.` reference that came back
#                would resolve to the empty string and fail somewhere far from
#                the line that added it
#   esc          every name a job opens from ESC is checked for emptiness before
#                the job spends it — the action only warns on a missing value
#   toolchain    a job that runs `uv` installs it first. Those steps lived in a
#                composite until #1367 wrote them out into each job, which is
#                where one of them can now go missing on its own. The pnpm half
#                of this rule moved to `test_workspace_install_contract.rb`
#                (#1489), which asks the same question of steps that need the
#                installed workspace without naming pnpm
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
# `github.token` is the Actions built-in and is spelled from the `github`
# context, never provisioned with `gh secret set` — so a bare zero rule needs no
# allowlist beside it. Both halves matter: a `secrets.` reference anywhere in an
# expression (`${{ secrets.X || '' }}` reads one just as `${{ secrets.X }}`
# does), and `secrets: inherit`, which hands a called workflow every one of them
# without naming a single name.
SECRET_REFERENCE = /\bsecrets\.[A-Za-z0-9_]+|secrets:\s*inherit/
# `pulumi/esc-action` logs `No value found for …` and exits 0 when an exported
# name has no value in the environment (v3.2.0 `src/index.ts:327`). Without a
# check the job runs on an empty credential; the guard is a `for key in …` loop
# over exactly the names the step asked for.
ESC_ACTION = "pulumi/esc-action"
ESC_GUARD = /for key in ([A-Z0-9_ ]+); do/
# Each entry is [what needs the toolchain, what provides it, what to call it in
# the message]. Only `uv` is left: pnpm and everything else that needs the
# installed workspace is `test_workspace_install_contract.rb`, which can also
# see a step that reaches node_modules without spelling `pnpm` (#1489).
TOOLCHAINS = [
  [/\buv (run|sync|python|tool)\b/, %r{astral-sh/setup-uv@}, "astral-sh/setup-uv"]
].freeze
# Both halves of the exchange: `auth-actions` mints the Pulumi token and
# `esc-action` can mint one of its own through `oidc-auth`, so either step alone
# makes the job's subject the thing the issuer policy has to accept.
PULUMI_IDENTITY_ACTIONS = %w[pulumi/auth-actions pulumi/esc-action].freeze

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

def esc_opened_names(job)
  Array(job["steps"]).select { |step| step["uses"].to_s.start_with?("#{ESC_ACTION}@") }
                     .flat_map { |step| esc_exported_names(step) }
end

def esc_guarded_names(job)
  Array(job["steps"]).flat_map { |step| step["run"].to_s.scan(ESC_GUARD) }.flatten.flat_map(&:split)
end

def assert_opened_values_are_guarded(file, workflow)
  workflow.jobs.each do |id, job|
    next unless job.is_a?(Hash) && !esc_opened_names(job).empty?

    @log.unless_true(esc_guarded_names(job).sort == esc_opened_names(job).sort,
                     "#{file}:#{id}: esc-action only warns on a missing value — guard " \
                     "#{esc_opened_names(job).join(', ')} before the job spends it")
  end
end

def step_text(step)
  step.is_a?(Hash) ? "#{step['uses']}#{step['run']}" : ""
end

def assert_provided_before_use(file, id, steps, toolchain)
  use, provide, name = toolchain
  used = steps.index { |step| step_text(step).match?(use) }
  return if used.nil?

  provided = steps.index { |step| step_text(step).match?(provide) }
  @log.unless_true(!provided.nil? && provided < used,
                   "#{file}:#{id}: runs the toolchain before `#{name}` provides it")
end

def assert_toolchains_are_installed(file, workflow)
  workflow.jobs.each do |id, job|
    next unless job.is_a?(Hash)

    TOOLCHAINS.each { |toolchain| assert_provided_before_use(file, id, Array(job["steps"]), toolchain) }
  end
end

def asks_pulumi_cloud_for_a_token?(job)
  Array(job["steps"]).any? do |step|
    PULUMI_IDENTITY_ACTIONS.any? { |action| step["uses"].to_s.start_with?("#{action}@") }
  end
end

def assert_identity_jobs_name_an_environment(file, workflow)
  workflow.jobs.each do |id, job|
    next unless job.is_a?(Hash) && asks_pulumi_cloud_for_a_token?(job)

    @log.unless_true(!job["environment"].nil?,
                     "#{file}:#{id}: a job that asks Pulumi Cloud for a token must declare an " \
                     "environment, or its OIDC subject is `ref:refs/heads/<branch>`")
  end
end

def assert_no_github_secret(file, text)
  named = text.scan(SECRET_REFERENCE).uniq
  @log.unless_true(named.empty?,
                   "#{file}: GitHub holds no secrets any more — open the value from Pulumi ESC " \
                   "with the job's own OIDC identity (#{named.join(', ')})")
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
  assert_identity_jobs_name_an_environment(file, workflow)
  assert_opened_values_are_guarded(file, workflow)
  assert_toolchains_are_installed(file, workflow)
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
    assert_no_github_secret(file, text)
  end
  @log.report("workflow invariants: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
