# SUT: observed container identities match the selected Worker and immutable image.
# frozen_string_literal: true
require 'minitest/autorun'
require 'json'
require 'open3'

class ReleaseContainerObservationTest < Minitest::Test
  def setup
    @image = "registry.cloudflare.com/#{'a' * 32}/animichi-agent@sha256:#{'d' * 64}"
    @container = { 'name' => 'agent-staging', 'class_name' => 'AgentContainer' }
    @application = { 'id' => '11111111-1111-4111-8111-111111111111', 'name' => 'agent-staging',
                     'configuration' => { 'image' => @image }, 'durable_objects' => { 'namespace_id' => 'owned-namespace' } }
    @binding = { 'type' => 'durable_object_namespace', 'class_name' => 'AgentContainer', 'namespace_id' => 'owned-namespace' }
    @version = { 'resources' => { 'bindings' => [@binding] } }
  end

  def observe
    file = File.expand_path('../lib/release/observations.mjs', __dir__)
    source = "import {containerIdentity} from #{file.to_json}; const input=JSON.parse(process.argv[1]); console.log(JSON.stringify(containerIdentity(...input)))"
    Open3.capture3('node', '--input-type=module', '-e', source, [@application, @version, @container, @image, 'edge-staging'].to_json)
  end

  def test_accepts_native_script_local_durable_object_binding
    output, error, status = observe
    assert status.success?, error
    assert_equal 'owned-namespace', JSON.parse(output).fetch('namespace_id')
    assert_equal @image, JSON.parse(output).fetch('image')
  end

  def test_refuses_application_from_another_namespace
    @application['durable_objects']['namespace_id'] = 'other-namespace'
    refute observe.last.success?
  end

  def test_refuses_container_from_another_worker_script
    @binding['script_name'] = 'edge-production'
    refute observe.last.success?
  end

  def test_refuses_another_container_class
    @binding['class_name'] = 'OtherContainer'
    refute observe.last.success?
  end

  def test_refuses_the_same_application_name_running_another_digest
    @application['configuration']['image'] = @image.sub('d' * 64, 'e' * 64)
    refute observe.last.success?
  end

  def test_refuses_the_same_namespace_under_another_application_name
    @application['name'] = 'agent-production'
    refute observe.last.success?
  end

  def test_refuses_missing_platform_application_identity
    @application.delete('id')
    refute observe.last.success?
  end
end
