# SUT: the shipped migration controller forwards the selected artifact's complete metadata.
require "minitest/autorun"
require "tmpdir"
require "fileutils"
require "json"
require "open3"

class ReleaseMigrationRequestTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  HEAD = "20260102000000_extend"

  def setup
    @directory = Dir.mktmpdir("selected-migration-")
    @migrations = File.join(@directory, "migrations")
    FileUtils.mkdir_p([@migrations, File.join(@directory, "bin")])
    FileUtils.cp(File.join(ROOT, ".github/test/fixtures/migration-curl.rb"), File.join(@directory, "bin/curl"))
    FileUtils.chmod(0755, File.join(@directory, "bin/curl"))
    @sum = File.read(File.join(ROOT, "workers/migrator/test/fixtures/preflight-chain/atlas.sum"))
    File.write(File.join(@migrations, "atlas.sum"), @sum)
    File.write(File.join(@migrations, "#{HEAD}.sql"), "")
    File.write(File.join(@directory, 'contract.json'), { 'storage' => { 'storageHash' => 'b' * 64 } }.to_json)
  end

  def teardown
    FileUtils.remove_entry(@directory)
  end

  def invoke(overrides = {})
    environment = { "PATH" => "#{@directory}/bin:#{ENV.fetch('PATH')}", "MIGRATOR_URL" => "https://fixture.invalid",
      "RUNNER_TEMP" => @directory, "ACTIONS_ID_TOKEN_REQUEST_URL" => "https://fixture.invalid/token?a=1",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN" => "fixture-request", "SEALED_HEAD" => HEAD,
      "POST_BODY" => File.join(@directory, "body.json"), "CALL_LOG" => File.join(@directory, "calls"),
      "BUNDLE_POLL_SECONDS" => "0", "STALE_BUNDLE_ATTEMPTS" => "2" }
    Open3.capture3(environment.merge(overrides), "bash", File.join(ROOT, "scripts/delivery/migrate-through-worker.sh"), "staging", @migrations,
                   File.join(@directory, 'contract.json'))
  end

  def migration_count
    File.readlines(File.join(@directory, "calls")).count { |line| line.include?("/migrate") }
  end

  { "schema_refusal" => '{"error":"incompatible_schema"}', "unknown_conflict" => '{"error":"unknown"}',
    "malformed_conflict" => 'not-json', "success_shaped_conflict" => '{"success":true}',
    "non_object_conflict" => '[]' }.each do |name, body|
    define_method("test_#{name}_stops_after_one_apply_request") do
      _output, _error, status = invoke("MIGRATION_CODES" => "409 200", "MIGRATION_CONFLICT" => body)
      refute status.success?
      assert_equal 1, migration_count
    end
  end

  %w[stale_bundle stale_prisma_bundle].each do |reason|
    define_method("test_explicit_#{reason}_rechecks_the_bundle_and_retries") do
      output, error, status = invoke("MIGRATION_CODES" => "409 200", "MIGRATION_CONFLICT" => { "error" => reason }.to_json)
      assert status.success?, output + error
      assert_equal 2, migration_count
      assert_equal 2, File.readlines(File.join(@directory, "calls")).count { |line| line.include?("/healthz") }
    end
  end

  def test_forwards_the_selected_native_contract_without_reading_latest
    _output, error, status = invoke
    assert status.success?, error
    assert_equal 'b' * 64, JSON.parse(File.read(File.join(@directory, 'body.json')))['expectedPrismaRef']
  end

  def test_forwards_the_complete_selected_checksum_file
    output, error, status = invoke
    assert status.success?, "#{output}\n#{error}"
    assert_equal({ "expectedHead" => HEAD, "atlasSum" => @sum, "stagingOnlyBaseline" => false, "expectedPrismaRef" => "b" * 64 },
                 JSON.parse(File.read(File.join(@directory, "body.json"))))
  end

  def test_forwards_the_actual_staging_only_marker
    File.write(File.join(@migrations, "STAGING_ONLY_BASELINE"), "explicit fixture marker")
    output, error, status = invoke
    assert status.success?, "#{output}\n#{error}"
    assert_equal true, JSON.parse(File.read(File.join(@directory, "body.json"))).fetch("stagingOnlyBaseline")
  end

  def test_missing_metadata_stops_before_requesting_credentials
    File.unlink(File.join(@migrations, "atlas.sum"))
    _output, _error, status = invoke
    refute status.success?
    refute File.exist?(File.join(@directory, "calls"))
  end
end
