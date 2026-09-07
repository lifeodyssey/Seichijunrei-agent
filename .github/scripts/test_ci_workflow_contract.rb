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
#   workspace   a job that runs a repository script importing workspace
#               dependencies installs the workspace first
#   workflows   a change under `.github/` still reaches the lanes whose tests
#               read deployment workflow text, and the route covers every
#               composite action the jobs call
#   contracts   every committed repository check runs somewhere in this file:
#               `.github/scripts/test_*.rb` and every `*.test.sh` under
#               `scripts/` or `.github/scripts/`. The list is read off the
#               working tree rather than off a second hand-kept list —
#               `quality.sh` was that list until #1371, and the checks it alone
#               ran would have gone dark with it.
#   image       every step building the offline Postgres image resolves the one
#               declaration in `packages/test-postgres/postgres-image.env`
#   commits     the `commits` job runs commitlint (the CI mirror of the
#               local commit-msg hook) and gates the aggregate; the B1
#               transitional codeql job is gone — default setup owns CodeQL
#   aggregates  `Security` and `PR Verification` each name their dependencies,
#               run `always()`, and fail on a failed or cancelled one
#
# The repository-wide meta-invariants (timeouts, permissions, concurrency,
# action pinning) are `test_workflow_invariants.rb`. Each job the affected
# matrix cannot see owns its own contract file, the seam card B2 opened with
# `test_agent_lane_contract.rb` (the Python lane): `animichi-e2e` is
# `test_browser_lane_contract.rb`, and `migrations/neon` is
# `test_schema_lane_contract.rb`. This file is what is left — the matrix
# itself, the aggregates, and the invariants that hold across every job.
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
  ["catalog", "ariga/setup-atlas"],
  ["catalog", "docker build -f apps/agent/docker/test-postgres/Dockerfile"],
  ["infra", "pulumi/actions"]
].freeze
AGGREGATE_GUARD = "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')"
# `.github/**` belongs to the root project, which the matrix subtracts, so pnpm
# answers a change under it with nothing. These two lanes own the tests that
# read deployment workflow text — several of which extract a shipped shell
# block and run it — and both have to be reachable from that change alone.
# The composite actions share that blind spot: `./.github/actions/setup` is how
# the matrix, the agent lane and the schema lane get a workspace, and while the
# route named only `workflows/**` a change to it selected no package and
# skipped the agent lane. Which glob covers them is the workflow's business.
WORKFLOW_ROUTE = "workflows"
WORKFLOW_FILTER = ".github/workflows/**"
LOCAL_ACTION_PATH = %r{\A\./(\.github/actions/[^/\s]+)}
WORKFLOW_PACKAGE = "edge-worker"
WORKFLOW_ROUTED_JOB = "agent"
# A check that is committed but named in no job is a check nothing runs.
# Package-owned scripts (workers/**, packages/**) are out of scope: their
# package's own `test` runs them and the affected matrix runs that.
COMMITTED_CHECKS = (Dir.glob(File.join(repository_root, ".github/scripts/test_*.rb")) +
                    Dir.glob(File.join(repository_root, "{scripts,.github/scripts}/**/*.test.sh")))
                   .map { |path| File.basename(path) }.uniq.freeze
# A `.github/scripts/*.mjs` resolves its imports against the repository's
# node_modules, so any job that runs one has to install the workspace. Without
# it the script dies with ERR_MODULE_NOT_FOUND and the assertion that spawned
# it reports an ordinary failure (run 34001151283).
WORKSPACE_SETUP = "./.github/actions/setup"
NODE_SCRIPT = %r{\bnode \.github/scripts/\S+\.mjs}
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

def assert_workflow_changes_reach_their_tests
  @log.unless_true(@source.include?("'#{WORKFLOW_FILTER}'"),
                   "pr-verification.yml: plan needs a #{WORKFLOW_FILTER} filter")
  @log.unless_true(@source.include?(%(["#{WORKFLOW_PACKAGE}"] | unique)),
                   "pr-verification.yml: a workflow-only change must still select #{WORKFLOW_PACKAGE}")
  @log.unless_true(@ci.dig("jobs", WORKFLOW_ROUTED_JOB, "if").to_s.include?("outputs.workflows == 'true'"),
                   "pr-verification.yml:#{WORKFLOW_ROUTED_JOB}: must run on a workflow-only change")
end

# The `workflows` route as the plan job declares it: the paths-filter input is
# a YAML document of its own, carried as a block scalar.
def declared_route_globs
  filters = @ci.steps_of("plan").map { |step| step.dig("with", "filters") }.compact.join("\n")
  Array(YAML.safe_load(filters)[WORKFLOW_ROUTE])
end

def local_actions_called
  @ci.jobs.each_key.flat_map { |job| @ci.steps_of(job) }
     .map { |step| step["uses"].to_s[LOCAL_ACTION_PATH, 1] }.compact.uniq
end

# A glob routes a directory when everything before its first wildcard is a
# prefix of it: `.github/actions/**` and `.github/actions/setup/**` both route
# `.github/actions/setup`; `.github/workflows/**` routes neither.
def routes?(glob, directory)
  "#{directory}/".start_with?(glob[/\A[^*?\[]*/])
end

# What the jobs call, not only the file they are written in: an action reached
# through `uses: ./…` sits where pnpm sees nothing, so this route is the only
# thing that can carry a change to it into a lane that runs it.
def assert_called_actions_are_routed
  @log.unless_true(!local_actions_called.empty?,
                   "pr-verification.yml: no job calls a repository composite action any more")
  local_actions_called.each do |path|
    @log.unless_true(declared_route_globs.any? { |glob| routes?(glob, path) },
                     "pr-verification.yml: the #{WORKFLOW_ROUTE} route does not cover #{path}")
  end
end

# Until #1371 this compared CI's list against `quality.sh`'s — two hand-kept
# lists of the same thing, and the pre-push orchestrator that held the second
# one is gone. The working tree is the list now: whatever check is committed
# under those two directories, some job here has to name it.
def assert_every_committed_check_runs
  runs = @ci.jobs.each_key.flat_map { |job| @ci.steps_of(job) }.map { |step| step["run"].to_s }.join("\n")
  missing = COMMITTED_CHECKS.reject { |name| runs.include?(name) }
  @log.unless_true(missing.empty?,
                   "pr-verification.yml: committed checks no job runs (#{missing.join(', ')})")
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

# Two questions with one shape: is the guard reachable from the change that
# would break it? A workflow-only pull request has to reach the lanes whose
# tests read workflow text, and a committed check has to be named by a job.
# Both failures are silent — the guard exists, and never fires.
def assert_guards_are_reachable
  assert_workflow_changes_reach_their_tests
  assert_called_actions_are_routed
  assert_every_committed_check_runs
end

def assert_aggregates
  assert_aggregate("security", SECURITY_JOBS)
  assert_aggregate("aggregate", LANE_JOBS)
  assert_commits_gate_replaces_codeql
end

def main
  assert_affected_lane
  assert_guards_are_reachable
  assert_aggregates
  assert_node_scripts_have_a_workspace
  assert_image_builds_resolve_one_tag
  @log.report("CI workflow contract: all assertions hold")
end

main if $PROGRAM_NAME == __FILE__
