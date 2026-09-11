import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { optionsFor, toolsFor } from './native-task-fixture.ts';

void test('eval executes the shared production respond tool and terminates with its native result', async () => {
  const authorized: string[] = [];
  const reserved: string[] = [];
  const result = await inProcessTask('Hello', (session) => ({
    ...optionsFor(session, [
      fauxAssistantMessage(fauxToolCall('respond', { kind: 'greeting', message: 'Welcome to Kyoto.' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'respond must terminate before this call' }),
    ]),
    toolContext: { ...toolsFor(session),
      assertAuthorized: (id) => { authorized.push(id); return Promise.resolve(); },
      reserveToolUsage: (id) => { reserved.push(id); return Promise.resolve(); } },
  }));
  assert.equal(result.lastResult?.status, 'completed');
  const entry = result.transcript.find((item) => item.type === 'message' && item.message.role === 'toolResult');
  assert.ok(entry?.type === 'message' && entry.message.role === 'toolResult');
  assert.deepEqual(entry.message.details, { intent: 'greet_user', message: 'Welcome to Kyoto.', data: {},
    execution: { operationId: result.lastResult.operationId, toolCallId: entry.message.toolCallId,
      args: { kind: 'greeting', message: 'Welcome to Kyoto.' } } });
  assert.equal(entry.message.isError, false);
  assert.deepEqual(authorized, [result.lastResult.operationId]);
  assert.equal(reserved.length, 1);
});

void test('eval advertises the same seven production tools to the native lane', async () => {
  const names: string[] = [];
  await inProcessTask('Hello', (session) => optionsFor(session, [fauxAssistantMessage('Welcome.')]),
    BACKGROUND_CONTEXT, async (harness, context) => {
      names.push(...(await harness.getTools(context)).map((tool) => tool.name));
    });
  assert.deepEqual(names.sort(), ['plan_route', 'resolve_anime', 'respond', 'search_bangumi',
    'search_nearby', 'translate_anime_title', 'web_search']);
});
