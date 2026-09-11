# SUT: registry inspection validates the exact remote manifest digest and execution platform.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'

# Fixture: official buildx imagetools inspect --format '{{json .Manifest}}', alpine linux/amd64.
# Docker returns a descriptor for a single image; schemaVersion belongs to the raw manifest.
require_relative '../lib/release/registry'

class ReleaseRegistryTest < Minitest::Test
  def setup
    @manifest = JSON.parse(File.read(File.join(__dir__, "fixtures/release/docker-manifest.json")))
    @digest = @manifest.fetch("digest")
    @reference = "registry.cloudflare.com/#{'a' * 32}/animichi-agent@#{@digest}"
    @image = { 'architecture' => 'amd64', 'os' => 'linux' }
  end

  def verify
    ReleaseRegistry.validate(@reference, @manifest, @image, 'a' * 32)
  end

  def test_native_manifest_descriptor_and_linux_amd64_are_required
    assert verify
  end

  def test_refuses_different_remote_digest
    @manifest['digest'] = "sha256:#{'e' * 64}"
    assert_raises(ArgumentError) { verify }
  end

  def test_refuses_manifest_without_digest
    @manifest.delete('digest')
    assert_raises(ArgumentError) { verify }
  end

  def test_refuses_wrong_platform
    @image['architecture'] = 'arm64'
    assert_raises(ArgumentError) { verify }
  end

  def test_refuses_other_account
    @reference = @reference.sub('a' * 32, 'b' * 32)
    assert_raises(ArgumentError) { verify }
  end

  def test_refuses_multi_platform_index_without_single_platform_proof
    @manifest['mediaType'] = 'application/vnd.oci.image.index.v1+json'
    assert_raises(ArgumentError) { verify }
  end
end
