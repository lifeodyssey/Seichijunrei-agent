import assert from 'node:assert/strict';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function deploymentIdentity(deployment, version, source) {
  assert.match(deployment.id, UUID, 'missing actual deployment ID');
  assert.match(version.id, UUID, 'missing actual version ID');
  assert.deepEqual(deployment.versions, [{ version_id: version.id, percentage: 100 }], 'release must serve all traffic');
  assert.equal(version.annotations?.['workers/tag'], `sha-${source}`, 'live Worker is not the selected source');
  return { deployment_id: deployment.id, version_id: version.id };
}

export function containerIdentity(application, version, container, image, scriptName) {
  const binding = version.resources.bindings.find((item) => item.type === 'durable_object_namespace' && item.class_name === container.class_name && (!item.script_name || item.script_name === scriptName));
  assert.match(application.id, UUID, 'missing actual container application ID');
  assert.equal(application.name, container.name, 'container application name mismatch');
  assert.equal(application.configuration.image, image, 'live container image differs from the selected digest');
  assert.ok(binding?.namespace_id, 'container has no script-scoped Durable Object');
  assert.equal(application.durable_objects.namespace_id, binding.namespace_id, 'container belongs to another Worker');
  return { application_id: application.id, name: application.name, image, namespace_id: binding.namespace_id };
}
