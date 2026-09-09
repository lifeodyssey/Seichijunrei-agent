import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { unstable_readConfig } from 'wrangler';
import { deploymentIdentity, containerIdentity } from '../../lib/release/observations.mjs';

function wrangler(...args) {
  return JSON.parse(execFileSync('pnpm', ['exec', 'wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
}

function observeContainers(config, version, applications, image) {
  return (config.containers ?? []).map((container) => {
    const listed = applications.find((application) => application.name === container.name);
    assert.ok(listed, 'deployed container application is unavailable');
    const application = wrangler('containers', 'info', listed.id);
    return containerIdentity(application, version, container, image, config.name);
  });
}

function observeWorker(unit, environment, manifest, applications) {
  const config = unstable_readConfig({ config: `release/${unit}/wrangler.json`, env: environment });
  const deployments = wrangler('deployments', 'list', '--name', config.name, '--json');
  const deployment = deployments.sort((a, b) => b.created_on.localeCompare(a.created_on))[0];
  assert.ok(deployment?.versions?.length === 1, 'missing complete Worker deployment');
  const version = wrangler('versions', 'view', deployment.versions[0].version_id, '--name', config.name, '--json');
  const identity = deploymentIdentity(deployment, version, manifest.source_sha);
  const containers = observeContainers(config, version, applications, manifest.images[unit === 'edge' ? 'agent' : unit]);
  return { unit, script_name: config.name, ...identity, containers };
}

const environment = process.argv[2];
assert.ok(['staging', 'production'].includes(environment), 'unknown receipt environment');
const manifest = JSON.parse(readFileSync('release/release.json', 'utf8'));
const schema = JSON.parse(readFileSync('schema-preflight.json', 'utf8'));
assert.equal(schema.compatible, true);
assert.equal(schema.pendingCount, 0, 'selected schema is not fully applied');
assert.equal(schema.appliedHead, schema.expectedHead);
const prismaRef = JSON.parse(readFileSync('release/migrator/bundle/contract.json', 'utf8')).storage.storageHash;
assert.match(prismaRef, /^[a-f0-9]{64}$/);
assert.equal(schema.prisma.targetHash, prismaRef);
assert.equal(schema.prisma.markerHash, prismaRef);
assert.equal(schema.prisma.usedLiveMarker, true);
assert.deepEqual(schema.prisma.migrations, []);
const applications = wrangler('containers', 'list', '--json');
const workers = ['migrator', 'catalog', 'users', 'edge', 'web'].map((unit) => observeWorker(unit, environment, manifest, applications));
const selection = JSON.parse(readFileSync('selection.json', 'utf8'));
const receipt = { format: 1, environment, selection, controller_run_id: process.env.GITHUB_RUN_ID, controller_run_attempt: process.env.GITHUB_RUN_ATTEMPT,
  workers, schema, images: manifest.images, smoke: 'passed', observed_at: new Date().toISOString() };
writeFileSync('receipt.json', JSON.stringify(receipt, null, 2));
