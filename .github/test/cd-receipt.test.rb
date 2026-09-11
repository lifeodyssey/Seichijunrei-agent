# SUT: cd.yml observes successful staging and requires its immutable receipt after production approval.
require "minitest/autorun"
require "psych"

class CdReceiptTest < Minitest::Test
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

  def test_receipt_records_actual_versions_only_after_successful_smoke
    %w[stage promote-production].each do |job|
      record = step(job, "Record observed deployment identities")
      assert_operator position(job, "Record observed deployment identities"), :>, position(job, "Smoke the release")
      refute record.key?("if")
      assert_includes record.fetch("run"), "schema-preflight.sh"
      assert_includes record.fetch("run"), "node .github/scripts/release/record-receipt.mjs"
    end
  end

  def test_stage_exports_the_immutable_receipt_identity
    assert_equal({ "receipt_id" => "${{ steps.receipt.outputs.artifact-id }}",
                   "receipt_digest" => "${{ steps.receipt.outputs.artifact-digest }}" }, @cd.dig("jobs", "stage", "outputs"))
    upload = step("stage", "Publish the immutable staging receipt").fetch("with")
    assert_equal "staging-receipt-${{ github.run_id }}-${{ github.run_attempt }}", upload.fetch("name")
    assert_equal "receipt.json", upload.fetch("path")
    assert_equal "error", upload.fetch("if-no-files-found")
  end

  def test_production_downloads_the_current_controller_run_receipt_by_id
    download = step("promote-production", "Download the staging receipt").fetch("with")
    assert_equal "${{ needs.stage.outputs.receipt_id }}", download.fetch("artifact-ids")
    assert_equal "${{ github.run_id }}", download.fetch("run-id")
    assert_equal "lifeodyssey/animichi", download.fetch("repository")
    assert_equal "error", download.fetch("digest-mismatch")
    refute download.key?("name")
  end

  def test_receipt_verification_is_required_before_production_credentials
    verify = step("promote-production", "Verify the staging receipt")
    assert_equal "ruby .github/scripts/release/verify-receipt.rb", verify.fetch("run")
    assert_equal "${{ needs.stage.outputs.receipt_id }}", verify.dig("env", "RECEIPT_ID")
    assert_equal "${{ needs.stage.outputs.receipt_digest }}", verify.dig("env", "RECEIPT_DIGEST")
    assert_operator position("promote-production", "Verify the staging receipt"), :<, position("promote-production", "Log into Pulumi Cloud")
  end
end
