# SUT: cd.yml stage smoke probes public surfaces and makes a failed probe decisive.
require "minitest/autorun"
require "psych"

class CdStageSmokeTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")
  SMOKE_PROBE = "bash .github/scripts/staging-smoke-check.sh"
  SMOKE_SURFACES = ["https://animichi-staging.zhenjiazhou0127.workers.dev",
                    "https://animichi-web-staging.zhenjiazhou0127.workers.dev"].freeze
  SMOKE_ESCAPES = ["|| true", "set +e", %w[continue on error].join("-")].freeze
  DEFAULT_SUCCESS = ["${{ success() }}", "success()"].freeze
  STAGING_JOB = "stage"
  SMOKE_STEP = "Smoke the release"

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
  end

  def smoke_step
    @cd.dig("jobs", STAGING_JOB, "steps").to_a.find { |step| step["name"] == SMOKE_STEP }.to_h
  end

  def test_smoke_probes_the_real_surfaces
    text = smoke_step["run"].to_s
    assert(text.include?(SMOKE_PROBE), "cd.yml:#{SMOKE_STEP}: must run #{SMOKE_PROBE}")
    SMOKE_SURFACES.each do |url|
      assert(text.include?(url), "cd.yml:#{SMOKE_STEP}: must probe #{url}")
    end
  end

  def smoke_suppressor_keys
    suppressor = SMOKE_ESCAPES.last
    [smoke_step[suppressor], @cd.dig("jobs", STAGING_JOB, suppressor)].compact
  end

  def last_command(text)
    text.lines.map(&:strip).reject { |line| line.empty? || line.start_with?("#") }.last.to_s
  end

  def test_smoke_failure_is_decisive
    text = smoke_step["run"].to_s
    SMOKE_ESCAPES.each do |escape|
      assert(!text.include?(escape),
                       "cd.yml:#{SMOKE_STEP}: `#{escape}` would let a broken staging promote")
    end
    assert(smoke_suppressor_keys.empty?,
                     "cd.yml:#{SMOKE_STEP}: nothing here may survive a failed probe")
  end

  def test_probe_is_the_last_executable_command
    last = last_command(smoke_step["run"].to_s)
    assert(last.start_with?(SMOKE_PROBE),
                     "cd.yml:#{SMOKE_STEP}: the last command must BE the probe, not merely mention it")
    assert(last.end_with?(SMOKE_SURFACES.last),
                     "cd.yml:#{SMOKE_STEP}: nothing may follow the probe in it, or its result is not " \
                     "what decides")
  end

  def test_the_probe_keeps_the_default_success_condition
    condition = smoke_step["if"]
    assert(condition.nil? || DEFAULT_SUCCESS.include?(condition.to_s.strip),
                     "cd.yml:#{SMOKE_STEP}: must keep the default success condition — `#{condition}` " \
                     "lets a run whose publish failed probe the version already deployed and record " \
                     "this head as live on staging")
  end
end
