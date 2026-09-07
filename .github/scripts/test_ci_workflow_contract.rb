#!/usr/bin/env ruby
# frozen_string_literal: true

# The shape of the pnpm-affected CI file (card B1 / #1359), which is what the
# retired `test_ci_contract*` and `test_pr_verification_contract*` pinned for
# the old router:
#
#   plan        subtracts exactly the three projects that own a job of their own
#   affected    cannot start on an empty matrix, runs exactly the four package
#               scripts, and provisions every binary a selected package's own
#               `test` shells out to
#   browser     the `e2e` job is selected by the web / e2e / deps filters and
#               runs the browser package's own scripts, which serve the
#               emitted Worker themselves — no composite in between
#   workspace   a job that runs a repository script importing workspace
#               dependencies installs the workspace first
#   image       every step building the offline Postgres image resolves the one
#               declaration in `packages/test-postgres/postgres-image.env`
#   schema      the `db` job is selected by the migrations/deps filters, pins
#               Atlas and runs its three segments as three ordered steps; and
#               NO job in the file applies a migration itself (card B5)
#   commits     the `commits` job runs commitlint (the CI mirror of the
#               local commit-msg hook) and gates the aggregate; the B1
#               transitional codeql job is gone — default setup owns CodeQL
#   aggregates  `Security` and `PR Verification` each name their dependencies,
#               run `always()`, and fail on a failed or cancelled one
#
# The repository-wide meta-invariants (timeouts, permissions, concurrency,
# action pinning) are `test_workflow_invariants.rb`; the Python lane's own
# shape and the Makefile gate behind it are `test_agent_lane_contract.rb`.
#
# Usage: ruby .github/scripts/test_ci_workflow_contract.rb [REPO_ROOT]

require_relative "workflow_document"

CI_FILE = File.join(repository_root, ".github", "workflows", "pr-verification.yml")
SECURITY_JOBS = %w[gitleaks trufflehog osv semgrep zizmor sqlfluff].freeze
LANE_JOBS = %w[plan affected contracts docs agent e2e db commits security].freeze
PACKAGE_SCRIPTS = %w[lint typecheck test test:integration].freeze
# The projects pnpm selects that must never enter the matrix, each because a
# dedicated job owns it: the root project, the Python agent, the browser suite.
MATRIX_EXCLUSIONS = ["animichi-cloudflare-worker", "@animichi/agent", "animichi-e2e"].freeze
# package => the marker of the step that provisions the binary its own `test`
# shells out to. Without the step the package's lane fails for a reason that
# has nothing to do with the code under test (#1359 review P1-1 / P1-2).
MATRIX_TOOLCHAINS = [
  ["@animichi/eval", "uv python install"],
  ["catalog", "install-atlas"],
  ["catalog", "docker build -f apps/agent/docker/test-postgres/Dockerfile"],
  ["infra", "pulumi/actions"]
].freeze
# The browser lane (card B4 / #1362). `animichi-e2e` is outside the affected
# matrix, so these are the only assertions standing between its specs and
# a silently dark lane: the `plan` filters that select the job, and the package
# scripts it runs. The retired composite must not come back — the served-Worker
# half of the lane lives in e2e/playwright.config.ts now.
BROWSER_FILTERS = %w[web e2e deps].freeze
BROWSER_SCRIPTS = %w[lint typecheck test].freeze
RETIRED_BROWSER_COMPOSITE = "cross-stack-e2e"
AGGREGATE_GUARD = "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')"
# A `.github/scripts/*.mjs` resolves its imports against the repository's
# node_modules, so any job that runs one has to install the workspace. Without
# it the script dies with ERR_MODULE_NOT_FOUND and the assertion that spawned
# it reports an ordinary failure (run 34001151283).
WORKSPACE_SETUP = "./.github/actions/setup"
NODE_SCRIPT = %r{\bnode \.github/scripts/\S+\.mjs}
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

# The offline image's tag is declared once. A `run:` reads it by sourcing the
# declaration; a step that spells the tag out instead is only legal while it
# still agrees with what the declaration says (packages/test-postgres/AGENTS.md).
IMAGE_DECLARATION = "packages/test-postgres/postgres-image.env"
IMAGE_BUILD = "docker build -f apps/agent/docker/test-postgres/Dockerfile"
IMAGE_REFERENCE = '"$TEST_POSTGRES_IMAGE"'
DECLARED_IMAGE = File.read(File.join(repository_root, IMAGE_DECLARATION))[/^TEST_POSTGRES_IMAGE=(.+)$/, 1].to_s.strip

@log = ViolationLog.new
@ci = WorkflowDocument.load(CI_FILE)
@source = File.read(CI_FILE)

def assert_plan_subtracts_owned_projects
  MATRIX_EXCLUSIONS.each do |name|
    @log.unless_true(@source.include?(%("#{name}")),
                     "pr-verification.yml: plan must subtract #{name} from the matrix")
  end
  @log.unless_true(@source.include?(%(--filter "...[$merge_base]")),
                   "pr-verification.yml: plan must select the affected set with pnpm's dependent-closure filter")
end

def assert_matrix_guard
  @log.unless_true(@ci.dig("jobs", "affected", "if").to_s.include?("needs.plan.outputs.packages != '[]'"),
                   "pr-verification.yml: affected must not start on an empty matrix")
  @log.unless_true(@ci.dig("jobs", "affected", "strategy", "matrix", "package").to_s
                      .include?("needs.plan.outputs.packages"),
                   "pr-verification.yml: the matrix must be the plan job's package list")
end

def matrix_step_source
  @ci.steps_of("affected").map { |step| step["run"] }.compact.join("\n")
end

# The exact token list, not a substring search: `test` alone would otherwise
# be satisfied by `test:integration` still being there.
def looped_scripts(source)
  source[/^\s*for script in ([^;]+); do/, 1].to_s.split
end

def matrix_scripts
  looped_scripts(matrix_step_source)
end

def assert_matrix_runs_package_scripts
  @log.unless_true(matrix_step_source.include?('pnpm --filter "$PACKAGE" run --if-present "$script"'),
                   "pr-verification.yml: the matrix must run the package's own scripts")
  @log.unless_true(matrix_scripts == PACKAGE_SCRIPTS,
                   "pr-verification.yml: the matrix must run exactly #{PACKAGE_SCRIPTS.join(', ')} " \
                   "(got #{matrix_scripts.join(', ')})")
end

def provisions?(step, package, tool)
  step.is_a?(Hash) && step["if"].to_s.include?(package) && "#{step['uses']}#{step['run']}".include?(tool)
end

def assert_matrix_provisions_toolchains
  MATRIX_TOOLCHAINS.each do |package, tool|
    @log.unless_true(@ci.steps_of("affected").any? { |step| provisions?(step, package, tool) },
                     "pr-verification.yml: `#{package}` needs a matrix step providing #{tool}")
  end
end

def browser_step_source
  @ci.steps_of("e2e").map { |step| "#{step['uses']}#{step['run']}" }.join("\n")
end

def assert_browser_lane_is_selected_by_the_plan
  condition = @ci.dig("jobs", "e2e", "if").to_s
  BROWSER_FILTERS.each do |filter|
    @log.unless_true(condition.include?("needs.plan.outputs.#{filter} == 'true'"),
                     "pr-verification.yml:e2e: must run when the `#{filter}` filter matched")
  end
end

def assert_browser_lane_runs_the_package
  source = browser_step_source
  @log.unless_true(source.include?('pnpm --filter animichi-e2e run "$script"'),
                   "pr-verification.yml:e2e: must run the browser package's own scripts")
  @log.unless_true(looped_scripts(source) == BROWSER_SCRIPTS,
                   "pr-verification.yml:e2e: must run exactly #{BROWSER_SCRIPTS.join(', ')} " \
                   "(got #{looped_scripts(source).join(', ')})")
  @log.unless_true(!source.include?(RETIRED_BROWSER_COMPOSITE),
                   "pr-verification.yml:e2e: the retired #{RETIRED_BROWSER_COMPOSITE} composite is back")
end

def runs_node_script?(job)
  @ci.steps_of(job).any? { |step| step["run"].to_s.match?(NODE_SCRIPT) }
end

def installs_workspace?(job)
  @ci.steps_of(job).any? { |step| step["uses"] == WORKSPACE_SETUP }
end

def assert_node_scripts_have_a_workspace
  @ci.jobs.each_key do |job|
    next unless runs_node_script?(job)

    @log.unless_true(installs_workspace?(job),
                     "pr-verification.yml:#{job}: runs a repository .mjs script without installing the workspace")
  end
end

def image_build_runs
  @ci.jobs.keys.flat_map { |job| @ci.steps_of(job) }
     .map { |step| step["run"] }.compact.select { |run| run.include?(IMAGE_BUILD) }
end

def built_tag(run)
  run[/#{Regexp.escape(IMAGE_BUILD)} -t (\S+) \./, 1].to_s
end

def resolves_the_declared_tag?(run)
  return true if built_tag(run) == DECLARED_IMAGE

  built_tag(run) == IMAGE_REFERENCE && run.include?(". #{IMAGE_DECLARATION}")
end

def assert_image_builds_resolve_one_tag
  @log.unless_true(!image_build_runs.empty?,
                   "pr-verification.yml: nothing builds the offline Postgres image any more")
  image_build_runs.each do |run|
    @log.unless_true(resolves_the_declared_tag?(run),
                     "pr-verification.yml: the image build tagged #{built_tag(run)} neither sources " \
                     "#{IMAGE_DECLARATION} nor names the tag it declares (#{DECLARED_IMAGE})")
  end
end

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

def assert_aggregate(job, expected_needs)
  @log.unless_true(@ci.dig("jobs", job, "if").to_s.include?("always()"),
                   "pr-verification.yml:#{job}: must run always()")
  @log.unless_true(Array(@ci.dig("jobs", job, "needs")).sort == expected_needs.sort,
                   "pr-verification.yml:#{job}: needs must be #{expected_needs.sort.join(', ')}")
  @log.unless_true(@ci.steps_of(job).map { |step| step["if"].to_s }.join(" ").include?(AGGREGATE_GUARD),
                   "pr-verification.yml:#{job}: must fail on a failed or cancelled dependency")
end

# B3 replaced the transitional codeql job with GitHub's CodeQL default setup:
# the ruleset's code_scanning rule consumes its results, and a workflow-side
# upload would fight it. The commits job is the CI mirror of the local
# commit-msg hook and gates the aggregate like every other lane.
def assert_commits_gate_replaces_codeql
  @log.unless_true(@ci.dig("jobs", "codeql").nil?,
                   "pr-verification.yml: the transitional codeql job must be gone (default setup owns CodeQL)")
  commits_runs = @ci.steps_of("commits").map { |step| step["run"].to_s }.join("\n")
  @log.unless_true(commits_runs.include?("commitlint"),
                   "pr-verification.yml:commits: must lint the PR's commits with commitlint")
  @log.unless_true(Array(@ci.dig("jobs", "aggregate", "needs")).include?("commits"),
                   "pr-verification.yml:aggregate: the commits gate must be one of its needs")
end

def assert_affected_lane
  assert_plan_subtracts_owned_projects
  assert_matrix_guard
  assert_matrix_runs_package_scripts
  assert_matrix_provisions_toolchains
end

# Its own group, not part of the affected lane above: `animichi-e2e` is
# subtracted from that matrix, so the `e2e` job is all that stands between its
# specs and a dark lane.
def assert_browser_lane
  assert_browser_lane_is_selected_by_the_plan
  assert_browser_lane_runs_the_package
end

def assert_aggregates
  assert_aggregate("security", SECURITY_JOBS)
  assert_aggregate("aggregate", LANE_JOBS)
  assert_commits_gate_replaces_codeql
end

def assert_schema_gate
  assert_schema_job_is_paths_filtered
  assert_schema_segments_are_separate_ordered_steps
  assert_schema_job_pins_atlas
end

def main
  assert_affected_lane
  assert_browser_lane
  assert_aggregates
  assert_node_scripts_have_a_workspace
  assert_image_builds_resolve_one_tag
  assert_schema_gate
  assert_no_job_applies_a_migration
  @log.report("CI workflow contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
