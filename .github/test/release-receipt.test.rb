# SUT: receipt validation binds staging success to the selected artifact and observed deployment.
# frozen_string_literal: true
require 'minitest/autorun'
require_relative '../lib/release/receipt'

class ReleaseReceiptTest < Minitest::Test
  def setup
    @selection = { 'artifact_id' => '7', 'artifact_digest' => "sha256:#{'d' * 64}",
                   'source_sha' => 'b' * 40, 'controller_sha' => 'c' * 40 }
    @images = { 'agent' => 'agent@digest', 'migrator' => 'migrator@digest' }
    @receipt = { 'format' => 1, 'environment' => 'staging', 'selection' => @selection.dup,
                 'controller_run_id' => '9', 'controller_run_attempt' => '1', 'images' => @images,
                 'smoke' => 'passed', 'schema' => { 'compatible' => true, 'expectedHead' => 'B', 'appliedHead' => 'B', 'pendingCount' => 0 },
                 'workers' => %w[catalog edge migrator users web].map { |unit| { 'unit' => unit, 'script_name' => "#{unit}-staging", 'version_id' => '11111111-1111-4111-8111-111111111111', 'deployment_id' => '22222222-2222-4222-8222-222222222222' } } }
    @receipt['schema']['prisma'] = { 'targetHash' => 'b' * 64, 'markerHash' => 'b' * 64, 'migrations' => [], 'usedLiveMarker' => true }
  end

  def validate
    ReleaseReceipt.validate(@receipt, @selection, @images, run_id: '9', attempt: '2', prisma_ref: 'b' * 64)
  end

  def test_receipt_proves_b_was_tested_without_requiring_live_staging_to_remain_b
    assert validate
  end

  def test_refuses_other_artifact
    @receipt['selection']['artifact_id'] = '8'
    assert_raises(ArgumentError) { validate }
  end

  def test_refuses_other_controller
    @receipt['selection']['controller_sha'] = 'e' * 40
    assert_raises(ArgumentError) { validate }
  end

  def test_refuses_missing_smoke
    @receipt['smoke'] = 'failed'
    assert_raises(ArgumentError) { validate }
  end

  def test_refuses_incomplete_applied_schema
    @receipt['schema']['pendingCount'] = 1
    assert_raises(ArgumentError) { validate }
  end

  def test_refuses_a_different_native_marker_even_when_atlas_is_complete
    @receipt['schema']['prisma']['markerHash'] = 'c' * 64
    assert_raises(ArgumentError) { validate }
  end

  def test_refuses_a_self_consistent_receipt_for_another_native_contract
    @receipt['schema']['prisma']['targetHash'] = 'c' * 64
    @receipt['schema']['prisma']['markerHash'] = 'c' * 64
    assert_raises(ArgumentError) { validate }
  end

  def test_refuses_missing_observed_worker
    @receipt['workers'].pop
    assert_raises(ArgumentError) { validate }
  end

  def test_refuses_receipt_from_another_run
    @receipt['controller_run_id'] = '10'
    assert_raises(ArgumentError) { validate }
  end
end
