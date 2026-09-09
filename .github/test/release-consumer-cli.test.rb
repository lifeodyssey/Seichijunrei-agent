# SUT: seal.rb and verify.rb preserve complete selected source closure across skipped commits.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'
require 'rubygems/package'

module ReleaseConsumerFixture
  FOUNDATION_FILES = { 'infra/AGENTS.md' => "# 基础设施\nNeon 数据库规则\n", 'infra/Pulumi.yaml' => 'foundation A', 'infra/database-access/Pulumi.yaml' => 'database A',
                       'package.json' => '{}', 'pnpm-lock.yaml' => 'lockfileVersion: 9.0',
                       'pnpm-workspace.yaml' => 'packages: []', '.pulumi.version' => '3.255.0' }.freeze
  MIGRATION_FILES = { 'atlas.sum' => 'A checksum', 'A.sql' => 'catalog A schema -- 宇治の聖地' }.freeze
  PRISMA_FILES = { 'src/contract.json' => '{"storageHash":"native-B"}', 'migrations/app/B/ops.json' => 'native B operations' }.freeze
  BUILT_FILES = %w[catalog/bundle/index.js users/bundle/index.js edge/bundle/entry.js migrator/bundle/index.js
                   catalog/wrangler.json users/wrangler.json edge/wrangler.json migrator/wrangler.json web/wrangler.json
                   web/.output/server/index.mjs web/.output/public/app.js
                   foundation/infra/database-access/sdks/neon/bin/index.js].freeze

  def setup
    @root = Dir.mktmpdir
    command('git', 'init', '--initial-branch=main')
    command('git', 'config', 'user.name', 'Release Test')
    command('git', 'config', 'user.email', 'release-test@example.invalid')
    write_history
    write_release
    seal_release
    FileUtils.mkdir_p(File.join(@root, 'incoming'))
  end

  def teardown
    FileUtils.remove_entry(@root)
  end

  def command(*arguments)
    out, err, status = Open3.capture3(*arguments, chdir: @root)
    raise err unless status.success?
    out.strip
  end

  def write(path, content)
    target = File.join(@root, path)
    FileUtils.mkdir_p(File.dirname(target))
    File.write(target, content)
  end

  def commit(label)
    command('git', 'add', '.')
    command('git', 'commit', '-m', label)
    command('git', 'rev-parse', 'HEAD')
  end

  def write_history
    FOUNDATION_FILES.each { |path, content| write(path, content) }
    MIGRATION_FILES.each { |path, content| write("migrations/neon/#{path}", content) }
    PRISMA_FILES.each { |path, content| write("packages/pi-session-neon/#{path}", content) }
    commit('A')
    write('web.txt', 'B web')
    @source = commit('B')
    write('web.txt', 'C web')
    write('migrations/neon/C.sql', 'C schema')
    @controller = commit('C')
  end

  def write_release
    FOUNDATION_FILES.each { |path, content| write("release/foundation/#{path}", content) }
    MIGRATION_FILES.each { |path, content| write("release/migrations/#{path}", content) }
    BUILT_FILES.each { |path| write("release/#{path}", 'B built with A') }
    PRISMA_FILES.each { |path, content| write("release/migrator/bundle/#{path.delete_prefix('src/')}", content) }
  end

  def seal_release
    environment = { 'GITHUB_REPOSITORY' => 'lifeodyssey/animichi', 'GITHUB_SHA' => @source, 'GITHUB_RUN_ID' => '9', 'GITHUB_RUN_ATTEMPT' => '1',
                    'AGENT_IMAGE' => "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}",
                    'MIGRATOR_IMAGE' => "registry.cloudflare.com/#{'a' * 32}/animichi-migrator@sha256:#{'e' * 64}" }
    output, error, status = Open3.capture3(environment, 'ruby', File.expand_path('../scripts/release/seal.rb', __dir__), chdir: @root)
    assert status.success?, output + error
    selection = { 'source_sha' => @source, 'repository' => 'lifeodyssey/animichi', 'run_id' => '9', 'run_attempt' => '1', 'controller_sha' => @controller }
    write('selection.json', selection.to_json)
  end

  def pack
    command('tar', '--format=ustar', '-cf', 'incoming/release.tar', 'release')
    FileUtils.remove_entry(File.join(@root, 'release'))
  end

  def verify
    Open3.capture3('ruby', File.expand_path('../scripts/release/verify.rb', __dir__), chdir: @root)
  end
end

class ReleaseConsumerCliTest < Minitest::Test
  include ReleaseConsumerFixture

  def test_native_sealer_tar_and_consumer_restore_b_and_its_a_prerequisites_after_c
    pack
    _out, error, status = verify
    assert status.success?, error
    assert_equal 'catalog A schema -- 宇治の聖地', File.read(File.join(@root, 'release/migrations/A.sql'))
    assert_equal 'B built with A', File.read(File.join(@root, 'release/web/.output/public/app.js'))
    assert_equal "# 基础设施\nNeon 数据库规则\n", File.read(File.join(@root, 'release/foundation/infra/AGENTS.md'))
    refute File.exist?(File.join(@root, 'release/migrations/C.sql'))
  end

  def test_native_consumer_refuses_content_changed_after_sealing
    write('release/web/.output/public/app.js', 'substituted C')
    pack
    refute verify.last.success?
  end

  def test_archive_cannot_overwrite_the_trusted_controller
    write('.github/controller.rb', 'trusted controller C')
    pack
    File.open(File.join(@root, 'incoming/release.tar'), 'wb') do |file|
      Gem::Package::TarWriter.new(file) { |tar| tar.add_file_simple('.github/controller.rb', 0o644, 1) { |entry| entry.write('X') } }
    end
    refute verify.last.success?
    assert_equal 'trusted controller C', File.read(File.join(@root, '.github/controller.rb'))
    refute File.exist?(File.join(@root, 'release'))
  end

  def test_extra_downloaded_files_are_refused_before_extraction
    pack
    write('incoming/controller.rb', 'artifact controller')
    refute verify.last.success?
    refute File.exist?(File.join(@root, 'release'))
  end
end
