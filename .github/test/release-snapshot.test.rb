# SUT: snapshot validation requires every deploy unit and verifies every sealed byte.
# frozen_string_literal: true
require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require_relative '../lib/release/snapshot'

class ReleaseSnapshotTest < Minitest::Test
  def setup
    @root = Dir.mktmpdir
    ReleaseSnapshot::REQUIRED_FILES.each do |path|
      FileUtils.mkdir_p(File.dirname(File.join(@root, path)))
      File.write(File.join(@root, path), path)
    end
    FileUtils.mkdir_p(File.join(@root, 'web/.output/public'))
    File.write(File.join(@root, 'web/.output/public/app.js'), 'built B with catalog A')
    File.write(File.join(@root, 'migrations/20260901000000_a.sql'), 'catalog A')
    @metadata = snapshot_metadata
  end

  def snapshot_metadata
    { 'source_sha' => 'b' * 40, 'run_id' => '9', 'run_attempt' => '1',
                  'repository' => 'lifeodyssey/animichi', 'kind' => 'full-snapshot', 'format' => 1,
                  'images' => { 'agent' => "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}",
                    'migrator' => "registry.cloudflare.com/#{'a' * 32}/animichi-migrator@sha256:#{'e' * 64}" } }
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def manifest
    @metadata.merge('files' => ReleaseSnapshot.hashes(@root))
  end

  def test_b_contains_cumulative_a_catalog_and_schema
    assert ReleaseSnapshot.validate(@root, manifest, @metadata)
    assert_equal 'catalog A', File.read(File.join(@root, 'migrations/20260901000000_a.sql'))
  end

  def test_refuses_missing_catalog_even_when_manifest_is_resealed
    File.delete(File.join(@root, 'catalog/bundle/index.js'))
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_missing_generated_provider
    File.delete(File.join(@root, 'foundation/infra/database-access/sdks/neon/bin/index.js'))
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_mutated_file_after_sealing
    sealed = manifest
    File.write(File.join(@root, 'web/.output/public/app.js'), 'substituted C')
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, sealed, @metadata) }
  end

  def test_refuses_source_substitution
    selection = @metadata.merge('source_sha' => 'c' * 40)
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, selection) }
  end

  def test_refuses_mutable_image_tag
    @metadata['images']['agent'] = "registry.cloudflare.com/#{'a' * 32}/animichi-agent:sha-b"
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_missing_image
    @metadata['images'].delete('migrator')
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end

  def test_refuses_empty_public_output
    File.delete(File.join(@root, 'web/.output/public/app.js'))
    assert_raises(ArgumentError) { ReleaseSnapshot.validate(@root, manifest, @metadata) }
  end
end
