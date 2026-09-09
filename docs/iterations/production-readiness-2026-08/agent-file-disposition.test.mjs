import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const BASE = 'fd73fbd532ef4d151a027ab8c93e9f2ea9304dab';
const PREFIX = 'workers/edge/src/agent/';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DOCUMENT = new URL('./AGENT-FILE-DISPOSITION.md', import.meta.url);
const COMPANIONS = [
  'workers/edge/src/db/schema.ts',
  'workers/edge/src/gateway/agent-turn.ts',
  'workers/edge/src/gateway/staging-prefix-route.ts',
  'packages/contract/src/staging-prefix-contract.ts',
  'packages/contract/src/staging-prefix-path.ts',
  'packages/eval/src/prefix-seeding-lifecycle.ts',
  'packages/eval/src/trajectory-prefix-case.ts',
];

function baselineFiles() {
  const output = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', BASE], { encoding: 'utf8' });
  return output.trim().split('\n');
}

function dispositionRows(document) {
  const pathRow = /^\| `(?:workers\/edge\/|packages\/|migrations\/neon\/)/u;
  return document.split('\n').filter((line) => pathRow.test(line))
    .map((line) => line.slice(2, -2).split(' | ').map((field) => field.replaceAll('`', '')));
}

function completeRow(row) {
  assert.equal(row.length, 5, row[0]);
  assert.match(row[1], /^\d+$/u, row[0]);
  assert.ok(['delete', 'rewrite-domain', 'retain-domain'].includes(row[2]), row[0]);
  assert.ok(row[3].trim().length > 0, row[0]);
  assert.match(row[4], /#[0-9]+/u, row[0]);
}

function nativeRewrite(row) {
  assert.match(row[3], /Remove: .+; Use: .+; Keep: .+/u, row[0]);
}

test('W0-1 accounts for the complete baseline tree and its companion surfaces', () => {
  const files = baselineFiles();
  const document = readFileSync(DOCUMENT, 'utf8');
  const rows = dispositionRows(document);
  const migrations = files.filter((path) => /^migrations\/neon\/.*agent_runs.*\.sql$/u.test(path));
  const expected = [...files.filter((path) => path.startsWith(PREFIX)), ...COMPANIONS, ...migrations];
  assert.ok(document.includes(BASE));
  assert.deepEqual(rows.map((row) => row[0]).sort(), expected.sort());
  rows.forEach(completeRow);
  rows.filter((row) => row[2] === 'rewrite-domain').forEach(nativeRewrite);
  assert.ok(rows.filter((row) => migrations.includes(row[0])).every((row) => row[2] === 'retain-domain'));
});
