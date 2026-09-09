# SUT: pr-verification.yml aggregates and commits job preserve required checks and squash/branch linting.
require "minitest/autorun"
require "psych"

class PrVerificationAggregatesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  SECURITY_JOBS = %w[gitleaks trufflehog osv semgrep zizmor sqlfluff].freeze
  LANE_JOBS = %w[plan affected contracts docs agent e2e db commits security].freeze
  AGGREGATE_GUARD = "contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')"

  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def test_security_aggregate
    assert_aggregate("security", SECURITY_JOBS)
  end

  def test_verification_aggregate
    assert_aggregate("aggregate", LANE_JOBS)
  end

  def assert_aggregate(job, expected_needs)
    assert(@ci.dig("jobs", job, "if").to_s.include?("always()"),
                     "pr-verification.yml:#{job}: must run always()")
    assert(Array(@ci.dig("jobs", job, "needs")).sort == expected_needs.sort,
                     "pr-verification.yml:#{job}: needs must be #{expected_needs.sort.join(', ')}")
    assert(@ci.dig("jobs", job, "steps").to_a.map { |step| step["if"].to_s }.join(" ").include?(AGGREGATE_GUARD),
                     "pr-verification.yml:#{job}: must fail on a failed or cancelled dependency")
  end
end

class PrVerificationCommitsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  PR_TITLE_EXPRESSION = "github.event.pull_request.title"
  COMMIT_RANGE_FLAGS = %w[--from --to].freeze

  def setup
    @ci = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/pr-verification.yml")), aliases: true)
  end

  def commitlint_steps
    @ci.dig("jobs", "commits", "steps").to_a.select { |step| step["run"].to_s.include?("commitlint") }
  end

  def pr_title_env_name(step)
    env = step["env"]
    return nil unless env.is_a?(Hash)

    env.find { |_, value| value.to_s.include?(PR_TITLE_EXPRESSION) }&.first
  end

  def test_commitlint_lints_the_squash_subject
    step = commitlint_steps.find { |candidate| pr_title_env_name(candidate) }
    assert(step,
                     "pr-verification.yml:commits: no commitlint step reads #{PR_TITLE_EXPRESSION} — " \
                     "the squash-merge subject would reach main unlinted")
    assert(step["run"].to_s.include?("$#{pr_title_env_name(step)}"),
                     "pr-verification.yml:commits: the step holding #{PR_TITLE_EXPRESSION} must feed " \
                     "that name to commitlint, not declare it and lint something else")
  end

  def test_commitlint_lints_the_branch_commits
    assert(commitlint_steps.any? { |step| COMMIT_RANGE_FLAGS.all? { |flag| step["run"].to_s.include?(flag) } },
                     "pr-verification.yml:commits: no commitlint step lints the branch's own commits " \
                     "over a #{COMMIT_RANGE_FLAGS.join('/')} range")
  end

  def test_commits_gate_replaces_codeql
    assert(@ci.dig("jobs", "codeql").nil?,
                     "pr-verification.yml: the transitional codeql job must be gone (default setup owns CodeQL)")
    assert(Array(@ci.dig("jobs", "aggregate", "needs")).include?("commits"),
                     "pr-verification.yml:aggregate: the commits gate must be one of its needs")
  end

end
