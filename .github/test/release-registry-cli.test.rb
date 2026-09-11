# SUT: inspect-images.rb requires successful native registry inspection before accepting images.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'

class ReleaseRegistryCliTest < Minitest::Test
  def setup
    @root = Dir.mktmpdir
    FileUtils.mkdir_p(File.join(@root, 'release'))
    @manifest = JSON.parse(File.read(File.join(__dir__, "fixtures/release/docker-manifest.json")))
    @images = %w[agent migrator].to_h { |unit| [unit, "registry.cloudflare.com/#{'a' * 32}/animichi-#{unit}@#{@manifest.fetch("digest")}"] }
    @image = { 'os' => 'linux', 'architecture' => 'amd64' }
    @environment = { 'PATH' => "#{@root}:#{ENV.fetch('PATH')}", 'CLOUDFLARE_ACCOUNT_ID' => 'a' * 32 }
    File.write(File.join(@root, 'docker'), registry_fixture)
    File.chmod(0o755, File.join(@root, 'docker'))
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def registry_fixture
    File.read(File.join(__dir__, "fixtures/release/registry-docker.sh"))
  end

  def inspect_registry
    File.write(File.join(@root, 'release/release.json'), { 'images' => @images }.to_json)
    File.write(File.join(@root, 'manifest.json'), @manifest.to_json)
    File.write(File.join(@root, 'image.json'), @image.to_json)
    entry = File.expand_path('../scripts/release/inspect-images.rb', __dir__)
    Open3.capture3(@environment, 'ruby', entry, chdir: @root)
  end

  def assert_refused
    _output, _error, status = inspect_registry
    refute status.success?
    refute File.exist?(File.join(@root, 'registry-proof.json'))
  end

  def test_native_inspection_records_manifest_descriptor_and_platform_requests
    _output, error, status = inspect_registry
    assert status.success?, error
    proof = JSON.parse(File.read(File.join(@root, 'registry-proof.json')))
    assert_equal @images, proof.transform_values { |item| item.fetch('reference') }
    assert_equal 4, File.readlines(File.join(@root, 'requests')).size
    assert_includes File.read(File.join(@root, 'requests')), "#{@images['agent']} --format {{json .Manifest}}"
  end

  def test_missing_remote_manifest_produces_no_proof
    @environment['REGISTRY_EXIT'] = '1'
    assert_refused
  end

  def test_denied_registry_access_produces_no_proof
    @environment['REGISTRY_EXIT'] = '42'
    assert_refused
  end

  def test_failed_inspection_with_valid_json_produces_no_proof
    @environment['REGISTRY_POST_EXIT'] = '1'
    assert_refused
  end

  def test_forged_remote_digest_produces_no_proof
    @manifest['digest'] = "sha256:#{'e' * 64}"
    assert_refused
  end

  def test_non_object_registry_reply_produces_no_proof
    @manifest = nil
    assert_refused
  end

  def test_wrong_image_platform_produces_no_proof
    @image['architecture'] = 'arm64'
    assert_refused
  end

  def test_wrong_registry_account_produces_no_proof
    @environment['CLOUDFLARE_ACCOUNT_ID'] = 'b' * 32
    assert_refused
  end
end
