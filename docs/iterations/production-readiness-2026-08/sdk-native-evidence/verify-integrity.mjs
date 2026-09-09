import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const records = JSON.parse(readFileSync(new URL('./package-integrity.json', import.meta.url), 'utf8'));
const directory = process.argv[2] ?? '.';
const verified = [];
for (const record of records.packages) {
  const bytes = readFileSync(join(directory, record.tarballFile));
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  const shasum = createHash('sha1').update(bytes).digest('hex');
  assert.equal(integrity, record.registry.integrity, record.name);
  assert.equal(shasum, record.registry.shasum, record.name);
  verified.push({ name: record.name, version: record.version, bytes: bytes.length, integrity, shasum });
}
console.log(JSON.stringify({ verified }, null, 2));
