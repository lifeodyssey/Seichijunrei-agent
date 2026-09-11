# SUT: publish-services.sh invokes the native Wrangler CLI for every sealed service and rejects invalid inputs.
require "minitest/autorun"
require "tmpdir"
require "open3"
require "json"
require "fileutils"

class ReleasePublishServicesTest < Minitest::Test
  ROOT = ENV.fetch("TEST_REPOSITORY_ROOT", File.expand_path("../..", __dir__))
  SCRIPT = File.join(ROOT, ".github/scripts/release/publish-services.sh")
  SHA = "b" * 40

  def setup
    @dir = Dir.mktmpdir("release-publish-")
    @calls = File.join(@dir, "calls.jsonl")
    File.write(File.join(@dir, "pnpm"), "#!/usr/bin/env ruby\nrequire 'json'\nFile.open(ENV.fetch('CALLS'), 'a') { |f| f.puts ARGV.to_json }\n")
    File.chmod(0o755, File.join(@dir, "pnpm"))
  end

  def teardown
    FileUtils.remove_entry(@dir)
  end

  def publish(environment, sha = SHA)
    env = { "PATH" => "#{@dir}:#{ENV.fetch('PATH')}", "CALLS" => @calls, "SOURCE_SHA" => sha }
    Open3.capture3(env, "bash", SCRIPT, environment)
  end

  def test_staging_publishes_every_sealed_service_with_the_selected_source_tag
    _out, error, status = publish("staging")
    assert status.success?, error
    expected = %w[catalog users edge web].map do |unit|
      ["exec", "wrangler", "deploy", "--no-bundle", "--config", "release/#{unit}/wrangler.json", "--env", "staging", "--tag", "sha-#{SHA}"]
    end
    assert_equal expected, File.readlines(@calls).map { |line| JSON.parse(line) }
  end

  def test_unknown_environment_never_invokes_wrangler
    _out, _error, status = publish("preview")
    refute status.success?
    refute File.exist?(@calls)
  end

  def test_invalid_selected_sha_never_invokes_wrangler
    _out, _error, status = publish("production", "not-a-sha")
    refute status.success?
    refute File.exist?(@calls)
  end
end
