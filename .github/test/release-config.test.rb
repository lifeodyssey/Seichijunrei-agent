# SUT: native Wrangler configuration sealing preserves bindings and immutable images.
# frozen_string_literal: true
require 'minitest/autorun'
require 'open3'
require 'json'

class ReleaseConfigTest < Minitest::Test
  def seal(unit, reference = '')
    script = File.expand_path('../lib/release/config.mjs', __dir__)
    source = "import {sealedConfig} from #{script.to_json}; console.log(JSON.stringify(sealedConfig(process.argv[1], process.argv[2])))"
    output, error, status = Open3.capture3('node', '--input-type=module', '-e', source, unit, reference)
    assert status.success?, error
    JSON.parse(output)
  end

  def test_container_configs_all_use_selected_digest_without_build_context
    reference = "registry.cloudflare.com/#{'a' * 32}/animichi-migrator@sha256:#{'d' * 64}"
    config = seal('migrator', reference)
    assert_equal 'bundle/index.js', config.fetch('main')
    assert_equal reference, config.fetch('containers').first.fetch('image')
    assert_equal reference, config.dig('env', 'staging', 'containers').first.fetch('image')
    assert_equal reference, config.dig('env', 'production', 'containers').first.fetch('image')
    refute config.fetch('containers').first.key?('image_build_context')
    refute config.dig('env', 'production', 'containers').first.key?('image_build_context')
    refute config.key?('build')
    assert_equal true, config['no_bundle']
    assert_equal true, config['find_additional_modules']
    assert_equal true, config['preserve_file_names']
    assert_equal 'bundle', config['base_dir']
    assert config.fetch('rules').any? { |rule| rule['type'] == 'Text' && rule['globs'].include?('migrations/**/*') }
  end

  def test_catalog_keeps_native_environment_bindings
    config = seal('catalog')
    assert_equal 'catalog-staging', config.dig('env', 'staging', 'name')
    assert_equal 'catalog', config.dig('env', 'production', 'name')
    assert_equal 'bundle/index.js', config.fetch('main')
  end

  def test_web_keeps_sealed_assets_and_runtime_configuration
    config = seal('web')
    assert_equal '.output/server/index.mjs', config.fetch('main')
    assert_equal '.output/public', config.dig('assets', 'directory')
    assert_equal 'animichi-web-staging', config.dig('env', 'staging', 'name')
    assert config.dig('env', 'production', 'vars', 'RUNTIME_CONFIG')
  end
end
