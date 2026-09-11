# SUT: verify-receipt.rb binds the immutable receipt artifact to the controller run and digest.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'

class ReleaseReceiptCliTest < Minitest::Test
  def setup
    @root = Dir.mktmpdir
    FileUtils.mkdir_p([File.join(@root, 'staging-receipt'), File.join(@root, 'release/migrator/bundle')])
    File.write(File.join(@root, 'release/migrator/bundle/contract.json'), { 'storage' => { 'storageHash' => 'b' * 64 } }.to_json)
    @selection = { 'artifact_id' => '7', 'artifact_digest' => "sha256:#{'d' * 64}", 'source_sha' => 'b' * 40, 'controller_sha' => 'c' * 40 }
    @images = { 'agent' => 'agent@digest', 'migrator' => 'migrator@digest' }
    prepare_receipt_metadata
    @environment = { 'PATH' => "#{@root}:#{ENV.fetch('PATH')}", 'RECEIPT_ID' => '20', 'RECEIPT_DIGEST' => 'e' * 64,
                     'GITHUB_RUN_ID' => '9', 'GITHUB_RUN_ATTEMPT' => '2' }
    File.write(File.join(@root, 'gh'), github_fixture)
    File.chmod(0o755, File.join(@root, 'gh'))
  end

  def prepare_receipt_metadata
    @receipt = { 'format' => 1, 'environment' => 'staging', 'selection' => @selection.dup, 'images' => @images,
                 'controller_run_id' => '9', 'controller_run_attempt' => '1', 'smoke' => 'passed',
                 'schema' => { 'compatible' => true, 'expectedHead' => 'B', 'appliedHead' => 'B', 'pendingCount' => 0 }, 'workers' => workers }
    @receipt['schema']['prisma'] = { 'targetHash' => 'b' * 64, 'markerHash' => 'b' * 64, 'migrations' => [], 'usedLiveMarker' => true }
    @artifact = { 'id' => 20, 'name' => 'staging-receipt-9-1', 'expired' => false, 'expires_at' => '2026-09-10T00:00:00Z',
                  'digest' => "sha256:#{'e' * 64}", 'workflow_run' => { 'id' => 9 } }

  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def workers
    %w[catalog edge migrator users web].map do |unit|
      { 'unit' => unit, 'script_name' => "#{unit}-staging", 'version_id' => '11111111-1111-4111-8111-111111111111',
        'deployment_id' => '22222222-2222-4222-8222-222222222222' }
    end
  end

  def github_fixture
    <<~'SH'
      #!/usr/bin/env bash
      set -euo pipefail
      [ "${GH_EXIT:-0}" = 0 ] || exit "$GH_EXIT"
      [ "$1" = api ]
      [ "${@: -1}" = repos/lifeodyssey/animichi/actions/artifacts/20 ]
      cat artifact.json
    SH
  end

  def verify
    File.write(File.join(@root, 'artifact.json'), @artifact.to_json)
    File.write(File.join(@root, 'staging-receipt/receipt.json'), @receipt.to_json)
    File.write(File.join(@root, 'selection.json'), @selection.to_json)
    File.write(File.join(@root, 'release/release.json'), { 'images' => @images }.to_json)
    entry = File.expand_path('../scripts/release/verify-receipt.rb', __dir__)
    clock = 'Time.stub(:now, Time.utc(2026, 9, 9)) { load ARGV.fetch(0) }'
    Open3.capture3(@environment, 'ruby', '-rminitest/mock', '-e', clock, entry, chdir: @root)
  end

  def test_native_metadata_admits_same_controller_run_receipt_from_earlier_attempt
    _output, error, status = verify
    assert status.success?, error
  end

  def test_receipt_target_comes_from_the_real_generated_contract
    source = File.expand_path('../../packages/pi-session-neon/src/contract.json', __dir__)
    FileUtils.cp(source, File.join(@root, 'release/migrator/bundle/contract.json'))
    target = JSON.parse(File.read(source)).fetch('storage').fetch('storageHash')
    @receipt['schema']['prisma']['targetHash'] = target
    @receipt['schema']['prisma']['markerHash'] = target
    _output, error, status = verify
    assert status.success?, error
  end

  def test_expired_during_approval_is_refused_even_when_expired_flag_is_false
    @artifact['expires_at'] = '2026-09-08T23:59:59Z'
    refute verify.last.success?
  end

  def test_expiry_at_the_current_instant_is_refused
    @artifact['expires_at'] = '2026-09-09T00:00:00Z'
    refute verify.last.success?
  end

  def test_wrong_artifact_id_is_refused
    @artifact['id'] = 21
    refute verify.last.success?
  end

  def test_another_controller_run_is_refused
    @artifact['workflow_run']['id'] = 10
    refute verify.last.success?
  end

  def test_unavailable_receipt_metadata_is_refused
    @environment['GH_EXIT'] = '1'
    refute verify.last.success?
  end

  def test_different_selected_snapshot_is_refused
    @receipt['selection']['artifact_id'] = '8'
    refute verify.last.success?
  end

  def test_digest_substitution_is_refused
    @artifact['digest'] = "sha256:#{'f' * 64}"
    refute verify.last.success?
  end

  def test_matching_non_sha256_strings_are_not_artifact_digests
    @artifact['digest'] = 'invalid-digest'
    @environment['RECEIPT_DIGEST'] = 'invalid-digest'
    refute verify.last.success?
  end

  def test_receipt_from_a_future_attempt_is_refused
    @receipt['controller_run_attempt'] = '3'
    @artifact['name'] = 'staging-receipt-9-3'
    refute verify.last.success?
  end
end
