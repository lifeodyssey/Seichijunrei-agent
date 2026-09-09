# SUT: pr-verification.yml zizmor job runs the official scanner at the required strength.
require "minitest/autorun"
require "psych"

class PrVerificationZizmorTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CI_FILE = File.join(ROOT, ".github", "workflows", "pr-verification.yml")
  ZIZMOR_ACTION = "zizmorcore/zizmor-action"
  ZIZMOR_INPUTS = { "persona" => "pedantic", "annotations" => true, "version" => "1.30.0", "advanced-security" => false }.freeze

  def setup
    @ci = Psych.safe_load(File.read(CI_FILE), aliases: true)
  end

  def zizmor_step
    @ci.dig("jobs", "zizmor", "steps").to_a.find { |step| step["uses"].to_s.start_with?("#{ZIZMOR_ACTION}@") }
  end

  def test_zizmor_runs_at_full_strength
    step = zizmor_step
    assert(step, "pr-verification.yml:zizmor: no #{ZIZMOR_ACTION} step to configure")

    assert_equal ZIZMOR_INPUTS, step.fetch("with"),
                 "zizmor must retain its complete audited inputs without narrowing collection or findings"
  end
end
