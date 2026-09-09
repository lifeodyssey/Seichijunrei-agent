# SUT: release-build.yml produces one complete snapshot with pinned providers, images and environment-independent bundles.
require "minitest/autorun"
require "psych"

class ReleaseBuildTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  def setup
    @build = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/release-build.yml")), aliases: true)
    @steps = @build.fetch("jobs").fetch("snapshot").fetch("steps")
    @sealer = File.read(File.join(ROOT, ".github/scripts/release/seal-foundation.sh"))
  end

  def test_main_push_only_builds_snapshots
    assert_equal({ "push" => { "branches" => ["main"] } }, @build["on"] || @build[true])
    guard = @build.dig("jobs", "snapshot", "if")
    assert_includes guard, "github.repository == 'lifeodyssey/animichi'"
    assert_includes guard, "github.ref == 'refs/heads/main'"
    assert_empty @steps.select { |step| %w[up destroy].include?(step.dig("with", "command")) }
    refute_match(/wrangler deploy|publish-services|migrate-through-worker|schema-preflight/, @steps.map { |step| step["run"] }.join("\n"))
  end

  def test_sealing_installs_pinned_pulumi_before_generating_native_sdk
    cli = @steps.index { |step| step["uses"].to_s.start_with?("pulumi/actions@") }
    seal = @steps.index { |step| step["run"] == "bash .github/scripts/release/seal-foundation.sh" }
    refute_nil cli
    refute_nil seal
    assert_operator cli, :<, seal
    assert_equal ".pulumi.version", @steps[cli].dig("with", "pulumi-version-file")
    assert_includes @sealer, "pulumi install --no-dependencies --no-plugins"
    refute_includes @sealer, "pulumi package add"
    patches = @steps.index { |step| step["run"] == 'node .github/scripts/release/seal-pnpm-patches.mjs "$GITHUB_SHA" release/foundation' }
    refute_nil patches
    assert_operator seal, :<, patches
    assert_operator patches, :<, @steps.index { |step| step["run"].to_s.include?("ruby .github/scripts/release/seal.rb") }
  end

  def test_neon_sdk_uses_committed_provider_versions
    project = Psych.safe_load(File.read(File.join(ROOT, "infra/database-access/Pulumi.yaml")))
    assert_equal({ "source" => "terraform-provider", "version" => "1.4.0",
                   "parameters" => ["kislerdm/neon", "0.17.0"] }, project.dig("packages", "neon"))
  end

  def test_build_produces_both_single_platform_images_once
    images = @steps.select { |step| step["uses"].to_s.start_with?("docker/build-push-action@") }
    assert_equal %w[agent migrator], images.map { |step| step["id"] }
    assert_equal ["apps/agent/Dockerfile", "workers/migrator/Dockerfile"], images.map { |step| step.dig("with", "file") }
    images.each do |step|
      assert_equal "linux/amd64", step.dig("with", "platforms")
      assert_equal true, step.dig("with", "push")
      assert_equal false, step.dig("with", "provenance")
      assert_equal false, step.dig("with", "sbom")
    end
  end

  def test_both_workers_pin_the_build_output_digest
    step = @steps.find { |item| item["name"] == "Bundle paired Workers and seal immutable image references" }
    assert_equal "registry.cloudflare.com/${{ vars.CLOUDFLARE_ACCOUNT_ID }}/animichi-agent@${{ steps.agent.outputs.digest }}", step.dig("env", "AGENT_IMAGE")
    assert_equal "registry.cloudflare.com/${{ vars.CLOUDFLARE_ACCOUNT_ID }}/animichi-migrator@${{ steps.migrator.outputs.digest }}", step.dig("env", "MIGRATOR_IMAGE")
    assert_includes step.fetch("run"), "ruby .github/scripts/release/seal.rb"
    assert_includes step.fetch("run"), "ruby .github/scripts/release/inspect-images.rb"
  end

  def test_one_complete_snapshot_is_uploaded_after_sealing
    uploads = @steps.select { |step| step["uses"].to_s.start_with?("actions/upload-artifact@") }
    assert_equal 1, uploads.length
    assert_equal "release-snapshot-${{ github.sha }}-${{ github.run_attempt }}", uploads.first.dig("with", "name")
    assert_equal "release.tar", uploads.first.dig("with", "path")
    assert_equal "error", uploads.first.dig("with", "if-no-files-found")
    refute_includes @build.to_s, "VITE_"
  end

  def test_build_uses_a_separate_exact_environment_and_only_registry_export
    assert_equal "release-build", @build.dig("jobs", "snapshot", "environment")
    assert_equal ["lifeodyssey/animichi/release-build"], @steps.map { |step| step.dig("with", "environment") }.compact
    assert_equal ["CLOUDFLARE_API_TOKEN"], @steps.map { |step| step.dig("with", "export-environment-variables") }.compact
  end
end
