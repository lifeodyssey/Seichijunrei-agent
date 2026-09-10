import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { HookInvocation, LaneSnapshot } from '@earendil-works/pi-agent-core';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { createOperationModels } from '@animichi/agent/models';
import { createCatalogClient } from '@animichi/agent/tools';
import { Case, Dataset } from 'logfire/evals';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { optionsFor, toolsFor } from './native-task-fixture.ts';
import { completion, model } from './native-model-fixture.ts';

void test('native after_tool retains executed arguments and the unmodified tool result', async () => {
  const observed: HookInvocation<'after_tool'>[] = [];
  const dataset = new Dataset<string, LaneSnapshot>({ name: 'Tool observations',
    cases: [new Case({ name: 'city', inputs: 'Find Kyoto' })] });
  const report = await dataset.evaluate((prompt) => inProcessTask(prompt, (session) => ({
    ...optionsFor(session, [
      fauxAssistantMessage(fauxToolCall('search_bangumi', { bangumi_id: '1' }, { id: 'search-1' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Found Kyoto.'),
    ]), toolContext: { ...toolsFor(session),
      catalog: createCatalogClient(() => Promise.resolve(Response.json({ rows: [], synced_at: '2026-09-10' }))) },
  }), BACKGROUND_CONTEXT, (harness) => {
    harness.hooks.on('before_tool', () => ({ args: { bangumi_id: '2' } }));
    harness.hooks.on('after_tool', (event) => {
      observed.push(event);
      return { details: { business_policy_applied: true } };
    });
  }));
  assert.equal(report.failures.length, 0);
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0]?.args, { bangumi_id: '2' });
  assert.deepEqual(observed[0].details, { kind: 'bangumi', anime_id: '2', rows: [], partial: false,
    execution: { operationId: report.cases[0]?.output.lastResult?.operationId,
      toolCallId: 'search-1', args: { bangumi_id: '2' } } });
  assert.equal(observed[0].toolCallId, 'search-1');
  assert.deepEqual(report.cases[0]?.attributes['pi.after_tool'], observed);
  const result = report.cases[0].output.transcript.find((entry) =>
    entry.type === 'message' && entry.message.role === 'toolResult');
  assert.ok(result?.type === 'message' && result.message.role === 'toolResult');
  assert.deepEqual(result.message.details, { business_policy_applied: true });
});

void test('native paid-tool cost is retained when an attempt later ends in provider failure', async () => {
  const models = await createOperationModels(model, 'fixture-key', () => Promise.resolve(completion('Your Name')));
  const dataset = new Dataset<string, LaneSnapshot>({ name: 'Failed usage',
    cases: [new Case({ name: 'failure', inputs: 'Hello' })] });
  const report = await dataset.evaluate((prompt) => inProcessTask(prompt, (session) => ({
    ...optionsFor(session, [
      fauxAssistantMessage(fauxToolCall('translate_anime_title', { title: '君の名は。', target_language: 'en' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'provider failed after tool' }),
    ]), toolContext: { ...toolsFor(session), translation: { models, model, payer: 'platform' } },
  })));
  const result = report.cases[0];
  assert.ok(result);
  assert.equal(result.output.lastResult?.status, 'failed');
  assert.equal(result.attributes['pi.usage.status'], 'measured');
  assert.equal(result.metrics['pi.cost.total'], 0.75);
  await models.logout('openai');
});
