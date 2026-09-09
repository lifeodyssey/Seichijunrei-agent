# SUT: workflow and action credentials come from guarded ESC exports under environment-bound identities.
require "minitest/autorun"
require "psych"

class WorkflowCredentialsTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  FILES = Dir.glob(File.join(ROOT, ".github/{workflows,actions}/**/*.{yml,yaml}")).sort
  IDENTITY_ACTIONS = %w[pulumi/auth-actions pulumi/esc-action].freeze

  FILES.each do |path|
    name = path.delete_prefix("#{ROOT}/")
    document = Psych.safe_load(File.read(path), aliases: true)
    define_method("test_#{name}_does_not_read_github_secrets") do
      refute_match(/\bsecrets\.[A-Za-z0-9_]+|secrets:\s*inherit/, File.read(path))
    end

    document.fetch("jobs", {}).each do |id, job|
      steps = job.fetch("steps", [])
      identity = steps.any? { |step| IDENTITY_ACTIONS.any? { |action| step["uses"].to_s.start_with?("#{action}@") } }
      define_method("test_#{name}_#{id}_binds_its_oidc_identity_to_an_environment") do
        refute_nil job["environment"], "#{name}:#{id}: the issuer requires an environment subject"
      end if identity

      opened = steps.select { |step| step["uses"].to_s.start_with?("pulumi/esc-action@") }
                    .flat_map { |step| step.dig("with", "export-environment-variables").to_s.split(",").map(&:strip) }
                    .reject(&:empty?)
      define_method("test_#{name}_#{id}_guards_every_export_before_spending_it") do
        guarded = steps.flat_map { |step| step["run"].to_s.scan(/for key in ([A-Z0-9_ ]+); do/) }.flatten.flat_map(&:split)
        assert_equal opened.sort, guarded.sort, "#{name}:#{id}: ESC only warns on missing values"
      end unless opened.empty?
    end
  end
end
