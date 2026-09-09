# SUT: cd.yml consumers download one verified snapshot by immutable ID without rebuilding.
require "minitest/autorun"
require "psych"

class CdArtifactTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))

  def setup
    @cd = Psych.safe_load(File.read(File.join(ROOT, ".github/workflows/cd.yml")), aliases: true)
  end

  def steps(job)
    @cd.fetch("jobs").fetch(job).fetch("steps")
  end

  def step(job, name)
    steps(job).find { |item| item["name"] == name }.tap { |item| refute_nil item, name }
  end

  def position(job, name)
    steps(job).index(step(job, name))
  end

  def test_each_consumer_downloads_the_selected_id_with_official_digest_verification
    %w[select stage promote-production].each do |job|
      hydrate = step(job, "Verify the selected snapshot")
      assert_equal "$/.github/actions/hydrate-release", hydrate.fetch("uses")
      assert_equal "${{ steps.selection.outputs.artifact_id }}", hydrate.dig("with", "artifact-id")
      assert_equal "${{ steps.selection.outputs.run_id }}", hydrate.dig("with", "run-id")
    end
  end

  def test_hydration_verifies_the_official_immutable_download_before_returning
    action = Psych.safe_load(File.read(File.join(ROOT, ".github/actions/hydrate-release/action.yml")))
    assert_equal "composite", action.dig("runs", "using")
    download, verify = action.dig("runs", "steps")
    assert_match %r{\Aactions/download-artifact@[0-9a-f]{40}\z}, download.fetch("uses")
    assert_equal "${{ inputs.artifact-id }}", download.dig("with", "artifact-ids")
    assert_equal "${{ inputs.run-id }}", download.dig("with", "run-id")
    assert_equal "lifeodyssey/animichi", download.dig("with", "repository")
    assert_equal "error", download.dig("with", "digest-mismatch")
    refute download.fetch("with").key?("name")
    assert_equal "ruby .github/scripts/release/verify.rb", verify.fetch("run")
    assert_equal "bash", verify.fetch("shell")
  end

  def test_consumers_never_rebuild_the_snapshot
    refute_match(/build-push-action|containers push|--dry-run|--filter web (?:run )?build|pulumi install/, @cd.to_s)
    uploads = @cd.fetch("jobs").values.flat_map { |job| job.fetch("steps") }
                 .select { |item| item["uses"].to_s.start_with?("actions/upload-artifact@") }
    assert_equal ["receipt.json", "receipt.json"], uploads.map { |item| item.dig("with", "path") }
  end

  def test_verified_bytes_precede_every_dependency_install
    %w[stage promote-production].each do |job|
      install = steps(job).index { |item| item["run"] == "pnpm install --frozen-lockfile --ignore-scripts" }
      refute_nil install
      assert_operator position(job, "Verify the selected snapshot"), :<, install
    end
  end
end
