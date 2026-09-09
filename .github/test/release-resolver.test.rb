# SUT: resolve.rb validates native GitHub provenance and source ancestry before accepting selection.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'tmpdir'
require 'fileutils'
require 'open3'

class ReleaseResolverTest < Minitest::Test
  def setup
    @directory = Dir.mktmpdir
    @repository = File.join(@directory, 'repository')
    FileUtils.mkdir_p(@repository)
    initialize_repository
    prepare_artifact
    prepare_producer
    prepare_github_command
  end

  def initialize_repository
    git('init', '--initial-branch=main')
    git('config', 'user.name', 'Release Test')
    git('config', 'user.email', 'release-test@example.invalid')
    @source = commit('B')
    @controller = commit('C')
  end

  def prepare_artifact
    @artifact = { 'id' => 7, 'name' => "release-snapshot-#{@source}-1", 'expired' => false,
                  'expires_at' => '2026-09-10T00:00:00Z', 'digest' => "sha256:#{'d' * 64}",
                  'workflow_run' => { 'id' => 9, 'repository_id' => 11, 'head_repository_id' => 11, 'head_branch' => 'main', 'head_sha' => @source } }
  end

  def prepare_producer
    run = { 'id' => 9, 'workflow_id' => 13, 'run_attempt' => 1, 'event' => 'push', 'status' => 'completed', 'conclusion' => 'success',
            'head_branch' => 'main', 'head_sha' => @source, 'repository' => { 'id' => 11, 'full_name' => 'lifeodyssey/animichi' },
            'head_repository' => { 'id' => 11, 'full_name' => 'lifeodyssey/animichi' } }
    File.write(File.join(@directory, 'run.json'), run.to_json)
    File.write(File.join(@directory, 'workflow.json'), { 'id' => 13, 'path' => '.github/workflows/release-build.yml' }.to_json)
  end

  def prepare_github_command
    File.write(File.join(@directory, 'gh'), github_fixture)
    File.chmod(0o755, File.join(@directory, 'gh'))
    @environment = { 'PATH' => "#{@directory}:#{ENV.fetch('PATH')}", 'ARTIFACT_ID' => '7', 'GITHUB_REF' => 'refs/heads/main',
                     'GITHUB_REPOSITORY' => 'lifeodyssey/animichi', 'GITHUB_REPOSITORY_ID' => '11', 'GITHUB_SHA' => @controller,
                     'GITHUB_OUTPUT' => File.join(@directory, 'outputs'), 'EXPECTED_DIGEST' => "sha256:#{'d' * 64}" }
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def github_fixture
    File.read(File.join(__dir__, "fixtures/release/resolver-gh.sh"))
  end

  def git(*arguments)
    output, error, status = Open3.capture3('git', *arguments, chdir: @repository)
    raise error unless status.success?
    output.strip
  end

  def commit(label)
    File.write(File.join(@repository, 'source.txt'), label)
    git('add', '.')
    git('commit', '-m', label)
    git('rev-parse', 'HEAD')
  end

  def resolve
    File.write(File.join(@directory, 'artifact.json'), @artifact.to_json)
    path = File.expand_path('../scripts/release/resolve.rb', __dir__)
    clock = 'Time.stub(:now, Time.utc(2026, 9, 9)) { load ARGV.fetch(0) }'
    Open3.capture3(@environment, 'ruby', '-rminitest/mock', '-e', clock, path, chdir: @repository)
  end

  def test_real_entry_selects_b_with_its_original_successful_attempt_after_c
    _output, error, status = resolve
    assert status.success?, error
    selection = JSON.parse(File.read(File.join(@repository, 'selection.json')))
    assert_equal @source, selection.fetch('source_sha')
    assert_equal @controller, selection.fetch('controller_sha')
    assert_includes File.read(@environment['GITHUB_OUTPUT']), "artifact_id=7\n"
  end

  def test_changed_digest_refuses_before_any_outputs
    @environment['EXPECTED_DIGEST'] = "sha256:#{'e' * 64}"
    refute resolve.last.success?
    refute File.exist?(@environment['GITHUB_OUTPUT'])
    refute File.exist?(File.join(@repository, 'selection.json'))
  end

  def test_branch_dispatch_refuses_before_any_outputs
    @environment['GITHUB_REF'] = 'refs/heads/feature'
    refute resolve.last.success?
    refute File.exist?(@environment['GITHUB_OUTPUT'])
  end

  def test_unknown_artifact_refuses_before_any_outputs
    @environment['ARTIFACT_ID'] = '8'
    refute resolve.last.success?
    refute File.exist?(@environment['GITHUB_OUTPUT'])
  end

  def test_failed_metadata_command_cannot_authorize_even_with_a_valid_body
    @environment['GH_EXIT'] = '1'
    refute resolve.last.success?
    refute File.exist?(@environment['GITHUB_OUTPUT'])
  end

  def test_successful_main_labeled_artifact_outside_controller_history_is_refused
    git('checkout', '--orphan', 'side')
    side = commit('D')
    git('checkout', 'main')
    @artifact['name'] = "release-snapshot-#{side}-1"
    @artifact['workflow_run']['head_sha'] = side
    run = JSON.parse(File.read(File.join(@directory, 'run.json'))).merge('head_sha' => side)
    File.write(File.join(@directory, 'run.json'), run.to_json)
    refute resolve.last.success?
    refute File.exist?(File.join(@repository, 'selection.json'))
  end
end
