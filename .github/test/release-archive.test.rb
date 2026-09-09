# SUT: release archive validation rejects unsafe paths and archive entry types.
# frozen_string_literal: true
require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require 'rubygems/package'
require_relative '../lib/release/archive'

class ReleaseArchiveTest < Minitest::Test
  def archive(name)
    path = File.join(@directory, 'release.tar')
    File.open(path, 'wb') do |file|
      Gem::Package::TarWriter.new(file) do |tar|
        tar.add_file_simple(name, 0o644, 1) { |entry| entry.write('x') }
      end
    end
    path
  end

  def setup
    @directory = Dir.mktmpdir
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def test_accepts_only_release_rooted_regular_members
    assert ReleaseArchive.validate(archive('release/catalog/bundle/index.js'))
  end

  def test_refuses_controller_overwrite
    assert_raises(ArgumentError) { ReleaseArchive.validate(archive('.github/scripts/release/resolve.rb')) }
  end

  def test_refuses_parent_traversal
    assert_raises(ArgumentError) { ReleaseArchive.validate(archive('release/../../controller.rb')) }
  end

  def test_refuses_absolute_member
    assert_raises(ArgumentError) { ReleaseArchive.validate(archive('/release/catalog.js')) }
  end

  def test_refuses_symlink
    path = File.join(@directory, 'link.tar')
    File.open(path, 'wb') do |file|
      Gem::Package::TarWriter.new(file) { |tar| tar.add_symlink('release/catalog/link', '../../controller.rb', 0o644) }
    end
    assert_raises(ArgumentError) { ReleaseArchive.validate(path) }
  end

  def test_refuses_duplicate_paths
    path = File.join(@directory, 'release.tar')
    File.open(path, 'wb') do |file|
      Gem::Package::TarWriter.new(file) do |tar|
        2.times { tar.add_file_simple('release/item', 0o644, 1) { |entry| entry.write('x') } }
      end
    end
    assert_raises(ArgumentError) { ReleaseArchive.validate(path) }
  end
end
