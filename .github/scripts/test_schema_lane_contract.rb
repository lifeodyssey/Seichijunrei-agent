#!/usr/bin/env ruby
# frozen_string_literal: true

# The schema lane of the pull-request pipeline (card B5 / #1363).
#
#   selection   the migrations / deps filters select the `db` job
#   segments    its three segments are three ordered steps of their own
#   toolchain   Atlas comes from a SHA-pinned ariga/setup-atlas at the
#               repository's version
#   boundary    NO job in the file applies a migration — held over every job,
#               not just this one
#
# `migrations/neon/` sits outside every pnpm project, so the affected matrix
# never selects a migration-only change and this job is the whole lane. Card B2
# opened this seam with `test_agent_lane_contract.rb` for the Python lane; C1
# (#1364) followed it here and in `test_browser_lane_contract.rb` when the shared
# file went over 300 lines. The matrix itself and the aggregates stay in
# `test_ci_workflow_contract.rb`.
#
# Usage: ruby .github/scripts/test_schema_lane_contract.rb [REPO_ROOT]

require_relative "workflow_document"

CI_FILE = File.join(repository_root, ".github", "workflows", "pr-verification.yml")
# The schema gate (card B5 / #1363). `migrations/neon/` is outside every pnpm
# project, so the affected matrix never selects a migration-only change and
# this job is the whole lane. Each segment is asserted as its own step so a
# failure names the question it answered, and the order is asserted because a
# fresh-schema apply after an unvalidated chain proves nothing.
SCHEMA_JOB = "db"
SCHEMA_FILTERS = %w[migrations deps].freeze
SCHEMA_SEGMENTS = [
  "atlas migrate validate --dir file://migrations/neon",
  "bash scripts/local-gates/db-fresh-schema.sh",
  "pnpm --filter migrator test"
].freeze
# Applying belongs to db-fresh-schema.sh's throwaway container and to the
# migrator Worker on main; the PR workflow validates and nothing else. Held
# over EVERY job, not just the schema gate, because that is the coverage the
# retired half of migration-boundary.test.ts had — a second job reintroducing
# a live apply is exactly the regression it existed to catch. Read off the
# parsed steps rather than the file's text, so the prose above the schema gate
# can still name what it forbids.
SCHEMA_FORBIDDEN = ["atlas migrate apply", "supabase db push"].freeze
ATLAS_ACTION = %r{\Aariga/setup-atlas@[0-9a-f]{40}\z}
ATLAS_VERSION = "v0.30.0"

@log = ViolationLog.new
@ci = WorkflowDocument.load(CI_FILE)

def assert_schema_job_is_paths_filtered
  condition = @ci.dig("jobs", SCHEMA_JOB, "if").to_s
  SCHEMA_FILTERS.each do |filter|
    @log.unless_true(condition.include?("needs.plan.outputs.#{filter} == 'true'"),
                     "pr-verification.yml:#{SCHEMA_JOB}: must run when the `#{filter}` filter is true")
  end
end

def schema_step_commands
  @ci.steps_of(SCHEMA_JOB).map { |step| step["run"].to_s }
end

# The index of the first step whose `run` carries the segment, or nil.
def schema_segment_position(segment)
  schema_step_commands.index { |command| command.include?(segment) }
end

def assert_schema_segments_are_separate_ordered_steps
  positions = SCHEMA_SEGMENTS.map { |segment| [segment, schema_segment_position(segment)] }
  positions.each do |segment, at|
    @log.unless_true(at, "pr-verification.yml:#{SCHEMA_JOB}: `#{segment}` must be a step of its own")
  end
  found = positions.map(&:last).compact
  @log.unless_true(found == found.uniq && found == found.sort,
                   "pr-verification.yml:#{SCHEMA_JOB}: the segments must be separate steps in the order " \
                   "#{SCHEMA_SEGMENTS.join(' -> ')}")
end

def assert_schema_job_pins_atlas
  atlas = @ci.steps_of(SCHEMA_JOB).find { |step| step["uses"].to_s.start_with?("ariga/setup-atlas") }
  @log.unless_true(atlas && atlas["uses"].match?(ATLAS_ACTION),
                   "pr-verification.yml:#{SCHEMA_JOB}: Atlas must come from ariga/setup-atlas pinned to a commit SHA")
  @log.unless_true(atlas&.dig("with", "version") == ATLAS_VERSION,
                   "pr-verification.yml:#{SCHEMA_JOB}: setup-atlas must pin version #{ATLAS_VERSION}")
end

# Every `run:` in the file, paired with the job that owns it.
def job_commands
  @ci.jobs.each_key.flat_map { |job| @ci.steps_of(job).map { |step| [job, step["run"].to_s] } }
end

def assert_no_job_applies_a_migration
  job_commands.product(SCHEMA_FORBIDDEN).each do |(job, command), forbidden|
    @log.unless_true(!command.include?(forbidden),
                     "pr-verification.yml:#{job}: must never run `#{forbidden}`")
  end
end

def main
  assert_schema_job_is_paths_filtered
  assert_schema_segments_are_separate_ordered_steps
  assert_schema_job_pins_atlas
  assert_no_job_applies_a_migration
  @log.report("schema lane contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
