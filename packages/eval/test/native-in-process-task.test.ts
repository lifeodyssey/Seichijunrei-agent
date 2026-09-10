import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Case, Dataset } from 'logfire/evals';
import { MemorySessionRepo, type LaneSnapshot } from '@earendil-works/pi-agent-core';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { optionsFor } from './native-task-fixture.ts';

void test('native Dataset attempts each receive a fresh session and return a LaneSnapshot', async () => {
  const sessions: string[] = [];
  const dataset = new Dataset<string, LaneSnapshot>({ name: 'Native tasks', cases: [new Case({ name: 'greeting', inputs: 'Hello' })] });
  const report = await dataset.evaluate((prompt) => inProcessTask(prompt, (session) => {
    sessions.push(session.metadata.id);
    const provider = fauxProvider();
    provider.setResponses([fauxAssistantMessage('Welcome to Kyoto.')]);
    const models = createModels();
    models.setProvider(provider.provider);
    return { session, models, model: provider.getModel() };
  }), { repeat: 3, maxConcurrency: 3 });

  assert.equal(report.failures.length, 0);
  assert.equal(report.cases.length, 3);
  assert.equal(new Set(sessions).size, 3);
  assert.deepEqual(report.cases.map(({ output }) => output.lastResult?.status),
    ['completed', 'completed', 'completed']);
  assert.deepEqual(report.cases.map(({ output }) => output.transcript.length), [2, 2, 2]);
});

void test('reused composition options cannot replace the task-owned session', async () => {
  const repo = new MemorySessionRepo();
  const external = await repo.create({}, BACKGROUND_CONTEXT);
  try {
    const result = await inProcessTask('Hello', () => optionsFor(external, [fauxAssistantMessage('Welcome.')]));
    assert.equal(result.lastResult?.status, 'completed');
    assert.equal((await external.findEntries(undefined, BACKGROUND_CONTEXT)).length, 0);
  } finally {
    await repo.close(BACKGROUND_CONTEXT);
  }
});
