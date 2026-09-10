import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Case, Dataset } from 'logfire/evals';
import type { HookInvocation, LaneSnapshot } from '@earendil-works/pi-agent-core';
import { createOperationModels } from '@animichi/agent/models';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { model } from './native-model-fixture.ts';
import { toolsFor } from './native-task-fixture.ts';

function toolResponse(name: string, args: Record<string, string>) {
  const tool = { index: 0, id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } };
  const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture',
    choices: [{ index: 0, delta: { tool_calls: [tool] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

void test('eval shares production Models and web_search through their actual native APIs', async () => {
  const providerRequests: Request[] = [];
  const searchRequests: Request[] = [];
  const observations: HookInvocation<'after_tool'>[] = [];
  const responses = [toolResponse('web_search', { query: 'Your Name' }),
    toolResponse('respond', { kind: 'qa', message: 'The official film site is available.' })];
  const models = await createOperationModels(model, 'fixture-operation-key', (request) => {
    providerRequests.push(new Request(request));
    return Promise.resolve(responses.shift() ?? Response.error());
  });
  const dataset = new Dataset<string, LaneSnapshot>({ name: 'Production resources',
    cases: [new Case({ name: 'official source', inputs: 'Find an official source for Your Name' })] });
  try {
    const report = await dataset.evaluate((prompt) => inProcessTask(prompt, (session) => ({
      session, models, model, toolContext: { ...toolsFor(session), webFetch: (request) => {
        searchRequests.push(new Request(request));
        return Promise.resolve(new Response('<div class="result"><a class="result__a" href="https://kiminona.com/">Your Name</a><a class="result__snippet">Official film site</a></div>'));
      } }, retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
    }), undefined, (harness) => { harness.hooks.on('after_tool', (event) => { observations.push(event); return undefined; }); }));
    assert.equal(report.failures.length, 0);
    assert.equal(report.cases[0]?.output.lastResult?.status, 'completed');
    assert.equal(report.cases[0].metrics['pi.cost.total'], 1.5);
    assert.deepEqual(observations.map((event) => event.toolName), ['web_search', 'respond']);
    assert.equal(observations[0]?.isError, false);
    assert.deepEqual(observations[0].args, { query: 'Your Name' });
    assert.match(JSON.stringify(observations[0].details), /https:\/\/kiminona.com\//);
    assert.ok(searchRequests[0]);
    assert.equal(new URL(searchRequests[0].url).searchParams.get('q'), 'Your Name');
    assert.equal(providerRequests.length, 2);
    assert.equal(providerRequests[0]?.headers.get('authorization'), 'Bearer fixture-operation-key');
    assert.doesNotMatch(JSON.stringify(report), /fixture-operation-key/);
  } finally { await models.logout('openai'); }
});
