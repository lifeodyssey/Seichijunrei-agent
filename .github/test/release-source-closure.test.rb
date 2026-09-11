# SUT: source closure includes all selected foundation and migration files and excludes later files.
# frozen_string_literal: true
require 'minitest/autorun'
require 'tmpdir'
require 'fileutils'
require 'open3'
require_relative '../lib/release/source_closure'

class ReleaseSourceClosureTest < Minitest::Test
  def setup
    @directory = Dir.mktmpdir
    @repository = File.join(@directory, 'repository')
    @release = File.join(@directory, 'release')
    FileUtils.mkdir_p([@repository, @release])
    initialize_history
    seal_selected_source
  end

  def initialize_history
    git('init', '--initial-branch=main')
    git('config', 'user.name', 'Release Test')
    git('config', 'user.email', 'release-test@example.invalid')
    write_prerequisites
    commit('A')
    write('web.txt', 'B depends on catalog A')
    @selected = commit('B')
    write('migrations/neon/C.sql', 'schema C')
    write('packages/pi-session-neon/migrations/app/C/ops.json', 'native C')
    commit('C')
  end

  def write_prerequisites
    write('migrations/neon/atlas.sum', 'A checksum')
    write('migrations/neon/A.sql', 'catalog A schema')
    write('migrations/neon/STAGING_ONLY_BASELINE', 'approval required')
    write('infra/index.ts', 'foundation A')
    write('packages/pi-session-neon/src/contract.json', '{"storageHash":"B"}')
    write('packages/pi-session-neon/migrations/app/B/ops.json', 'native B')
    %w[package.json pnpm-lock.yaml pnpm-workspace.yaml .pulumi.version].each { |file| write(file, file) }
    write('packages/pi-session-neon/patches/native.patch', 'selected native patch')
    write('package.json', '{"pnpm":{"patchedDependencies":{"native@1":"packages/pi-session-neon/patches/native.patch"}}}')
  end

  def seal_selected_source
    FileUtils.mkdir_p(File.join(@release, 'foundation'))
    FileUtils.cp_r(File.join(@repository, 'infra'), File.join(@release, 'foundation'))
    FileUtils.cp_r(File.join(@repository, 'migrations/neon'), File.join(@release, 'migrations'))
    File.delete(File.join(@release, 'migrations/C.sql'))
    bundle = File.join(@release, 'migrator/bundle')
    FileUtils.mkdir_p(bundle)
    FileUtils.cp(File.join(@repository, 'packages/pi-session-neon/src/contract.json'), bundle)
    FileUtils.cp_r(File.join(@repository, 'packages/pi-session-neon/migrations'), bundle)
    FileUtils.remove_entry(File.join(bundle, 'migrations/app/C'))
    %w[package.json pnpm-lock.yaml pnpm-workspace.yaml .pulumi.version].each do |file|
      FileUtils.cp(File.join(@repository, file), File.join(@release, 'foundation', file))
    end
    patch_directory = File.join(@release, 'foundation/packages/pi-session-neon/patches')
    FileUtils.mkdir_p(patch_directory)
    FileUtils.cp(File.join(@repository, 'packages/pi-session-neon/patches/native.patch'), patch_directory)
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def git(*arguments)
    stdout, stderr, status = Open3.capture3('git', *arguments, chdir: @repository)
    raise stderr unless status.success?
    stdout.strip
  end

  def write(path, content)
    FileUtils.mkdir_p(File.dirname(File.join(@repository, path)))
    File.write(File.join(@repository, path), content)
  end

  def commit(name)
    git('add', '.')
    git('commit', '-m', name)
    git('rev-parse', 'HEAD')
  end

  def validate
    Dir.chdir(@repository) { ReleaseSourceClosure.validate(@selected, @release) }
  end

  def test_b_uses_its_complete_a_prerequisites_after_c_exists
    assert validate
    assert git('merge-base', '--is-ancestor', @selected, 'HEAD')
  end

  def test_omitted_a_migration_fails
    File.delete(File.join(@release, 'migrations/A.sql'))
    assert_raises(ArgumentError) { validate }
  end

  def test_omitted_baseline_marker_fails
    File.delete(File.join(@release, 'migrations/STAGING_ONLY_BASELINE'))
    assert_raises(ArgumentError) { validate }
  end

  def test_substituted_c_schema_fails
    File.write(File.join(@release, 'migrations/C.sql'), 'schema C')
    assert_raises(ArgumentError) { validate }
  end

  def test_substituted_foundation_fails
    File.write(File.join(@release, 'foundation/infra/index.ts'), 'foundation C')
    assert_raises(ArgumentError) { validate }
  end

  def test_native_migration_bytes_cannot_be_changed_and_resealed
    File.write(File.join(@release, 'migrator/bundle/migrations/app/B/ops.json'), 'substituted native operations')
    assert_raises(ArgumentError) { validate }
  end

  def test_a_later_native_graph_file_cannot_enter_b
    directory = File.join(@release, 'migrator/bundle/migrations/app/C')
    FileUtils.mkdir_p(directory)
    File.write(File.join(directory, 'ops.json'), 'native C')
    assert_raises(ArgumentError) { validate }
  end

  def test_omitting_native_operations_cannot_be_resealed
    File.unlink(File.join(@release, 'migrator/bundle/migrations/app/B/ops.json'))
    assert_raises(ArgumentError) { validate }
  end

  def test_omitting_a_patch_required_by_the_selected_installer_is_refused
    File.unlink(File.join(@release, 'foundation/packages/pi-session-neon/patches/native.patch'))
    assert_raises(ArgumentError) { validate }
  end

  def test_native_archive_seals_selected_patch_bytes_after_the_checkout_changes
    write('packages/pi-session-neon/patches/native.patch', 'later patch C')
    commit('later patch')
    script = File.expand_path('../scripts/release/seal-pnpm-patches.mjs', __dir__)
    _output, error, status = Open3.capture3('node', script, @selected, File.join(@release, 'foundation'), chdir: @repository)
    assert status.success?, error
    assert_equal 'selected native patch', File.read(File.join(@release, 'foundation/packages/pi-session-neon/patches/native.patch'))
  end
end
