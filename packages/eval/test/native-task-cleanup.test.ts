import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { Session } from '@earendil-works/pi-agent-core';
import type { createPilgrimageHarness } from '@animichi/agent/harness';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { inProcessTask } from '../src/native/in-process-task.ts';
import { optionsFor } from './native-task-fixture.ts';

void test('a completed native task closes its session before returning', async () => {
  const sessions: Session[] = [];
  await inProcessTask('Hello', (session) => {
    sessions.push(session);
    return optionsFor(session, [fauxAssistantMessage('Welcome.')]);
  });
  const session = sessions[0];
  assert.ok(session);
  await assert.rejects(session.getStats(BACKGROUND_CONTEXT), /closed/);
});

void test('a composition failure still closes the fresh session', async () => {
  const sessions: Session[] = [];
  await assert.rejects(inProcessTask('Hello', (session) => {
    sessions.push(session);
    throw new Error('Missing model configuration');
  }), /Missing model configuration/);
  const session = sessions[0];
  assert.ok(session);
  await assert.rejects(session.getStats(BACKGROUND_CONTEXT), /closed/);
});

void test('the task releases the harness as well as its session', async () => {
  const harnesses: Awaited<ReturnType<typeof createPilgrimageHarness>>['harness'][] = [];
  await inProcessTask('Hello', (session) => optionsFor(session, [fauxAssistantMessage('Welcome.')]),
    BACKGROUND_CONTEXT, (harness) => { harnesses.push(harness); });
  const harness = harnesses[0];
  assert.ok(harness);
  await assert.rejects(harness.getTools(BACKGROUND_CONTEXT), /closed/i);
});
