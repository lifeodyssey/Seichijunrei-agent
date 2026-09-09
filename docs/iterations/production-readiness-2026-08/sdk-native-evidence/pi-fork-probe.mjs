import assert from 'node:assert/strict';
import { MemorySessionRepo, BACKGROUND_CONTEXT, value, list } from '@earendil-works/pi-agent-core';

// Portable copy of the original probe: only stdout replaces its local output path.
const ctx = BACKGROUND_CONTEXT;
const repo = new MemorySessionRepo();
const source = await repo.create({}, ctx);
const branch = await source.createBranch('main', null, ctx);
const ref = await branch.appendCustomEntry('animichi.tool-result', { candidates: [{ id: 'tokyo' }] }, ctx);
const current = value('animichi.selection');
const history = list('animichi.selections');
await source.setValue(current, { candidateRef: ref, revision: 3 }, ctx);
await source.appendList(history, { selected: 'tokyo' }, ctx);
const fork = await repo.fork(source.metadata, { scope: 'tree' }, ctx);
const sourceValue = await source.getValue(current, ctx);
const forkValue = await fork.getValue(current, ctx);
const sourceList = await source.readList(history, undefined, ctx);
const forkList = await fork.readList(history, undefined, ctx);
const sourceEntry = await source.getEntry(ref, ctx);
const forkEntry = await fork.getEntry(ref, ctx);
assert.deepEqual(forkValue.value, sourceValue.value);
assert.deepEqual(forkEntry, sourceEntry);
assert.equal(sourceList.length, 1);
assert.equal(forkList.length, 0);
const otherRepo = new MemorySessionRepo();
let crossRepoError;
try {
  await otherRepo.fork(source.metadata, { scope: 'tree' }, ctx);
} catch (error) {
  crossRepoError = error.message;
}
assert.match(crossRepoError, /^Unknown session:/);
console.log(JSON.stringify({
  sdk: '0.85.1', imports: '@earendil-works/pi-agent-core public root',
  nativeTreeForkSucceeded: true, currentValuePreserved: true,
  entryIdAndBytesPreserved: true, originalRefResolvesInFork: true,
  sourceListCount: sourceList.length, forkListCount: forkList.length,
  listResult: 'method exists; native tree fork omits stored list elements',
  crossRepoError, sourceValue, forkValue, sourceEntry, forkEntry,
}, null, 2));
await source.close(ctx);
await fork.close(ctx);
await repo.close(ctx);
await otherRepo.close(ctx);
