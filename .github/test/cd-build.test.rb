# SUT: cd.yml build seals generated infrastructure SDKs after provisioning Pulumi and excludes runtime environment values.
require "minitest/autorun"
require "psych"

class CdBuildTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  CD_FILE = File.join(ROOT, ".github", "workflows", "cd.yml")

  def setup
    @cd = Psych.safe_load(File.read(CD_FILE), aliases: true)
    @source = File.read(CD_FILE)
  end

  def step_index(job, marker)
    @cd.dig("jobs", job, "steps").to_a.index { |step| "#{step['name']}#{step['uses']}#{step['run']}".include?(marker) }
  end

  def test_build_installs_pulumi_before_sealing
    cli = step_index("build", "pulumi/actions")
    seal = step_index("build", "pulumi install")
    assert(!cli.nil? && !seal.nil? && cli < seal,
                     "cd.yml:build: the pinned Pulumi CLI must be installed before the SDK is generated")
  end

  def test_neon_sdk_uses_committed_provider_versions
    project = Psych.safe_load(File.read(File.join(ROOT, "infra/database-access/Pulumi.yaml")))
    expected = { "source" => "terraform-provider", "version" => "1.4.0",
                 "parameters" => ["kislerdm/neon", "0.17.0"] }
    assert_equal expected, project.dig("packages", "neon")
  end

  def test_build_does_not_resolve_provider_versions_again
    build = @cd.dig("jobs", "build", "steps").map { |step| step["run"] }.compact.join("\n")
    refute_includes build, "pulumi package add"
  end

  def test_no_build_time_environment_values
    assert(!@source.include?("VITE_"),
                     "cd.yml: a VITE_* value would make the artifact environment-specific")
  end
end
